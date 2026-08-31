/**
 * Canonical Site Release Manager deployment stages.
 *
 * This is the single authoritative stage vocabulary. Both the Node API and the
 * in-browser SharePoint worker import it so a stage key can never drift between
 * the component that reports it and the component that renders it.
 *
 * Historical runs stored older stage keys. LEGACY_STAGE_ALIASES maps those onto
 * the canonical keys so stored telemetry keeps rendering after an upgrade.
 */

export const STAGE = Object.freeze({
  RELEASE_VALIDATE: 'RELEASE_VALIDATE',
  TARGET_VALIDATE: 'TARGET_VALIDATE',
  STAGING_CREATE: 'STAGING_CREATE',
  RUNTIME_CONFIG_CREATE: 'RUNTIME_CONFIG_CREATE',
  MANIFEST_CREATE: 'MANIFEST_CREATE',
  READY_FOR_SHAREPOINT: 'READY_FOR_SHAREPOINT',
  BROWSER_ACTIVATE: 'BROWSER_ACTIVATE',
  SHAREPOINT_CONTEXTINFO: 'SHAREPOINT_CONTEXTINFO',
  LIBRARY_DISCOVERY: 'LIBRARY_DISCOVERY',
  CREATE_LIBRARIES: 'CREATE_LIBRARIES',
  LIBRARY_STABILIZE: 'LIBRARY_STABILIZE',
  PRE_DEPLOY_BACKUP: 'PRE_DEPLOY_BACKUP',
  CREATE_FOLDERS: 'CREATE_FOLDERS',
  FOLDER_STABILIZE: 'FOLDER_STABILIZE',
  CREATE_TXT_SEEDS: 'CREATE_TXT_SEEDS',
  PERMISSIONS_SETUP: 'PERMISSIONS_SETUP',
  FINAL_ASSET_COPY: 'FINAL_ASSET_COPY',
  FINAL_ASSET_VERIFY: 'FINAL_ASSET_VERIFY',
  FINAL_RUNTIME_CONFIG_VERIFY: 'FINAL_RUNTIME_CONFIG_VERIFY',
  FINAL_INDEX_COMMIT: 'FINAL_INDEX_COMMIT',
  FINAL_INDEX_VERIFY: 'FINAL_INDEX_VERIFY',
  FINAL_APP_SMOKE: 'FINAL_APP_SMOKE',
  COMPLETE: 'COMPLETE',
});

/** Ordered pipeline. Index in this array is the stage number shown in the UI. */
export const STAGE_ORDER = Object.freeze([
  STAGE.RELEASE_VALIDATE,
  STAGE.TARGET_VALIDATE,
  STAGE.STAGING_CREATE,
  STAGE.RUNTIME_CONFIG_CREATE,
  STAGE.MANIFEST_CREATE,
  STAGE.READY_FOR_SHAREPOINT,
  STAGE.BROWSER_ACTIVATE,
  STAGE.SHAREPOINT_CONTEXTINFO,
  STAGE.LIBRARY_DISCOVERY,
  STAGE.CREATE_LIBRARIES,
  STAGE.LIBRARY_STABILIZE,
  STAGE.PRE_DEPLOY_BACKUP,
  STAGE.CREATE_FOLDERS,
  STAGE.FOLDER_STABILIZE,
  STAGE.CREATE_TXT_SEEDS,
  STAGE.PERMISSIONS_SETUP,
  STAGE.FINAL_ASSET_COPY,
  STAGE.FINAL_ASSET_VERIFY,
  STAGE.FINAL_RUNTIME_CONFIG_VERIFY,
  STAGE.FINAL_INDEX_COMMIT,
  STAGE.FINAL_INDEX_VERIFY,
  STAGE.FINAL_APP_SMOKE,
  STAGE.COMPLETE,
]);

/** Stages the Node API owns. Everything after READY_FOR_SHAREPOINT is browser-owned. */
export const SERVER_STAGES = Object.freeze([
  STAGE.RELEASE_VALIDATE,
  STAGE.TARGET_VALIDATE,
  STAGE.STAGING_CREATE,
  STAGE.RUNTIME_CONFIG_CREATE,
  STAGE.MANIFEST_CREATE,
  STAGE.READY_FOR_SHAREPOINT,
]);

/** Stages that perform authenticated SharePoint mutations. Browser only, never Node. */
export const BROWSER_MUTATION_STAGES = Object.freeze([
  STAGE.CREATE_LIBRARIES,
  STAGE.PRE_DEPLOY_BACKUP,
  STAGE.CREATE_FOLDERS,
  STAGE.CREATE_TXT_SEEDS,
  STAGE.PERMISSIONS_SETUP,
  STAGE.FINAL_ASSET_COPY,
  STAGE.FINAL_INDEX_COMMIT,
]);

export const STAGE_LABELS = Object.freeze({
  RELEASE_VALIDATE: 'אימות הריליס',
  TARGET_VALIDATE: 'אימות אתר היעד',
  STAGING_CREATE: 'יצירת Staging ייעודי לריצה',
  RUNTIME_CONFIG_CREATE: 'יצירת Runtime Config לאתר',
  MANIFEST_CREATE: 'יצירת Manifest וסדר העלאה',
  READY_FOR_SHAREPOINT: 'מוכן לפריסה ב-SharePoint',
  BROWSER_ACTIVATE: 'הפעלת מנוע הפריסה בדפדפן',
  SHAREPOINT_CONTEXTINFO: 'חיבור ל-SharePoint וקבלת FormDigest',
  LIBRARY_DISCOVERY: 'איתור ספריות מסמכים קיימות',
  CREATE_LIBRARIES: 'יצירת ספריות מסמכים חסרות',
  LIBRARY_STABILIZE: 'ייצוב ספריות המסמכים',
  PRE_DEPLOY_BACKUP: 'גיבוי TXT לפני פריסה',
  CREATE_FOLDERS: 'יצירת תיקיות',
  FOLDER_STABILIZE: 'ייצוב התיקיות',
  CREATE_TXT_SEEDS: 'יצירת קובצי TXT חסרים',
  PERMISSIONS_SETUP: 'הגדרת הרשאות',
  FINAL_ASSET_COPY: 'העלאת קובצי הריליס',
  FINAL_ASSET_VERIFY: 'אימות קובצי הריליס ביעד',
  FINAL_RUNTIME_CONFIG_VERIFY: 'אימות Runtime Config סופי',
  FINAL_INDEX_COMMIT: 'העלאת index.html (אחרון)',
  FINAL_INDEX_VERIFY: 'אימות index.html וההפניות שלו',
  FINAL_APP_SMOKE: 'בדיקת Smoke לאפליקציה',
  COMPLETE: 'סיום הפריסה',
});

/**
 * Older builds used a coarser stage vocabulary. Stored runs must keep rendering,
 * so every historical key resolves onto a canonical stage.
 */
export const LEGACY_STAGE_ALIASES = Object.freeze({
  JOB_CREATED: STAGE.RELEASE_VALIDATE,
  RELEASE_VALIDATED: STAGE.RELEASE_VALIDATE,
  RUNTIME_CONFIG: STAGE.RUNTIME_CONFIG_CREATE,
  MANIFEST: STAGE.MANIFEST_CREATE,
  DEPLOYER_INIT: STAGE.BROWSER_ACTIVATE,
  TARGET_VALIDATION: STAGE.TARGET_VALIDATE,
  FORM_DIGEST: STAGE.SHAREPOINT_CONTEXTINFO,
  LIBRARIES: STAGE.CREATE_LIBRARIES,
  PREDEPLOY_BACKUP: STAGE.PRE_DEPLOY_BACKUP,
  BACKUP: STAGE.PRE_DEPLOY_BACKUP,
  FOLDERS: STAGE.CREATE_FOLDERS,
  SEED_FILES: STAGE.CREATE_TXT_SEEDS,
  RELEASE_FILES: STAGE.FINAL_ASSET_COPY,
  RUNTIME_CONFIG_VERIFY: STAGE.FINAL_RUNTIME_CONFIG_VERIFY,
  FINAL_VERIFY: STAGE.FINAL_INDEX_VERIFY,
});

/** LOCAL_AUDIT is an optional side-check and deliberately outside the pipeline. */
export const SIDE_STAGES = Object.freeze(['LOCAL_AUDIT']);

export function canonicalStage(stage) {
  const key = String(stage || '').trim().toUpperCase();
  if (!key) return '';
  if (STAGE[key]) return key;
  if (SIDE_STAGES.includes(key)) return key;
  return LEGACY_STAGE_ALIASES[key] || key;
}

export function stageIndex(stage) {
  return STAGE_ORDER.indexOf(canonicalStage(stage));
}

export function stageLabel(stage) {
  const key = canonicalStage(stage);
  return STAGE_LABELS[key] || key || '';
}

/** True when `candidate` is at or after `reference` in the canonical pipeline. */
export function stageAtOrAfter(candidate, reference) {
  const a = stageIndex(candidate);
  const b = stageIndex(reference);
  if (a < 0 || b < 0) return false;
  return a >= b;
}
