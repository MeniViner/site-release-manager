/**
 * The single SharePoint deployment pipeline.
 *
 * Both entry points run this code:
 *   - the in-page Release Manager worker (the normal path), and
 *   - the standalone SharePoint Deployer (diagnostic / cross-host fallback).
 *
 * Keeping one implementation is deliberate: a second copy of the provisioning
 * sequence is exactly how the eventual-consistency handling drifted out of the
 * fallback path before.
 *
 * Everything environment-specific is injected, so this module has no DOM, no
 * network and no crypto dependency of its own.
 */

import { STAGE, stageLabel } from './deploymentStages.js';
import { createSharePointClient } from './sharepointClient.js';
import {
  ensureExactLibrary, ensureFolderTree, ensureTxtSeeds,
  uploadReleaseAssets, finalAppSmoke, createTxtBackup,
  verifyFinalRuntimeConfig, BACKUP_OUTCOME,
} from './sharepointProvisioning.js';
import { classifySharePointError, SP_ERROR } from './sharepointErrors.js';

const HEARTBEAT_MS = 30_000;

/**
 * SharePoint FormDigest values expire. A long asset copy can outlive one, so the
 * digest is refreshed well inside SharePoint's default lifetime rather than
 * being captured once at the start of the run.
 */
const DIGEST_REFRESH_MS = 10 * 60 * 1000;

/**
 * API codes that mean "this worker no longer owns the run". They are terminal:
 * the worker MUST stop touching SharePoint immediately, because someone else
 * either took the run over or settled it.
 */
const OWNERSHIP_LOST_CODES = new Set(['LEASE_LOST', 'LEASE_HELD', 'LEASE_RACE', 'NO_LEASE', 'JOB_SETTLED']);

export class OwnershipLostError extends Error {
  constructor(apiCode, message) {
    super(message || 'הריצה כבר אינה בבעלות ה-worker הזה.');
    this.name = 'OwnershipLostError';
    this.apiCode = apiCode;
    this.cancelled = true;
    this.errorClass = 'PERMANENT_FAILURE';
  }
}

/** Normalize any thrown value into the diagnostics the Runs UI renders. */
export function describeFailure(error, stage) {
  const normalized = error?.sharePoint || classifySharePointError({
    httpStatus: error?.httpStatus,
    body: error?.responseBody ?? null,
    operation: error?.operation || '',
    url: error?.url,
    method: error?.method,
    cause: error,
  });
  return {
    stage: error?.stage || stage,
    message: error?.message || 'SharePoint deployment failed.',
    errorClass: error?.errorClass || normalized.errorClass || SP_ERROR.UNKNOWN,
    httpStatus: normalized.httpStatus ?? error?.httpStatus ?? null,
    sharePointCode: normalized.sharePointCode || '',
    sharePointExceptionType: normalized.sharePointExceptionType || '',
    operation: normalized.operation || error?.operation || '',
    target: normalized.target || error?.target || '',
    url: normalized.url || error?.url || '',
    method: normalized.method || '',
    attempt: error?.attempts ?? null,
    nextAction: normalized.nextAction || '',
    details: {
      code: error?.code || '',
      responsePreview: normalized.responsePreview || '',
      retryHistory: error?.retryHistory ? JSON.stringify(error.retryHistory.slice(-6)) : '',
      stabilizeHistory: error?.stabilizeHistory ? JSON.stringify(error.stabilizeHistory.slice(-6)) : '',
      expectedSize: error?.expectedSize ?? '',
      expectedSha256: error?.expectedSha256 ?? '',
      actualRoot: error?.actualRoot ?? '',
    },
  };
}

/**
 * @param {object} options
 * @param {string}   options.jobId
 * @param {Function} options.apiCall      (path, init, leaseId) => parsed body; throws with .httpStatus/.apiCode
 * @param {Function} options.fetchImpl    credentialed fetch for SharePoint
 * @param {Function} options.sha256       (bytes) => hex
 * @param {Function} options.createLibraryExact  (webUrl) => async ({title,urlSegment}) => created
 * @param {string}   options.hostname     the page's hostname, for target validation
 * @param {string}   options.clientId     stable per-tab worker identity
 * @param {Function} [options.onProgress]
 * @param {Function} [options.setTimer] / [options.clearTimer]
 * @param {AbortSignal} [options.signal]
 * @param {object} [options.retry]  retry/stabilization overrides. Production uses
 *   the defaults; tests inject an instant clock so the real control flow runs at
 *   zero wall-clock cost.
 */
export async function runDeploymentPipeline(options) {
  const {
    jobId, apiCall, fetchImpl, sha256, createLibraryExact,
    hostname, clientId, signal,
    retry = {},
    onProgress = () => {},
    setTimer = null,
    clearTimer = null,
  } = options;

  let stage = STAGE.BROWSER_ACTIVATE;
  let leaseId = '';
  let heartbeat = null;

  // Losing ownership aborts every in-flight SharePoint request, so a superseded
  // worker cannot keep mutating the target behind the new owner's back.
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const abortOnOwnershipLoss = (error) => {
    if (OWNERSHIP_LOST_CODES.has(error?.apiCode)) {
      ownershipLost = ownershipLost || new OwnershipLostError(error.apiCode, error.message);
      controller?.abort();
      return true;
    }
    return false;
  };
  let ownershipLost = null;
  if (signal) signal.addEventListener?.('abort', () => controller?.abort(), { once: true });
  const effectiveSignal = controller ? controller.signal : signal;
  const assertOwned = () => { if (ownershipLost) throw ownershipLost; };

  const send = (path, init) => apiCall(path, init, leaseId).catch((error) => {
    abortOnOwnershipLoss(error);
    throw error;
  });
  const post = (path, body) => send(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const reportEvent = async (eventStage, status, message, extra = {}) => {
    try {
      await post(`/api/deployments/${encodeURIComponent(jobId)}/event`, {
        stage: eventStage,
        stageLabel: stageLabel(eventStage),
        status,
        source: 'release-manager-browser-worker',
        message,
        currentFile: extra.currentFile || '',
        operation: extra.operation || '',
        target: extra.target || '',
        method: extra.method || '',
        url: extra.url || '',
        httpStatus: extra.httpStatus ?? null,
        attempt: extra.attempt ?? null,
        durationMs: extra.durationMs ?? null,
        errorClass: extra.errorClass || '',
        sharePointCode: extra.sharePointCode || '',
        sharePointExceptionType: extra.sharePointExceptionType || '',
        nextAction: extra.nextAction || '',
        details: extra.details || null,
      });
    } catch (error) {
      // Telemetry failures must not abort a healthy deployment — but losing the
      // lease is not a telemetry failure, it means this worker must stop.
      if (abortOnOwnershipLoss(error)) throw ownershipLost;
    }
  };

  const reportProgress = async (progress, message, currentFile = '', progressStage = '') => {
    onProgress({ progress, message, currentFile, stage: progressStage || stage });
    await post(`/api/deployments/${encodeURIComponent(jobId)}/progress`, { progress, message, currentFile, stage: progressStage || stage });
  };

  const log = async (entry) => {
    await reportEvent(entry.stage || stage, entry.status || 'info', entry.message || '', {
      target: entry.target || '',
      attempt: entry.details?.attempt ?? null,
      errorClass: entry.details?.errorClass || '',
      sharePointCode: entry.details?.sharePointCode || '',
      details: entry.details || null,
    });
  };

  try {
    // --- Exclusive ownership BEFORE any SharePoint mutation ----------------
    const claim = await post(`/api/deployments/${encodeURIComponent(jobId)}/claim`, { clientId });
    leaseId = claim.leaseId;
    if (setTimer) {
      heartbeat = setTimer(() => {
        // A rejected heartbeat means the lease was taken or the job was settled.
        send(`/api/deployments/${encodeURIComponent(jobId)}/heartbeat`, { method: 'POST' }).catch(() => {});
      }, HEARTBEAT_MS);
    }

    const descriptor = await send(`/api/deployments/${encodeURIComponent(jobId)}`, {});
    const { site, manifest } = descriptor;
    const resumed = (claim.completedStages || []).length > 0;
    await reportEvent(STAGE.BROWSER_ACTIVATE, 'success',
      resumed
        ? `מנוע הפריסה ממשיך ריצה קיימת מהשלב ${stageLabel(claim.resumeFrom)}.`
        : 'מנוע הפריסה נטען עם בעלות בלעדית על הריצה.',
      { details: { resumeFrom: claim.resumeFrom, completedStages: (claim.completedStages || []).join(',') } });

    // --- TARGET_VALIDATE ---------------------------------------------------
    stage = STAGE.TARGET_VALIDATE;
    if (String(hostname).toLowerCase() !== String(site.host).toLowerCase()) {
      const error = new Error(
        `הפריסה רצה ב-${hostname} אבל אתר היעד נמצא ב-${site.host}. `
        + 'פריסה מאומתת חייבת לרוץ מתוך ה-Host של היעד.',
      );
      error.stage = stage;
      error.errorClass = SP_ERROR.AUTH_FAILURE;
      throw error;
    }
    await reportEvent(stage, 'success', `ה-Host תואם ליעד ${site.host}.`, { target: site.finalDistRoot });

    const webUrl = `https://${site.host}${site.siteRoot}`;

    // --- SHAREPOINT_CONTEXTINFO -------------------------------------------
    stage = STAGE.SHAREPOINT_CONTEXTINFO;
    await reportEvent(stage, 'started', 'מבקש FormDigest מ-SharePoint.');
    const bootstrap = createSharePointClient({ webUrl, fetchImpl, signal: effectiveSignal });
    let digest = await bootstrap.getContextInfo();
    let digestAt = Date.now();
    await reportEvent(stage, 'success', 'SharePoint החזיר FormDigest תקין.');

    const getDigest = async () => {
      assertOwned();
      if (Date.now() - digestAt > DIGEST_REFRESH_MS) {
        digest = await bootstrap.getContextInfo();
        digestAt = Date.now();
      }
      return digest;
    };
    const client = createSharePointClient({ webUrl, fetchImpl, getDigest, signal: effectiveSignal });

    // --- LIBRARY_DISCOVERY / CREATE_LIBRARIES / LIBRARY_STABILIZE ---------
    stage = STAGE.LIBRARY_DISCOVERY;
    await reportProgress(42, 'בודק ספריות מסמכים', '', stage);
    await reportEvent(STAGE.LIBRARY_DISCOVERY, 'started', 'מאתר את ספריות המסמכים המוגדרות.');

    const makeLibrary = createLibraryExact(webUrl);
    const libraryResults = [];
    for (const spec of descriptor.libraries) {
      // Sequential on purpose: SharePoint list creation is not safely concurrent.
      // eslint-disable-next-line no-await-in-loop
      const created = await ensureExactLibrary(client, spec, { createLibraryExact: makeLibrary, log, signal: effectiveSignal, retry });
      libraryResults.push({ title: spec.title, outcome: created.outcome, rootFolder: created.library.rootFolder });
    }
    await reportEvent(STAGE.LIBRARY_DISCOVERY, 'success', 'כל ספריות המסמכים אותרו או נוצרו.', { details: { libraries: JSON.stringify(libraryResults) } });
    await reportEvent(STAGE.CREATE_LIBRARIES, 'success',
      libraryResults.every((item) => item.outcome === 'REUSED_EXISTING_EXACT_LIBRARY')
        ? 'כל הספריות כבר היו קיימות ולא נוצרו מחדש.'
        : 'ספריות חסרות נוצרו בנתיב המדויק שהוגדר.',
      { details: { libraries: JSON.stringify(libraryResults) } });
    await reportEvent(STAGE.LIBRARY_STABILIZE, 'success', 'כל הספריות אומתו כיציבות מול SharePoint.');

    // --- PRE_DEPLOY_BACKUP -------------------------------------------------
    // This is deliberately best-effort. It runs after exact libraries are
    // stable and before folders, seeds or release assets can mutate the target.
    stage = STAGE.PRE_DEPLOY_BACKUP;
    await reportProgress(48, 'מנסה ליצור גיבוי TXT לפני הפריסה', '', stage);
    await reportEvent(stage, 'started', 'בודק אם יש נתוני TXT קיימים לגיבוי לפני הפריסה.');
    const backupPersistenceWarnings = [];
    let existingBackup = null;
    try {
      const persisted = await post(`/api/deployments/${encodeURIComponent(jobId)}/backup/start`, {
        startedAt: new Date().toISOString(),
      });
      existingBackup = persisted?.reused && persisted?.backup?.outcome !== 'IN_PROGRESS'
        ? persisted.backup
        : null;
    } catch (error) {
      if (abortOnOwnershipLoss(error)) throw ownershipLost;
      backupPersistenceWarnings.push(`start metadata: ${error?.message || String(error)}`);
    }

    let backup = existingBackup;
    if (!backup) {
      if (site.storageBackend !== 'txt') {
        const now = new Date().toISOString();
        backup = {
          outcome: BACKUP_OUTCOME.SKIPPED_UNSUPPORTED_BACKEND,
          strategy: 'MONGO_NOT_IMPLEMENTED',
          trigger: 'PRE_DEPLOY',
          startedAt: now,
          finishedAt: now,
          backupPath: '',
          backupUrl: '',
          fileCount: 0,
          copiedFiles: [],
          skippedFiles: [],
          failedFiles: [],
          totalSizeBytes: 0,
          verificationStatus: 'NOT_APPLICABLE',
          warningDetails: ['Mongo backup strategy is intentionally not implemented yet.'],
        };
      } else {
        try {
          backup = await createTxtBackup(client, {
            sourceFiles: descriptor.seedFiles,
            siteAssetsRoot: site.siteAssetsRoot,
            host: site.host,
            libraryRoots: descriptor.libraries.map((library) => library.rootFolder),
            sha256,
            retry,
            signal: effectiveSignal,
            log,
          });
        } catch (error) {
          if (error?.cancelled) throw error;
          const now = new Date().toISOString();
          backup = {
            outcome: BACKUP_OUTCOME.FAILED,
            strategy: 'SHAREPOINT_TXT_FILES',
            trigger: 'PRE_DEPLOY',
            startedAt: now,
            finishedAt: now,
            backupPath: '',
            backupUrl: '',
            fileCount: descriptor.seedFiles.length,
            copiedFiles: [],
            skippedFiles: [],
            failedFiles: [{ operation: 'backup', error: error?.message || String(error) }],
            totalSizeBytes: 0,
            verificationStatus: 'FAILED',
            warningDetails: ['The backup attempt failed before it could finish.'],
          };
        }
      }

      try {
        const persisted = await post(`/api/deployments/${encodeURIComponent(jobId)}/backup/finish`, backup);
        if (persisted?.backup) backup = persisted.backup;
      } catch (error) {
        if (abortOnOwnershipLoss(error)) throw ownershipLost;
        backupPersistenceWarnings.push(`finish metadata: ${error?.message || String(error)}`);
      }
    }

    const backupIsWarning = [BACKUP_OUTCOME.PARTIAL, BACKUP_OUTCOME.FAILED].includes(backup.outcome);
    const copiedCount = Array.isArray(backup.copiedFiles) ? backup.copiedFiles.length : Number(backup.copiedCount || 0);
    const skippedCount = Array.isArray(backup.skippedFiles) ? backup.skippedFiles.length : Number(backup.skippedCount || 0);
    const failedCount = Array.isArray(backup.failedFiles) ? backup.failedFiles.length : Number(backup.failedCount || 0);
    const backupMessage = backup.outcome === BACKUP_OUTCOME.SKIPPED_FRESH_TARGET
      ? 'זהו יעד לוגי חדש ללא קובצי TXT קיימים; גיבוי מקדים לא נדרש.'
      : backup.outcome === BACKUP_OUTCOME.SKIPPED_UNSUPPORTED_BACKEND
        ? 'גיבוי מקדים דולג: אסטרטגיית גיבוי Mongo טרם מומשה.'
        : `תוצאת הגיבוי: ${backup.outcome} — הועתקו ${copiedCount}, חסרים/דולגו ${skippedCount}, נכשלו ${failedCount}.`;
    await reportEvent(stage, backupIsWarning ? 'warning' : 'success', backupMessage, {
      target: backup.backupPath || site.siteAssetsRoot,
      nextAction: backupIsWarning ? 'הפריסה ממשיכה כרגיל; בדוק את פירוט הגיבוי לאחר סיום הריצה.' : '',
      details: {
        backupOutcome: backup.outcome,
        backupPath: backup.backupPath || '',
        backupUrl: backup.backupUrl || '',
        copiedCount,
        skippedCount,
        failedCount,
        totalSizeBytes: backup.totalSizeBytes || 0,
        verificationStatus: backup.verificationStatus || '',
        persistenceWarnings: backupPersistenceWarnings.join(' | '),
        nonBlocking: true,
      },
    });

    // --- CREATE_FOLDERS / FOLDER_STABILIZE --------------------------------
    stage = STAGE.CREATE_FOLDERS;
    await reportProgress(52, 'יוצר ומייצב תיקיות', '', stage);
    await reportEvent(STAGE.CREATE_FOLDERS, 'started', 'יוצר את היררכיית התיקיות הנדרשת.');
    const folderResults = await ensureFolderTree(client, descriptor.folders, {
      log, signal: effectiveSignal, retry, libraryRoots: descriptor.libraries.map((library) => library.rootFolder),
    });
    const createdFolders = folderResults.filter((entry) => entry.created).length;
    await reportEvent(STAGE.CREATE_FOLDERS, 'success', `${folderResults.length} תיקיות קיימות/נוצרו (${createdFolders} חדשות).`);
    await reportEvent(STAGE.FOLDER_STABILIZE, 'success', 'כל התיקיות אומתו ככתיבות מול SharePoint.');

    // --- CREATE_TXT_SEEDS --------------------------------------------------
    stage = STAGE.CREATE_TXT_SEEDS;
    await reportProgress(60, 'בודק קובצי TXT', '', stage);
    await reportEvent(stage, 'started', 'בודק קובצי TXT; קבצים קיימים לא ישונו.');
    const seedResults = await ensureTxtSeeds(client, descriptor.seedFiles, { log, signal: effectiveSignal, retry, sha256 });
    const preserved = seedResults.filter((entry) => entry.action === 'preserved').length;
    const created = seedResults.filter((entry) => entry.action === 'created').length;
    await reportEvent(stage, 'success', `קובצי TXT: ${preserved} נשמרו ללא שינוי, ${created} נוצרו ואומתו.`, {
      details: { preserved, created, files: seedResults.map((entry) => `${entry.action}:${entry.path}`).join(' | ') },
    });

    // --- PERMISSIONS_SETUP -------------------------------------------------
    // Release Manager deliberately does NOT change SharePoint role assignments.
    // The boundary is reported instead of being silently assumed.
    stage = STAGE.PERMISSIONS_SETUP;
    const marker = await client.readFile(descriptor.permissionsMarker).catch(() => ({ found: false }));
    await reportEvent(stage, marker.found ? 'success' : 'warning',
      marker.found
        ? 'הגדרת ההרשאות של Site Builder כבר בוצעה ליעד הזה.'
        : 'הרשאות Site Builder טרם הוגדרו ליעד הזה. Release Manager אינו משנה הרשאות SharePoint; יש להריץ את מסך ההרשאות ב-Site Builder.',
      {
        target: descriptor.permissionsMarker,
        nextAction: marker.found ? '' : 'הרץ את הגדרת ההרשאות מתוך Site Builder לאחר הפריסה.',
        details: { markerPresent: marker.found, managedByReleaseManager: false },
      });

    // --- FINAL_ASSET_COPY .. FINAL_INDEX_VERIFY ---------------------------
    stage = STAGE.FINAL_ASSET_COPY;
    await reportEvent(stage, 'started', 'מעלה את קובצי הריליס; index.html יעלה אחרון.');
    const verifiedBuffer = [];
    const flushVerified = async () => {
      if (!verifiedBuffer.length) return;
      const paths = verifiedBuffer.splice(0, verifiedBuffer.length);
      try { await post(`/api/deployments/${encodeURIComponent(jobId)}/verified-asset`, { paths }); } catch { /* resume optimisation only */ }
    };

    let runtimeVerification = null;
    const result = await uploadReleaseAssets(client, manifest, {
      log, signal: effectiveSignal, retry, sha256, distRoot: site.finalDistRoot,
      alreadyVerified: new Set(claim.verifiedAssets || []),
      downloadFile: (file) => options.downloadFile(file),
      onProgress: async ({ index, total, filePath }) => {
        assertOwned();
        const progress = 65 + Math.round(((index + 1) / Math.max(1, total)) * 22);
        await reportProgress(progress, `מעלה ${index + 1}/${total}`, filePath, STAGE.FINAL_ASSET_COPY);
      },
      // Only a file that has been uploaded AND verified at the target is
      // recorded, so a later resume can never skip a file that was never written.
      onVerified: async (filePath) => {
        verifiedBuffer.push(filePath);
        if (verifiedBuffer.length >= 20) await flushVerified();
      },
      // Runtime config is a non-index asset. Verify it through the exact direct
      // URL Site Builder will request before activating the new index.html.
      beforeCommit: async () => {
        await flushVerified();
        await reportEvent(STAGE.FINAL_ASSET_COPY, 'success', 'כל קובצי הריליס שאינם index.html הועלו.');
        await reportEvent(STAGE.FINAL_ASSET_VERIFY, 'success', 'כל הקבצים שאינם index.html אומתו ביעד לפי גודל ו-SHA-256.');
        stage = STAGE.FINAL_RUNTIME_CONFIG_VERIFY;
        await reportProgress(90, 'מאמת Runtime Config סופי', descriptor.runtimeVerification.runtimeConfigFile, stage);
        await reportEvent(stage, 'started', 'קורא את Runtime Config ו-Deployment Metadata מהכתובות המדויקות שהאפליקציה תבקש.');
        runtimeVerification = await verifyFinalRuntimeConfig(fetchImpl, descriptor.runtimeVerification, {
          retry,
          signal: effectiveSignal,
        });
        await reportEvent(stage, 'success', 'Runtime Config הסופי קריא, תקין ושייך לריצה וליעד הלוגי הנוכחיים.', {
          target: runtimeVerification.runtimeConfigUrl,
          method: 'GET',
          url: runtimeVerification.runtimeConfigUrl,
          httpStatus: runtimeVerification.runtimeStatus,
          details: runtimeVerification,
        });
      },
    });
    await flushVerified();

    stage = STAGE.FINAL_INDEX_COMMIT;
    await reportEvent(STAGE.FINAL_INDEX_COMMIT, 'success', 'index.html הועלה אחרון ואומת.', { details: { indexSha256: result.indexSha256 } });
    await reportEvent(STAGE.FINAL_INDEX_VERIFY, 'success', `כל ${result.referencesVerified} ההפניות מתוך index.html אומתו ביעד.`);

    // --- FINAL_APP_SMOKE ---------------------------------------------------
    stage = STAGE.FINAL_APP_SMOKE;
    await reportProgress(95, 'בודק את האפליקציה הסופית', '', stage);
    const smoke = await finalAppSmoke(client, site.finalDistRoot, {
      signal: effectiveSignal,
      retry,
      fetchImpl,
      finalUrl: site.finalUrl,
      runtimeVerification,
    });
    if (!smoke.ok) {
      const error = new Error('בדיקת ה-Smoke נכשלה: האפליקציה הסופית או Runtime Config שלה אינם ניתנים לטעינה.');
      error.stage = stage;
      error.errorClass = SP_ERROR.PERMANENT_FAILURE;
      throw error;
    }
    await reportEvent(stage, 'success', 'STATIC PASS — index.html הסופי נטען ומכיל את ההפניות הצפויות.', { details: smoke });

    // --- COMPLETE ----------------------------------------------------------
    stage = STAGE.COMPLETE;
    await post(`/api/deployments/${encodeURIComponent(jobId)}/complete`, {
      finalUrl: site.finalUrl,
      completedAt: new Date().toISOString(),
      verification: {
        referencesVerified: result.referencesVerified,
        indexSha256: result.indexSha256,
        libraries: libraryResults,
        seeds: { preserved, created },
        backup,
        runtimeConfig: runtimeVerification,
        smoke,
      },
    });
    onProgress({ progress: 100, stage, message: 'הפריסה הושלמה בהצלחה' });
    return {
      ok: true,
      finalUrl: site.finalUrl,
      libraries: libraryResults,
      seeds: { preserved, created },
      backup,
      runtimeConfig: runtimeVerification,
    };
  } catch (error) {
    const failure = describeFailure(error, stage);
    try {
      await post(`/api/deployments/${encodeURIComponent(jobId)}/fail`, {
        ...failure,
        error: failure.message,
        stageLabel: stageLabel(failure.stage),
      });
    } catch {
      // The run is already failing; a failed failure report must not mask it.
    }
    error.failureInfo = failure;
    throw error;
  } finally {
    if (heartbeat && clearTimer) clearTimer(heartbeat);
    if (leaseId) {
      send(`/api/deployments/${encodeURIComponent(jobId)}/release-lease`, { method: 'POST' }).catch(() => {});
    }
  }
}
