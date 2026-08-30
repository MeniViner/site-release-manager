/**
 * Durable run telemetry.
 *
 * Every stage records status, timestamps, attempt, elapsed time, operation,
 * source, target, HTTP status, SharePoint code/type, the normalized error class
 * and the next action — so the Runs UI can explain a failure without anyone
 * reading raw logs.
 */

import { ObjectId } from 'mongodb';
import { getDb } from '../db.js';
import { STAGE, STAGE_LABELS, canonicalStage, stageLabel } from '../../../shared/deploymentStages.js';
import { summarizeStages } from './jobState.js';

const MAX_EVENTS = 1500;

/** Canonical stage keys. Kept under the historical export name for compatibility. */
export const RUN_STAGES = STAGE;
export { STAGE_LABELS, canonicalStage, stageLabel };

const text = (value, max = 2000) => String(value ?? '').slice(0, max);

function sanitizeDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const result = {};
  for (const [key, value] of Object.entries(details)) {
    if (value == null) continue;
    if (typeof value === 'string') result[key] = text(value, 2000);
    else if (typeof value === 'number' || typeof value === 'boolean') result[key] = value;
    else result[key] = text(JSON.stringify(value), 2000);
  }
  return result;
}

let eventCounter = 0;

export function normalizeRunEvent(input = {}, defaults = {}) {
  const now = new Date();
  const stage = canonicalStage(input.stage || defaults.stage || 'UNKNOWN');
  const status = ['started', 'success', 'warning', 'failed', 'info'].includes(input.status)
    ? input.status
    : (defaults.status || 'info');

  eventCounter += 1;
  return {
    eventId: text(input.eventId || `${Date.now()}-${eventCounter}-${Math.random().toString(36).slice(2, 9)}`, 100),
    stage,
    stageLabel: text(input.stageLabel || stageLabel(stage) || defaults.stageLabel || stage, 200),
    status,
    source: text(input.source || defaults.source || 'server', 60),
    message: text(input.message || defaults.message || '', 2000),
    currentFile: text(input.currentFile || '', 1000),
    operation: text(input.operation || '', 200),
    target: text(input.target || '', 500),
    method: text(input.method || '', 20),
    url: text(input.url || '', 2000),
    httpStatus: Number.isFinite(Number(input.httpStatus)) && input.httpStatus !== null && input.httpStatus !== ''
      ? Number(input.httpStatus)
      : null,
    attempt: Number.isFinite(Number(input.attempt)) ? Number(input.attempt) : null,
    durationMs: Number.isFinite(Number(input.durationMs)) ? Number(input.durationMs) : null,
    errorClass: text(input.errorClass || '', 60),
    sharePointCode: text(input.sharePointCode || '', 60),
    sharePointExceptionType: text(input.sharePointExceptionType || '', 200),
    nextAction: text(input.nextAction || '', 500),
    details: sanitizeDetails(input.details),
    at: input.at ? new Date(input.at) : now,
  };
}

export async function appendRunEvent(jobId, input, defaults = {}) {
  const db = getDb();
  const objectId = jobId instanceof ObjectId ? jobId : new ObjectId(jobId);
  const event = normalizeRunEvent(input, defaults);
  const update = {
    $push: { runEvents: { $each: [event], $slice: -MAX_EVENTS } },
    $set: { updatedAt: new Date() },
  };

  // LOCAL_AUDIT is an optional side-check that may run after server preparation.
  // It must not move the canonical deployment state machine backwards.
  if (event.stage !== 'LOCAL_AUDIT') {
    update.$set.currentStage = event.stage;
    update.$set.currentStageLabel = event.stageLabel;
  }
  if (event.status === 'failed') {
    update.$set.failureStage = event.stage;
    update.$set.failureInfo = {
      stage: event.stage,
      stageLabel: event.stageLabel,
      message: event.message,
      currentFile: event.currentFile || '',
      operation: event.operation || '',
      target: event.target || '',
      method: event.method || '',
      url: event.url || '',
      httpStatus: event.httpStatus,
      attempt: event.attempt,
      errorClass: event.errorClass || '',
      sharePointCode: event.sharePointCode || '',
      sharePointExceptionType: event.sharePointExceptionType || '',
      nextAction: event.nextAction || '',
      details: event.details,
      at: event.at,
    };
  }
  // A stage that succeeds after an earlier failure clears the failure focus, so
  // a recovered transient condition does not keep the run looking broken.
  if (event.status === 'success') update.$unset = { failureStage: '', failureInfo: '' };

  await db.collection('deployment_jobs').updateOne({ _id: objectId }, update);
  return event;
}

export async function appendRunEvents(jobId, events, defaults = {}) {
  for (const event of events || []) await appendRunEvent(jobId, event, defaults);
}

/** Retained for compatibility with existing callers and tests. */
export function summarizeEvents(events = [], jobState = '') {
  return summarizeStages(events.map((event) => normalizeRunEvent(event)), jobState);
}
