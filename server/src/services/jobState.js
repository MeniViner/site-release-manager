/**
 * Durable deployment job state machine.
 *
 * Historical runs are already stored with the older vocabulary, so the canonical
 * names keep the existing spellings wherever they were compatible
 * (PREPARING_RELEASE, READY_FOR_SHAREPOINT, DEPLOYING, SUCCEEDED, FAILED) and
 * the one incompatible legacy value (INTERRUPTED) is read as SUPERSEDED without
 * rewriting stored documents.
 */

import { STAGE, canonicalStage, stageLabel } from '../../../shared/deploymentStages.js';

export const JOB_STATE = Object.freeze({
  QUEUED: 'QUEUED',
  PREPARING_RELEASE: 'PREPARING_RELEASE',
  READY_FOR_SHAREPOINT: 'READY_FOR_SHAREPOINT',
  WAITING_FOR_BROWSER: 'WAITING_FOR_BROWSER',
  DEPLOYING: 'DEPLOYING',
  PAUSED: 'PAUSED',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  SUPERSEDED: 'SUPERSEDED',
});

/** Values written by earlier versions that must keep resolving. */
export const LEGACY_STATE_ALIASES = Object.freeze({
  INTERRUPTED: JOB_STATE.SUPERSEDED,
  PREPARING: JOB_STATE.PREPARING_RELEASE,
});

/** States in which the job still owns its target and may write to SharePoint. */
export const ACTIVE_STATES = Object.freeze([
  JOB_STATE.QUEUED,
  JOB_STATE.PREPARING_RELEASE,
  JOB_STATE.READY_FOR_SHAREPOINT,
  JOB_STATE.WAITING_FOR_BROWSER,
  JOB_STATE.DEPLOYING,
]);

/** Held but not writing. A paused job still owns the target lock. */
export const HELD_STATES = Object.freeze([JOB_STATE.PAUSED]);

export const TERMINAL_STATES = Object.freeze([
  JOB_STATE.SUCCEEDED,
  JOB_STATE.FAILED,
  JOB_STATE.CANCELLED,
  JOB_STATE.SUPERSEDED,
]);

/** Every value that must be matched when querying for a target's current owner. */
export const ACTIVE_STATE_QUERY = Object.freeze([...ACTIVE_STATES, ...HELD_STATES]);

/** Terminal values including the legacy spelling, for history queries. */
export const TERMINAL_STATE_QUERY = Object.freeze([...TERMINAL_STATES, 'INTERRUPTED']);

export function canonicalState(state) {
  const key = String(state || '').trim().toUpperCase();
  if (JOB_STATE[key]) return key;
  return LEGACY_STATE_ALIASES[key] || key;
}

export const isActive = (state) => ACTIVE_STATES.includes(canonicalState(state));
export const isHeld = (state) => HELD_STATES.includes(canonicalState(state));
export const isTerminal = (state) => TERMINAL_STATES.includes(canonicalState(state));
/** A job that still owns its target: nothing else may deploy to it. */
export const ownsTarget = (state) => isActive(state) || isHeld(state);

/**
 * A job may be resumed when SharePoint work was already under way and the job
 * never reached a terminal state. Resuming continues at the first incomplete
 * stage; it never restarts from stage 1.
 */
export const RESUMABLE_STATES = Object.freeze([
  JOB_STATE.READY_FOR_SHAREPOINT,
  JOB_STATE.WAITING_FOR_BROWSER,
  JOB_STATE.DEPLOYING,
  JOB_STATE.PAUSED,
]);

export const isResumable = (state) => RESUMABLE_STATES.includes(canonicalState(state));

/**
 * The transitions the product actually performs.
 *
 * Two entries are load-bearing and were wrong when this table was first written:
 *  - FAILED -> READY_FOR_SHAREPOINT is how an explicit user retry works;
 *    retryDeploymentJob re-prepares the job in place rather than creating a new
 *    one, so the already-verified target state is not thrown away.
 *  - WAITING_FOR_BROWSER -> SUCCEEDED happens whenever a deployment finishes
 *    without ever emitting a progress update (a very small release).
 */
const ALLOWED_TRANSITIONS = Object.freeze({
  QUEUED: [JOB_STATE.PREPARING_RELEASE, JOB_STATE.CANCELLED, JOB_STATE.SUPERSEDED, JOB_STATE.FAILED],
  PREPARING_RELEASE: [JOB_STATE.READY_FOR_SHAREPOINT, JOB_STATE.FAILED, JOB_STATE.CANCELLED, JOB_STATE.SUPERSEDED],
  READY_FOR_SHAREPOINT: [JOB_STATE.WAITING_FOR_BROWSER, JOB_STATE.DEPLOYING, JOB_STATE.PAUSED, JOB_STATE.SUCCEEDED, JOB_STATE.FAILED, JOB_STATE.CANCELLED, JOB_STATE.SUPERSEDED],
  WAITING_FOR_BROWSER: [JOB_STATE.DEPLOYING, JOB_STATE.READY_FOR_SHAREPOINT, JOB_STATE.PAUSED, JOB_STATE.SUCCEEDED, JOB_STATE.FAILED, JOB_STATE.CANCELLED, JOB_STATE.SUPERSEDED],
  DEPLOYING: [JOB_STATE.SUCCEEDED, JOB_STATE.FAILED, JOB_STATE.PAUSED, JOB_STATE.CANCELLED, JOB_STATE.SUPERSEDED, JOB_STATE.WAITING_FOR_BROWSER, JOB_STATE.DEPLOYING],
  PAUSED: [JOB_STATE.DEPLOYING, JOB_STATE.READY_FOR_SHAREPOINT, JOB_STATE.WAITING_FOR_BROWSER, JOB_STATE.CANCELLED, JOB_STATE.SUPERSEDED, JOB_STATE.FAILED],
  SUCCEEDED: [],
  FAILED: [JOB_STATE.READY_FOR_SHAREPOINT, JOB_STATE.WAITING_FOR_BROWSER, JOB_STATE.DEPLOYING],
  CANCELLED: [],
  SUPERSEDED: [],
});

/**
 * A terminal state is final, except that an explicit user retry may re-enter a
 * FAILED job. SUCCEEDED, CANCELLED and SUPERSEDED can never be left.
 */
export function canTransition(from, to) {
  const source = canonicalState(from);
  const target = canonicalState(to);
  if (source === target && ACTIVE_STATES.includes(source)) return true;
  return (ALLOWED_TRANSITIONS[source] || []).includes(target);
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    const error = new Error(`Invalid job transition ${canonicalState(from)} -> ${canonicalState(to)}.`);
    error.statusCode = 409;
    error.code = 'INVALID_JOB_TRANSITION';
    throw error;
  }
  return canonicalState(to);
}

export const STATE_LABELS = Object.freeze({
  QUEUED: 'ממתין בתור',
  PREPARING_RELEASE: 'מכין ריליס',
  READY_FOR_SHAREPOINT: 'מוכן ל-SharePoint',
  WAITING_FOR_BROWSER: 'ממתין לדפדפן SharePoint',
  DEPLOYING: 'בפריסה',
  PAUSED: 'מושהה',
  SUCCEEDED: 'הושלם',
  FAILED: 'נכשל',
  CANCELLED: 'בוטל',
  SUPERSEDED: 'הוחלף',
});

export const stateLabel = (state) => STATE_LABELS[canonicalState(state)] || canonicalState(state) || '—';

/**
 * Collapse a job's event stream into a per-stage summary.
 *
 * A settled job may never leave a stage rendered as "running": when the job is
 * terminal, any stage still showing `started` is reported as abandoned so the
 * UI cannot show a permanently spinning stage.
 */
export function summarizeStages(events = [], jobState = '') {
  const settled = isTerminal(jobState);
  const byStage = new Map();

  for (const raw of events) {
    const stage = canonicalStage(raw?.stage);
    if (!stage) continue;
    const current = byStage.get(stage) || {
      stage,
      stageLabel: raw?.stageLabel || stageLabel(stage),
      status: 'info',
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      attempts: 0,
      message: '',
      currentFile: '',
      operation: '',
      source: raw?.source || '',
      httpStatus: null,
      errorClass: '',
      sharePointCode: '',
      sharePointExceptionType: '',
      nextAction: '',
    };

    if (raw?.stageLabel) current.stageLabel = raw.stageLabel;
    if (raw?.source) current.source = raw.source;
    if (raw?.operation) current.operation = raw.operation;
    if (raw?.currentFile) current.currentFile = raw.currentFile;
    if (raw?.message) current.message = raw.message;
    if (raw?.httpStatus != null) current.httpStatus = raw.httpStatus;
    if (raw?.details?.errorClass) current.errorClass = raw.details.errorClass;
    if (raw?.details?.sharePointCode) current.sharePointCode = raw.details.sharePointCode;
    if (raw?.details?.sharePointExceptionType) current.sharePointExceptionType = raw.details.sharePointExceptionType;
    if (raw?.details?.nextAction) current.nextAction = raw.details.nextAction;
    if (raw?.details?.attempt != null) current.attempts = Math.max(current.attempts, Number(raw.details.attempt) || 0);

    switch (raw?.status) {
      case 'started':
        current.startedAt = current.startedAt || raw.at;
        if (current.status !== 'success') current.status = 'started';
        current.attempts = Math.max(current.attempts, 1);
        break;
      case 'success':
        current.finishedAt = raw.at;
        current.status = 'success';
        break;
      case 'failed':
        current.finishedAt = raw.at;
        current.status = 'failed';
        break;
      case 'warning':
        if (current.status !== 'failed' && current.status !== 'success') current.status = 'warning';
        break;
      default:
        break;
    }

    if (raw?.durationMs != null) current.durationMs = raw.durationMs;
    if (current.durationMs == null && current.startedAt && current.finishedAt) {
      current.durationMs = Math.max(0, new Date(current.finishedAt).getTime() - new Date(current.startedAt).getTime());
    }
    byStage.set(stage, current);
  }

  const summary = [...byStage.values()];
  if (settled) {
    for (const stage of summary) {
      if (stage.status === 'started') {
        stage.status = canonicalState(jobState) === JOB_STATE.SUCCEEDED ? 'success' : 'abandoned';
        stage.finishedAt = stage.finishedAt || null;
      }
    }
  }
  return summary;
}

/** Stages already verified complete — the resume point is the first one missing. */
export function completedStages(events = []) {
  const done = new Set();
  const failed = new Set();
  for (const raw of events) {
    const stage = canonicalStage(raw?.stage);
    if (!stage) continue;
    if (raw.status === 'success') { done.add(stage); failed.delete(stage); }
    if (raw.status === 'failed') { failed.add(stage); done.delete(stage); }
  }
  return { done, failed };
}

/**
 * First stage that still needs work.
 *
 * The browser worker uses this to report what it is resuming, and to seed the
 * already-verified asset set so verified uploads are not repeated. It does NOT
 * jump straight to this stage: browser activation, contextinfo, library
 * discovery and folder/seed provisioning are re-run because they are cheap,
 * idempotent, and the FormDigest is session-scoped and must be re-acquired.
 * Discovery finds the existing libraries, folders and TXT files and reuses them.
 */
export function resumeStage(events = [], pipeline = null) {
  const order = pipeline || [
    STAGE.BROWSER_ACTIVATE, STAGE.SHAREPOINT_CONTEXTINFO, STAGE.LIBRARY_DISCOVERY,
    STAGE.CREATE_LIBRARIES, STAGE.LIBRARY_STABILIZE, STAGE.PRE_DEPLOY_BACKUP, STAGE.CREATE_FOLDERS, STAGE.FOLDER_STABILIZE,
    STAGE.CREATE_TXT_SEEDS, STAGE.PERMISSIONS_SETUP, STAGE.FINAL_ASSET_COPY, STAGE.FINAL_ASSET_VERIFY,
    STAGE.FINAL_RUNTIME_CONFIG_VERIFY, STAGE.FINAL_INDEX_COMMIT, STAGE.FINAL_INDEX_VERIFY, STAGE.FINAL_APP_SMOKE, STAGE.COMPLETE,
  ];
  const { done } = completedStages(events);
  return order.find((stage) => !done.has(stage)) || STAGE.COMPLETE;
}
