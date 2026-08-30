/**
 * In-browser SharePoint deployment engine.
 *
 * Runs inside the authenticated SharePoint page — this is the ONLY component
 * that performs SharePoint mutations. Node prepares the bytes and records the
 * telemetry; the browser owns cookies, FormDigest, REST and JSOM.
 *
 * All provisioning semantics live in shared/, so the exact code path executed
 * here is the one covered by the Node test-suite against a simulated
 * eventually-consistent farm.
 */

import { resolveApiUrl } from './api.js';
import { STAGE, stageLabel } from '../../shared/deploymentStages.js';
import { createSharePointClient } from '../../shared/sharepointClient.js';
import {
  ensureExactLibrary, ensureFolderTree, ensureTxtSeeds,
  uploadReleaseAssets, finalAppSmoke, ProvisioningError,
} from '../../shared/sharepointProvisioning.js';
import { classifySharePointError, SP_ERROR } from '../../shared/sharepointErrors.js';
import { sha256Hex, createExactLibraryViaJsom, workerClientId } from './sharepoint/browserAdapters.js';

const HEARTBEAT_MS = 30_000;

function apiUrl(path) { return resolveApiUrl(path); }

async function jsonApi(path, options = {}, leaseId = '') {
  const headers = { ...(options.headers || {}) };
  if (leaseId) headers['X-SRM-Lease'] = leaseId;
  const response = await fetch(apiUrl(path), { ...options, headers });
  const text = await response.text();
  let body = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  if (!response.ok) {
    const error = new Error(typeof body === 'string' ? body : body?.error || `HTTP ${response.status}`);
    error.httpStatus = response.status;
    error.apiCode = body?.code || '';
    error.url = apiUrl(path);
    throw error;
  }
  return body;
}

/** Per-run reporter. Every stage event lands durably in Mongo. */
function createReporter(jobId, leaseId) {
  return {
    async event(stage, status, message, extra = {}) {
      try {
        await jsonApi(`/api/deployments/${encodeURIComponent(jobId)}/event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stage,
            stageLabel: stageLabel(stage),
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
          }),
        }, leaseId);
      } catch (error) {
        // Telemetry must never abort a deployment that is otherwise healthy.
        console.warn('[release-manager][sharepoint-engine] telemetry failed', error);
      }
    },
    async progress(progress, message, currentFile = '', stage = '') {
      await jsonApi(`/api/deployments/${encodeURIComponent(jobId)}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progress, message, currentFile, stage }),
      }, leaseId);
    },
    async recordVerified(paths) {
      if (!paths?.length) return;
      try {
        await jsonApi(`/api/deployments/${encodeURIComponent(jobId)}/verified-asset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths }),
        }, leaseId);
      } catch { /* resume optimisation only */ }
    },
  };
}

/** Turn any thrown value into the structured diagnostics the Runs UI renders. */
function describeFailure(error, stage) {
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
 * Deploy one job.
 *
 * The whole pipeline is idempotent: stages already verified in a previous
 * attempt are detected and skipped, so a reload or a retry resumes rather than
 * restarting.
 */
export async function deploySharePointJob(jobId, { onProgress = () => {}, signal } = {}) {
  let stage = STAGE.BROWSER_ACTIVATE;
  let leaseId = '';
  let heartbeat = null;
  let reporter = createReporter(jobId, '');

  try {
    // --- Claim exclusive ownership before touching SharePoint ---------------
    const claim = await jsonApi(`/api/deployments/${encodeURIComponent(jobId)}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: workerClientId() }),
    });
    leaseId = claim.leaseId;
    reporter = createReporter(jobId, leaseId);
    heartbeat = window.setInterval(() => {
      jsonApi(`/api/deployments/${encodeURIComponent(jobId)}/heartbeat`, { method: 'POST' }, leaseId).catch(() => {});
    }, HEARTBEAT_MS);

    const descriptor = await jsonApi(`/api/deployments/${encodeURIComponent(jobId)}`);
    const { site, manifest } = descriptor;
    const resumed = (claim.completedStages || []).length > 0;
    await reporter.event(STAGE.BROWSER_ACTIVATE, 'success',
      resumed
        ? `מנוע הפריסה ממשיך ריצה קיימת מהשלב ${stageLabel(claim.resumeFrom)}.`
        : 'מנוע הפריסה בדפדפן נטען עם בעלות בלעדית על הריצה.',
      { details: { resumeFrom: claim.resumeFrom, completedStages: (claim.completedStages || []).join(','), attempt: claim.attempt } });

    // --- TARGET_VALIDATE ---------------------------------------------------
    stage = STAGE.TARGET_VALIDATE;
    if (window.location.hostname.toLowerCase() !== String(site.host).toLowerCase()) {
      const error = new Error(
        `Release Manager פתוח ב-${window.location.hostname} אבל אתר היעד נמצא ב-${site.host}. `
        + 'פריסה מאומתת חייבת לרוץ מתוך ה-Host של היעד.',
      );
      error.stage = stage;
      error.errorClass = SP_ERROR.AUTH_FAILURE;
      throw error;
    }
    await reporter.event(stage, 'success', `ה-Host תואם ליעד ${site.host}.`, { target: site.targetDistPath });

    const webUrl = `https://${site.host}${site.siteRoot}`;

    // --- SHAREPOINT_CONTEXTINFO -------------------------------------------
    stage = STAGE.SHAREPOINT_CONTEXTINFO;
    await reporter.event(stage, 'started', 'מבקש FormDigest מ-SharePoint.');
    let digest = '';
    const bootstrap = createSharePointClient({ webUrl, fetchImpl: fetch.bind(window), signal });
    digest = await bootstrap.getContextInfo();
    await reporter.event(stage, 'success', 'SharePoint החזיר FormDigest תקין.');

    const client = createSharePointClient({
      webUrl,
      fetchImpl: fetch.bind(window),
      getDigest: async () => digest,
      signal,
    });

    /** Stage-aware structured logger handed to the shared provisioning layer. */
    const log = async (entry) => {
      await reporter.event(entry.stage || stage, entry.status || 'info', entry.message || '', {
        target: entry.target || '',
        attempt: entry.details?.attempt ?? null,
        errorClass: entry.details?.errorClass || '',
        sharePointCode: entry.details?.sharePointCode || '',
        details: entry.details || null,
      });
    };

    // --- LIBRARY_DISCOVERY / CREATE_LIBRARIES / LIBRARY_STABILIZE ----------
    stage = STAGE.LIBRARY_DISCOVERY;
    onProgress({ progress: 42, stage, message: 'בודק ספריות מסמכים' });
    await reporter.progress(42, 'בודק ספריות מסמכים', '', stage);
    await reporter.event(STAGE.LIBRARY_DISCOVERY, 'started', 'מאתר את ספריות המסמכים המוגדרות.');

    const createLibraryExact = createExactLibraryViaJsom(webUrl);
    const libraryResults = [];
    for (const spec of descriptor.libraries) {
      // Sequential on purpose: SharePoint list creation is not safely concurrent.
      // eslint-disable-next-line no-await-in-loop
      const result = await ensureExactLibrary(client, spec, { createLibraryExact, log, signal });
      libraryResults.push({ title: spec.title, outcome: result.outcome, rootFolder: result.library.rootFolder });
    }
    await reporter.event(STAGE.LIBRARY_DISCOVERY, 'success', 'כל ספריות המסמכים אותרו או נוצרו.', { details: { libraries: JSON.stringify(libraryResults) } });
    await reporter.event(STAGE.CREATE_LIBRARIES, 'success',
      libraryResults.every((item) => item.outcome === 'REUSED_EXISTING_EXACT_LIBRARY')
        ? 'כל הספריות כבר היו קיימות ולא נוצרו מחדש.'
        : 'ספריות חסרות נוצרו בנתיב המדויק שהוגדר.',
      { details: { libraries: JSON.stringify(libraryResults) } });
    await reporter.event(STAGE.LIBRARY_STABILIZE, 'success', 'כל הספריות אומתו כיציבות מול SharePoint.');

    // --- CREATE_FOLDERS / FOLDER_STABILIZE --------------------------------
    stage = STAGE.CREATE_FOLDERS;
    onProgress({ progress: 52, stage, message: 'יוצר ומייצב תיקיות' });
    await reporter.progress(52, 'יוצר ומייצב תיקיות', '', stage);
    await reporter.event(STAGE.CREATE_FOLDERS, 'started', 'יוצר את היררכיית התיקיות הנדרשת.');
    const folderResults = await ensureFolderTree(client, descriptor.folders, {
      log, signal, libraryRoots: descriptor.libraries.map((library) => library.rootFolder),
    });
    const createdFolders = folderResults.filter((entry) => entry.created).length;
    await reporter.event(STAGE.CREATE_FOLDERS, 'success', `${folderResults.length} תיקיות קיימות/נוצרו (${createdFolders} חדשות).`);
    await reporter.event(STAGE.FOLDER_STABILIZE, 'success', 'כל התיקיות אומתו ככתיבות מול SharePoint.');

    // --- CREATE_TXT_SEEDS --------------------------------------------------
    stage = STAGE.CREATE_TXT_SEEDS;
    onProgress({ progress: 60, stage, message: 'בודק קובצי TXT' });
    await reporter.progress(60, 'בודק קובצי TXT', '', stage);
    await reporter.event(stage, 'started', 'בודק קובצי TXT; קבצים קיימים לא ישונו.');
    const seedResults = await ensureTxtSeeds(client, descriptor.seedFiles, { log, signal, sha256: sha256Hex });
    const preserved = seedResults.filter((entry) => entry.action === 'preserved').length;
    const created = seedResults.filter((entry) => entry.action === 'created').length;
    await reporter.event(stage, 'success', `קובצי TXT: ${preserved} נשמרו ללא שינוי, ${created} נוצרו ואומתו.`, {
      details: { preserved, created, files: seedResults.map((entry) => `${entry.action}:${entry.path}`).join(' | ') },
    });

    // --- PERMISSIONS_SETUP -------------------------------------------------
    // Release Manager deliberately does NOT change SharePoint role assignments.
    // It reports whether Site Builder's permissions setup has been run so the
    // boundary is explicit rather than silently assumed.
    stage = STAGE.PERMISSIONS_SETUP;
    const marker = await client.readFile(descriptor.permissionsMarker).catch(() => ({ found: false }));
    await reporter.event(stage, marker.found ? 'success' : 'warning',
      marker.found
        ? 'הגדרת ההרשאות של Site Builder כבר בוצעה ליעד הזה.'
        : 'הרשאות Site Builder טרם הוגדרו ליעד הזה. Release Manager אינו משנה הרשאות SharePoint; יש להריץ את מסך ההרשאות ב-Site Builder.',
      {
        target: descriptor.permissionsMarker,
        nextAction: marker.found ? '' : 'הרץ את הגדרת ההרשאות מתוך Site Builder לאחר הפריסה.',
        details: { markerPresent: marker.found, managedByReleaseManager: false },
      });

    // --- FINAL_ASSET_COPY / VERIFY / INDEX COMMIT / INDEX VERIFY ----------
    stage = STAGE.FINAL_ASSET_COPY;
    await reporter.event(stage, 'started', 'מעלה את קובצי הריליס; index.html יעלה אחרון.');
    const alreadyVerified = new Set(claim.verifiedAssets || []);
    const verifiedNow = [];

    const result = await uploadReleaseAssets(client, manifest, {
      log, signal, sha256: sha256Hex, distRoot: site.finalDistRoot,
      alreadyVerified,
      downloadFile: async (file) => downloadStagedFile(jobId, file),
      onProgress: async ({ index, total, filePath }) => {
        const progress = 65 + Math.round(((index + 1) / Math.max(1, total)) * 22);
        onProgress({ progress, stage: STAGE.FINAL_ASSET_COPY, message: `מעלה ${index + 1}/${total}`, currentFile: filePath });
        await reporter.progress(progress, `מעלה ${index + 1}/${total}`, filePath, STAGE.FINAL_ASSET_COPY);
        verifiedNow.push(filePath);
        if (verifiedNow.length >= 20) {
          await reporter.recordVerified(verifiedNow.splice(0, verifiedNow.length));
        }
      },
    });
    await reporter.recordVerified(verifiedNow);

    await reporter.event(STAGE.FINAL_ASSET_COPY, 'success', 'כל קובצי הריליס הועלו.');
    await reporter.event(STAGE.FINAL_ASSET_VERIFY, 'success', 'כל הקבצים אומתו ביעד לפי גודל ו-SHA-256.');
    await reporter.event(STAGE.FINAL_INDEX_COMMIT, 'success', 'index.html הועלה אחרון ואומת.', { details: { indexSha256: result.indexSha256 } });
    await reporter.event(STAGE.FINAL_INDEX_VERIFY, 'success', `כל ${result.referencesVerified} ההפניות מתוך index.html אומתו ביעד.`);

    // --- FINAL_APP_SMOKE ---------------------------------------------------
    stage = STAGE.FINAL_APP_SMOKE;
    onProgress({ progress: 95, stage, message: 'בודק את האפליקציה הסופית' });
    await reporter.progress(95, 'בודק את האפליקציה הסופית', '', stage);
    const smoke = await finalAppSmoke(client, site.finalDistRoot, { signal });
    if (!smoke.ok) {
      const error = new Error('בדיקת ה-Smoke נכשלה: index.html שהועלה אינו נראה כאפליקציה תקינה.');
      error.stage = stage;
      error.errorClass = SP_ERROR.PERMANENT_FAILURE;
      throw error;
    }
    await reporter.event(stage, 'success', 'STATIC PASS — index.html הסופי נטען ומכיל את ההפניות הצפויות.', { details: smoke });

    // --- COMPLETE ----------------------------------------------------------
    stage = STAGE.COMPLETE;
    await jsonApi(`/api/deployments/${encodeURIComponent(jobId)}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        finalUrl: site.finalUrl,
        completedAt: new Date().toISOString(),
        verification: {
          referencesVerified: result.referencesVerified,
          indexSha256: result.indexSha256,
          libraries: libraryResults,
          seeds: { preserved, created },
          smoke,
        },
      }),
    }, leaseId);
    onProgress({ progress: 100, stage, message: 'הפריסה הושלמה בהצלחה' });
    return { ok: true, finalUrl: site.finalUrl };
  } catch (error) {
    const failure = describeFailure(error, stage);
    try {
      await jsonApi(`/api/deployments/${encodeURIComponent(jobId)}/fail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...failure, error: failure.message, stageLabel: stageLabel(failure.stage) }),
      }, leaseId);
    } catch (callbackError) {
      console.error('[release-manager][sharepoint-engine] failure callback failed', callbackError);
    }
    error.failureInfo = failure;
    throw error;
  } finally {
    if (heartbeat) window.clearInterval(heartbeat);
    if (leaseId) {
      jsonApi(`/api/deployments/${encodeURIComponent(jobId)}/release-lease`, { method: 'POST' }, leaseId).catch(() => {});
    }
  }
}

/** Fetch one staged file from the local API and verify it before uploading. */
async function downloadStagedFile(jobId, file) {
  const url = apiUrl(`/api/deployments/${encodeURIComponent(jobId)}/file?path=${encodeURIComponent(file.path)}`);
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    const error = new Error(`לא ניתן להוריד ${file.path} מה-Staging המקומי: HTTP ${response.status}`);
    error.httpStatus = response.status;
    error.url = url;
    error.currentFile = file.path;
    throw error;
  }
  const buffer = await response.arrayBuffer();
  if (Number(buffer.byteLength) !== Number(file.size)) {
    throw new Error(`גודל שגוי ל-${file.path}: צפוי ${file.size}, התקבל ${buffer.byteLength}.`);
  }
  const bytes = new Uint8Array(buffer);
  if (file.sha256) {
    const actual = await sha256Hex(bytes);
    if (actual !== file.sha256) throw new Error(`SHA-256 שגוי ל-${file.path} לפני ההעלאה.`);
  }
  return bytes;
}

export { ProvisioningError };
