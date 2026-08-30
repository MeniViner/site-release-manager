/**
 * Bounded retry and stabilization primitives.
 *
 * The SharePoint farm acknowledges a mutation before the mutated object is
 * readable. The fix is never an arbitrary long sleep: every wait here is
 * bounded by BOTH an attempt count and an elapsed-time ceiling, classifies the
 * error it is sitting through, verifies real target state after each attempt,
 * and can be cancelled.
 *
 * `sleep` and `now` are injectable so tests exercise the real control flow at
 * zero wall-clock cost.
 */

import { SP_ERROR, classifySharePointError, isNotReady, isRetryable } from './sharepointErrors.js';

export const DEFAULT_RETRY = Object.freeze({
  initialDelayMs: 400,
  maxDelayMs: 5000,
  factor: 1.8,
  maxAttempts: 8,
  maxElapsedMs: 45000,
  jitterRatio: 0.2,
});

/** Longer budget for the barriers that follow a library or folder creation. */
export const STABILIZE_RETRY = Object.freeze({
  initialDelayMs: 600,
  maxDelayMs: 6000,
  factor: 1.7,
  maxAttempts: 14,
  maxElapsedMs: 90000,
  jitterRatio: 0.2,
});

export class RetryBudgetExceededError extends Error {
  constructor(message, info) {
    super(message);
    this.name = 'RetryBudgetExceededError';
    Object.assign(this, info || {});
  }
}

export class CancelledError extends Error {
  constructor(message = 'Operation was cancelled.') {
    super(message);
    this.name = 'CancelledError';
    this.cancelled = true;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const defaultNow = () => Date.now();

/**
 * Deterministic backoff schedule. Exposed so tests can assert the curve is
 * bounded rather than inferring it from timing.
 */
export function backoffDelays(options = {}) {
  const { initialDelayMs, maxDelayMs, factor, maxAttempts } = { ...DEFAULT_RETRY, ...options };
  const delays = [];
  let delay = initialDelayMs;
  for (let attempt = 1; attempt < Math.max(1, maxAttempts); attempt += 1) {
    delays.push(Math.min(maxDelayMs, Math.round(delay)));
    delay *= factor;
  }
  return delays;
}

function applyJitter(delay, jitterRatio, random) {
  if (!jitterRatio) return delay;
  const spread = delay * jitterRatio;
  return Math.max(0, Math.round(delay - spread + (random() * spread * 2)));
}

/**
 * Normalize a thrown error into a classified record.
 *
 * An error that already carries a classification (a ProvisioningError, or an
 * error built by `sharePointError`) is trusted as-is. Re-deriving it from the
 * bare Error would misread a permanent condition — an auto-suffixed library
 * root, a non-Document-Library collision — as a transient one and burn the
 * whole retry budget on something that will never resolve.
 */
function normalizeThrown(error, describe) {
  if (error?.sharePoint) return error.sharePoint;
  if (error?.errorClass) {
    return {
      errorClass: error.errorClass,
      httpStatus: error.httpStatus ?? null,
      sharePointCode: error.sharePointCode || '',
      sharePointExceptionType: error.sharePointExceptionType || '',
      message: error.message || String(error),
      url: error.url || '',
      method: error.method || '',
      operation: error.operation || describe,
      target: error.target || '',
      responsePreview: '',
      retryable: isRetryable(error.errorClass),
      nextAction: '',
      code: error.code || '',
    };
  }
  return classifySharePointError({
    httpStatus: error?.httpStatus,
    body: error?.responseBody ?? error?.details?.responsePreview ?? null,
    operation: error?.operation || describe,
    url: error?.url,
    method: error?.method,
    cause: error,
  });
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw new CancelledError();
}

/**
 * Run `operation` until it succeeds or the retry budget is spent.
 *
 * `shouldRetry(normalizedError, attempt)` decides. It defaults to the shared
 * classifier so a caller never re-implements "is this transient?".
 *
 * @returns {Promise<{value:any, attempts:number, elapsedMs:number, history:Array}>}
 */
export async function retryOperation(operation, options = {}) {
  const config = { ...DEFAULT_RETRY, ...options };
  const {
    sleep = defaultSleep,
    now = defaultNow,
    random = Math.random,
    signal,
    onAttempt,
    shouldRetry = (normalized) => isRetryable(normalized.errorClass),
    describe = 'sharepoint-operation',
  } = config;

  const startedAt = now();
  const history = [];
  let lastNormalized = null;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    throwIfCancelled(signal);
    const attemptStartedAt = now();
    try {
      const value = await operation(attempt);
      const elapsedMs = now() - startedAt;
      history.push({ attempt, ok: true, elapsedMs: attemptStartedAt === undefined ? null : now() - attemptStartedAt });
      if (onAttempt) await onAttempt({ attempt, ok: true, elapsedMs, describe, history });
      return { value, attempts: attempt, elapsedMs, history };
    } catch (error) {
      if (error instanceof CancelledError || error?.cancelled) throw error;
      const normalized = normalizeThrown(error, describe);
      lastNormalized = normalized;
      const elapsedMs = now() - startedAt;
      const record = {
        attempt,
        ok: false,
        errorClass: normalized.errorClass,
        httpStatus: normalized.httpStatus,
        sharePointCode: normalized.sharePointCode,
        sharePointExceptionType: normalized.sharePointExceptionType,
        message: normalized.message,
        elapsedMs,
      };
      history.push(record);
      if (onAttempt) await onAttempt({ ...record, describe, history });

      const budgetLeft = attempt < config.maxAttempts && elapsedMs < config.maxElapsedMs;
      if (!budgetLeft || !shouldRetry(normalized, attempt)) {
        error.sharePoint = normalized;
        error.retryHistory = history;
        error.attempts = attempt;
        if (!budgetLeft && shouldRetry(normalized, attempt)) {
          throw new RetryBudgetExceededError(
            `${describe}: retry budget exhausted after ${attempt} attempt(s) / ${elapsedMs}ms — last: ${normalized.message}`,
            { sharePoint: normalized, retryHistory: history, attempts: attempt, elapsedMs, errorClass: normalized.errorClass },
          );
        }
        throw error;
      }

      const scheduled = backoffDelays(config)[attempt - 1] ?? config.maxDelayMs;
      const delay = applyJitter(scheduled, config.jitterRatio, random);
      const remaining = config.maxElapsedMs - elapsedMs;
      throwIfCancelled(signal);
      await sleep(Math.max(0, Math.min(delay, remaining)));
    }
  }

  throw new RetryBudgetExceededError(
    `${describe}: retry budget exhausted (${config.maxAttempts} attempts).`,
    { sharePoint: lastNormalized, retryHistory: history, attempts: config.maxAttempts },
  );
}

/**
 * Stabilization barrier: poll `verify` until it reports ready.
 *
 * This is the "verified target state is authority" rule. `verify` must re-read
 * real SharePoint state and return `{ ready: boolean, value?, reason? }`. A
 * throw whose class is MISSING or TRANSIENT_NOT_READY is treated as
 * "not ready yet" — that is exactly the eventual-consistency window that used
 * to require a manual browser refresh.
 */
export async function stabilize(verify, options = {}) {
  const config = { ...STABILIZE_RETRY, ...options };
  const {
    sleep = defaultSleep,
    now = defaultNow,
    random = Math.random,
    signal,
    onAttempt,
    describe = 'stabilize',
  } = config;

  const startedAt = now();
  const history = [];
  let lastReason = 'not-ready';
  let lastNormalized = null;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    throwIfCancelled(signal);
    let ready = false;
    let value;
    let reason = '';
    try {
      const outcome = await verify(attempt);
      ready = outcome?.ready === true;
      value = outcome?.value;
      reason = outcome?.reason || (ready ? 'ready' : 'not-ready');
    } catch (error) {
      if (error instanceof CancelledError || error?.cancelled) throw error;
      const normalized = normalizeThrown(error, describe);
      lastNormalized = normalized;
      // Anything that is NOT a "not yet visible" condition is a real failure and
      // must surface immediately instead of burning the whole budget.
      if (!isNotReady(normalized.errorClass)) {
        error.sharePoint = normalized;
        error.stabilizeHistory = history;
        throw error;
      }
      reason = `${normalized.errorClass}:${normalized.message}`;
    }

    const elapsedMs = now() - startedAt;
    const record = { attempt, ready, reason, elapsedMs, errorClass: lastNormalized?.errorClass || null };
    history.push(record);
    if (onAttempt) await onAttempt({ ...record, describe, history });
    if (ready) return { value, attempts: attempt, elapsedMs, history };

    lastReason = reason;
    if (attempt >= config.maxAttempts || elapsedMs >= config.maxElapsedMs) break;

    const scheduled = backoffDelays(config)[attempt - 1] ?? config.maxDelayMs;
    const delay = applyJitter(scheduled, config.jitterRatio, random);
    throwIfCancelled(signal);
    await sleep(Math.max(0, Math.min(delay, config.maxElapsedMs - elapsedMs)));
  }

  throw new RetryBudgetExceededError(
    `${describe}: did not stabilize within ${history.length} attempt(s) — last reason: ${lastReason}`,
    {
      sharePoint: lastNormalized || { errorClass: SP_ERROR.TRANSIENT_NOT_READY, message: lastReason },
      errorClass: lastNormalized?.errorClass || SP_ERROR.TRANSIENT_NOT_READY,
      stabilizeHistory: history,
      attempts: history.length,
    },
  );
}
