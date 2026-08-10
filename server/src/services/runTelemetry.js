import { ObjectId } from 'mongodb';
import { getDb } from '../db.js';

const MAX_EVENTS = 1200;

export const RUN_STAGES = Object.freeze({
  JOB_CREATED: 'JOB_CREATED',
  RELEASE_VALIDATED: 'RELEASE_VALIDATED',
  RUNTIME_CONFIG: 'RUNTIME_CONFIG',
  MANIFEST: 'MANIFEST',
  READY_FOR_SHAREPOINT: 'READY_FOR_SHAREPOINT',
  DEPLOYER_INIT: 'DEPLOYER_INIT',
  TARGET_VALIDATION: 'TARGET_VALIDATION',
  FORM_DIGEST: 'FORM_DIGEST',
  LIBRARIES: 'LIBRARIES',
  FOLDERS: 'FOLDERS',
  SEED_FILES: 'SEED_FILES',
  RELEASE_FILES: 'RELEASE_FILES',
  FINAL_VERIFY: 'FINAL_VERIFY',
  COMPLETE: 'COMPLETE',
});

export const STAGE_LABELS = Object.freeze({
  JOB_CREATED: 'יצירת משימת פריסה',
  RELEASE_VALIDATED: 'בדיקת הריליס',
  RUNTIME_CONFIG: 'יצירת Runtime Config',
  MANIFEST: 'יצירת Manifest וסדר העלאה',
  READY_FOR_SHAREPOINT: 'מוכן למעבר ל-SharePoint',
  DEPLOYER_INIT: 'טעינת SharePoint Deployer',
  TARGET_VALIDATION: 'אימות אתר היעד',
  FORM_DIGEST: 'חיבור ל-SharePoint וקבלת FormDigest',
  LIBRARIES: 'בדיקת/יצירת ספריות מסמכים',
  FOLDERS: 'בדיקת/יצירת תיקיות',
  SEED_FILES: 'בדיקת/יצירת קובצי TXT',
  RELEASE_FILES: 'העלאת קובצי הריליס',
  FINAL_VERIFY: 'אימות האתר הסופי',
  COMPLETE: 'סיום הפריסה',
});

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

export function normalizeRunEvent(input = {}, defaults = {}) {
  const now = new Date();
  const stage = text(input.stage || defaults.stage || 'UNKNOWN', 80).toUpperCase();
  const status = ['started', 'success', 'warning', 'failed', 'info'].includes(input.status)
    ? input.status
    : (defaults.status || 'info');
  return {
    eventId: text(input.eventId || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, 100),
    stage,
    stageLabel: text(input.stageLabel || STAGE_LABELS[stage] || defaults.stageLabel || stage, 200),
    status,
    source: text(input.source || defaults.source || 'server', 40),
    message: text(input.message || defaults.message || '', 2000),
    currentFile: text(input.currentFile || '', 1000),
    operation: text(input.operation || '', 200),
    method: text(input.method || '', 20),
    url: text(input.url || '', 2000),
    httpStatus: Number.isFinite(Number(input.httpStatus)) ? Number(input.httpStatus) : null,
    durationMs: Number.isFinite(Number(input.durationMs)) ? Number(input.durationMs) : null,
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
    $set: {
      currentStage: event.stage,
      currentStageLabel: event.stageLabel,
      updatedAt: new Date(),
    },
  };
  if (event.status === 'failed') {
    update.$set.failureStage = event.stage;
    update.$set.failureInfo = {
      stage: event.stage,
      stageLabel: event.stageLabel,
      message: event.message,
      currentFile: event.currentFile || '',
      operation: event.operation || '',
      method: event.method || '',
      url: event.url || '',
      httpStatus: event.httpStatus,
      details: event.details,
      at: event.at,
    };
  }
  await db.collection('deployment_jobs').updateOne({ _id: objectId }, update);
  return event;
}

export async function appendRunEvents(jobId, events, defaults = {}) {
  for (const event of events || []) await appendRunEvent(jobId, event, defaults);
}

export function summarizeEvents(events = []) {
  const stages = new Map();
  for (const raw of events) {
    const event = normalizeRunEvent(raw);
    const current = stages.get(event.stage) || {
      stage: event.stage,
      stageLabel: event.stageLabel,
      status: 'info',
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      message: '',
      currentFile: '',
      source: event.source,
    };
    current.stageLabel = event.stageLabel || current.stageLabel;
    current.source = event.source || current.source;
    if (event.status === 'started') {
      current.startedAt = event.at;
      current.status = 'started';
    } else if (event.status === 'success') {
      current.finishedAt = event.at;
      current.status = 'success';
    } else if (event.status === 'failed') {
      current.finishedAt = event.at;
      current.status = 'failed';
    } else if (event.status === 'warning' && current.status !== 'failed') {
      current.status = 'warning';
    }
    if (event.message) current.message = event.message;
    if (event.currentFile) current.currentFile = event.currentFile;
    if (event.durationMs != null) current.durationMs = event.durationMs;
    if (current.durationMs == null && current.startedAt && current.finishedAt) {
      current.durationMs = Math.max(0, new Date(current.finishedAt).getTime() - new Date(current.startedAt).getTime());
    }
    stages.set(event.stage, current);
  }
  return [...stages.values()];
}
