/**
 * SharePoint provisioning with verify-after-mutation semantics.
 *
 * Two rules govern every function here:
 *
 *  1. The HTTP/JSOM mutation result is evidence; verified target state is
 *     authority. Nothing is reported successful until the exact expected object
 *     has been re-read and validated.
 *  2. If a mutation reports an error but the exact expected object now exists
 *     and validates, the stage succeeded. A create is never blindly repeated.
 *
 * Every wait is bounded by attempts AND elapsed time, and is cancellable.
 */

import { SP_ERROR, classifySharePointError, sharePointError } from './sharepointErrors.js';
import { stabilize, retryOperation, STABILIZE_RETRY, DEFAULT_RETRY, RetryBudgetExceededError } from './retry.js';
import { SEED_CONTENT_TYPE, ASSET_CONTENT_TYPE, normalizePath } from './sharepointClient.js';
import {
  DEPLOYMENT_METADATA_FILE,
  RUNTIME_CONFIG_FILE,
  parseIndexReferencesFromHtml,
} from './universalManifest.js';

export const LIBRARY_OUTCOME = Object.freeze({
  REUSED: 'REUSED_EXISTING_EXACT_LIBRARY',
  CREATED: 'CREATED_EXACT_LIBRARY',
  RECOVERED: 'RECOVERED_AFTER_CREATE_ERROR',
});

export const PROVISIONING_ERROR = Object.freeze({
  LIBRARY_URL_COLLISION: 'LIBRARY_URL_COLLISION',
  LIBRARY_URL_ALLOCATION_FAILED: 'LIBRARY_URL_ALLOCATION_FAILED',
  LIBRARY_EXISTS_NOT_DOCUMENT_LIBRARY: 'LIBRARY_EXISTS_NOT_DOCUMENT_LIBRARY',
  LIBRARY_NOT_STABLE: 'LIBRARY_NOT_STABLE',
  FOLDER_NOT_STABLE: 'FOLDER_NOT_STABLE',
  FOLDER_CREATE_FAILED: 'FOLDER_CREATE_FAILED',
  SEED_VERIFY_FAILED: 'SEED_VERIFY_FAILED',
  ASSET_VERIFY_FAILED: 'ASSET_VERIFY_FAILED',
  INDEX_REFERENCE_MISSING: 'INDEX_REFERENCE_MISSING',
  RUNTIME_CONFIG_READ_FAILED: 'RUNTIME_CONFIG_READ_FAILED',
  RUNTIME_CONFIG_INVALID: 'RUNTIME_CONFIG_INVALID',
  RUNTIME_CONFIG_TARGET_MISMATCH: 'RUNTIME_CONFIG_TARGET_MISMATCH',
});

export const BACKUP_OUTCOME = Object.freeze({
  PASSED: 'PASSED',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED',
  SKIPPED_FRESH_TARGET: 'SKIPPED_FRESH_TARGET',
  SKIPPED_UNSUPPORTED_BACKEND: 'SKIPPED_UNSUPPORTED_BACKEND',
});

export class ProvisioningError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProvisioningError';
    this.code = code;
    this.errorClass = details.errorClass || SP_ERROR.PERMANENT_FAILURE;
    Object.assign(this, details);
  }
}

const noopLog = () => {};

/**
 * Conditions that can never be resolved by waiting or by re-reading target
 * state. Swallowing one of these turns a clear, actionable message ("you do
 * not have permission") into a misleading one ("SharePoint is not consistent
 * yet"), and burns the whole retry budget on something that will never pass.
 */
const FATAL_ERROR_CLASSES = new Set([
  SP_ERROR.PERMISSION_DENIED,
  SP_ERROR.AUTH_FAILURE,
  SP_ERROR.INVALID_PATH,
  SP_ERROR.PATH_COLLISION,
  SP_ERROR.NON_DOCUMENT_LIBRARY,
]);

export function isFatalProvisioningError(error) {
  if (error?.cancelled || error?.name === 'CancelledError') return true;
  const errorClass = error?.sharePoint?.errorClass || error?.errorClass;
  return FATAL_ERROR_CLASSES.has(errorClass);
}

/**
 * Ensure ONE Document Library exists with the exact configured title and the
 * exact configured physical root folder.
 *
 * SharePoint silently auto-suffixes a root folder URL when it collides
 * (`siteDB1158` becomes `siteDB11581`). That is treated as a hard failure, not
 * an acceptable outcome, and a conflicting library is never deleted.
 *
 * @param {object} client              from createSharePointClient
 * @param {object} spec                { title, urlSegment, rootFolder, role }
 * @param {object} options
 * @param {Function} options.createLibraryExact async ({title,urlSegment,description}) => created record
 */
export async function ensureExactLibrary(client, spec, options = {}) {
  const { createLibraryExact, log = noopLog, retry = {}, signal, description = 'Site Builder data library' } = options;
  const expectedRoot = normalizePath(spec.rootFolder);

  const verifyExact = async () => {
    const { found, library } = await client.readLibraryByTitle(spec.title);
    if (!found) return { ready: false, reason: 'LIBRARY_NOT_FOUND' };
    if (Number(library.baseTemplate) !== 101) {
      throw new ProvisioningError(
        PROVISIONING_ERROR.LIBRARY_EXISTS_NOT_DOCUMENT_LIBRARY,
        `"${spec.title}" exists but is not a Document Library (BaseTemplate=${library.baseTemplate}).`,
        { errorClass: SP_ERROR.NON_DOCUMENT_LIBRARY, library, expectedRoot },
      );
    }
    if (!library.id) return { ready: false, reason: 'LIBRARY_ID_NOT_READY' };
    if (normalizePath(library.rootFolder) !== expectedRoot) {
      throw new ProvisioningError(
        PROVISIONING_ERROR.LIBRARY_URL_ALLOCATION_FAILED,
        `"${spec.title}" resolved to root folder "${library.rootFolder}" instead of the configured "${expectedRoot}". `
        + 'SharePoint auto-suffixed the URL; Release Manager will not deploy to a different physical library.',
        { errorClass: SP_ERROR.PATH_COLLISION, library, expectedRoot, actualRoot: library.rootFolder },
      );
    }
    return { ready: true, value: library, reason: 'LIBRARY_READY' };
  };

  // --- Discovery -----------------------------------------------------------
  const discovered = await client.readLibraryByTitle(spec.title);
  if (discovered.found) {
    const outcome = await verifyExact();
    if (outcome.ready) {
      await log({ stage: 'LIBRARY_DISCOVERY', status: 'success', message: `הספרייה "${spec.title}" כבר קיימת ותקינה.`, details: { rootFolder: expectedRoot, listId: outcome.value.id } });
      return { outcome: LIBRARY_OUTCOME.REUSED, library: outcome.value, created: false };
    }
    // Present but not yet consistent: stabilize instead of creating a duplicate.
    const stabilized = await stabilizeLibrary(verifyExact, { ...retry, signal, log, describe: `library:${spec.title}` });
    return { outcome: LIBRARY_OUTCOME.REUSED, library: stabilized, created: false };
  }

  // Another list may already own the target root folder URL under a different title.
  const all = await client.readAllLibraries();
  const occupier = all.find((item) => normalizePath(item.rootFolder) === expectedRoot);
  if (occupier && String(occupier.title) !== String(spec.title)) {
    throw new ProvisioningError(
      PROVISIONING_ERROR.LIBRARY_URL_COLLISION,
      `The root folder "${expectedRoot}" is already used by the list "${occupier.title}". `
      + 'Release Manager will not delete or rename an existing SharePoint list.',
      { errorClass: SP_ERROR.PATH_COLLISION, expectedRoot, occupierTitle: occupier.title, occupierId: occupier.id },
    );
  }

  // --- Creation ------------------------------------------------------------
  if (typeof createLibraryExact !== 'function') {
    throw new ProvisioningError(
      PROVISIONING_ERROR.LIBRARY_NOT_STABLE,
      `"${spec.title}" does not exist and no exact-library creator is available in this context.`,
      { errorClass: SP_ERROR.MISSING, expectedRoot },
    );
  }

  await log({ stage: 'CREATE_LIBRARIES', status: 'started', message: `יוצר ספריית מסמכים "${spec.title}" בנתיב ${expectedRoot}.`, details: { urlSegment: spec.urlSegment } });

  let createError = null;
  try {
    await createLibraryExact({ title: spec.title, urlSegment: spec.urlSegment, description, expectedRoot });
  } catch (error) {
    // On this farm a create can report an error and still have committed, so
    // verified state normally decides -- but a permanent condition surfaces
    // immediately rather than after a pointless stabilization wait.
    if (isFatalProvisioningError(error)) throw error;
    createError = error;
    await log({
      stage: 'CREATE_LIBRARIES',
      status: 'warning',
      message: `יצירת "${spec.title}" החזירה שגיאה; בודק אם הספרייה נוצרה בכל זאת.`,
      details: { error: error?.message || String(error) },
    });
  }

  let library;
  try {
    library = await stabilizeLibrary(verifyExact, { ...retry, signal, log, describe: `library:${spec.title}` });
  } catch (error) {
    if (createError && error instanceof RetryBudgetExceededError) {
      // The create genuinely failed and the object never appeared.
      throw createError;
    }
    throw error;
  }

  return {
    outcome: createError ? LIBRARY_OUTCOME.RECOVERED : LIBRARY_OUTCOME.CREATED,
    library,
    created: true,
    recoveredAfterCreateError: Boolean(createError),
  };
}

async function stabilizeLibrary(verifyExact, options) {
  const { log = noopLog, describe, ...rest } = options;
  try {
    const result = await stabilize(verifyExact, {
      ...STABILIZE_RETRY,
      ...rest,
      describe,
      onAttempt: async (attempt) => {
        if (!attempt.ready) {
          await log({
            stage: 'LIBRARY_STABILIZE',
            status: 'info',
            message: `ממתין לייצוב ${describe} (ניסיון ${attempt.attempt}) — ${attempt.reason}.`,
            details: { attempt: attempt.attempt, elapsedMs: attempt.elapsedMs, reason: attempt.reason },
          });
        }
      },
    });
    await log({ stage: 'LIBRARY_STABILIZE', status: 'success', message: `${describe} יציבה אחרי ${result.attempts} ניסיונות.`, details: { attempts: result.attempts, elapsedMs: result.elapsedMs } });
    return result.value;
  } catch (error) {
    if (error instanceof ProvisioningError) throw error;
    throw error;
  }
}

/**
 * Create a folder tree parent-first, stabilizing each level before descending.
 *
 * `libraryRoots` are the Document Library root folders; those are validated as
 * library roots rather than as list-item-backed folders.
 */
export async function ensureFolderTree(client, folderPaths, options = {}) {
  const { log = noopLog, retry = {}, signal, libraryRoots = [] } = options;
  const rootSet = new Set(libraryRoots.map(normalizePath));
  const ordered = orderParentFirst(folderPaths);
  const results = [];

  for (const folderPath of ordered) {
    const expectLibraryRoot = rootSet.has(normalizePath(folderPath));
    const probe = () => client.probeFolder(folderPath, { expectLibraryRoot });

    // The discovery probe must never abort the run on a transient answer: a
    // busy farm reporting SPException here simply means "unknown yet", and the
    // create + stabilize path below is what resolves it.
    const initial = await probeTolerant(probe);
    if (initial.ready) {
      results.push({ path: folderPath, created: false, reason: initial.reason });
      continue;
    }

    await log({ stage: 'CREATE_FOLDERS', status: 'started', message: `יוצר תיקייה ${folderPath}.`, details: { reason: initial.reason } });

    let createOutcome = null;
    try {
      createOutcome = await retryOperation(async () => {
        const outcome = await client.createFolder(folderPath);
        if (!outcome.created && !outcome.alreadyExisted && outcome.normalized) {
          throw sharePointError(outcome.normalized);
        }
        return outcome;
      }, {
        ...DEFAULT_RETRY,
        ...retry,
        signal,
        describe: `create-folder:${folderPath}`,
        onAttempt: async (attempt) => {
          if (!attempt.ok) {
            await log({
              stage: 'CREATE_FOLDERS',
              status: 'info',
              message: `יצירת ${folderPath} נכשלה זמנית (ניסיון ${attempt.attempt}) — ${attempt.errorClass}.`,
              details: { attempt: attempt.attempt, errorClass: attempt.errorClass, httpStatus: attempt.httpStatus, sharePointCode: attempt.sharePointCode },
            });
          }
        },
      });
    } catch (error) {
      // A create failure may still have committed, so verified state normally
      // decides. But a PERMANENT condition -- no permission, expired session,
      // an illegal path, a cancellation -- can never be resolved by waiting and
      // must surface as itself instead of as "not stable yet".
      if (isFatalProvisioningError(error)) throw error;
      await log({ stage: 'CREATE_FOLDERS', status: 'warning', message: `יצירת ${folderPath} החזירה שגיאה; בודק אם התיקייה קיימת בכל זאת.`, details: { error: error?.message || String(error) } });
    }

    // --- FOLDER_STABILIZE -------------------------------------------------
    try {
      const stabilized = await stabilize(async () => {
        const outcome = await probe();
        return { ready: outcome.ready, value: outcome, reason: outcome.reason };
      }, {
        ...STABILIZE_RETRY,
        ...retry,
        signal,
        describe: `folder:${folderPath}`,
        onAttempt: async (attempt) => {
          if (!attempt.ready) {
            await log({
              stage: 'FOLDER_STABILIZE',
              status: 'info',
              message: `ממתין לייצוב ${folderPath} (ניסיון ${attempt.attempt}) — ${attempt.reason}.`,
              details: { attempt: attempt.attempt, elapsedMs: attempt.elapsedMs, reason: attempt.reason },
            });
          }
        },
      });
      results.push({ path: folderPath, created: Boolean(createOutcome), reason: stabilized.value.reason, attempts: stabilized.attempts });
    } catch (error) {
      throw new ProvisioningError(
        PROVISIONING_ERROR.FOLDER_NOT_STABLE,
        `Folder ${folderPath} did not become writable: ${error.message}`,
        { errorClass: error.errorClass || SP_ERROR.TRANSIENT_NOT_READY, target: folderPath, cause: error.message },
      );
    }
  }

  return results;
}

/**
 * Probe without letting a transient/not-found answer escape as a failure.
 * Only a genuinely permanent condition (auth, permissions, collision) throws.
 */
async function probeTolerant(probe) {
  try {
    return await probe();
  } catch (error) {
    const errorClass = error?.sharePoint?.errorClass || error?.errorClass;
    if (errorClass === SP_ERROR.TRANSIENT_NOT_READY || errorClass === SP_ERROR.MISSING) {
      return { ready: false, reason: `PROBE_${errorClass}`, exists: false };
    }
    throw error;
  }
}

/** Deduplicate and sort so every parent is created before its children. */
export function orderParentFirst(folderPaths) {
  const unique = [...new Set(folderPaths.map(normalizePath).filter(Boolean))];
  return unique.sort((a, b) => {
    const depth = a.split('/').length - b.split('/').length;
    return depth !== 0 ? depth : a.localeCompare(b);
  });
}

/**
 * Provision TXT seed files.
 *
 * Existing non-empty content is ALWAYS preserved — this is the protected
 * existing-site rule. Only a genuinely missing (or empty) file is created, and
 * a created file is not reported successful until it has been read back and its
 * size and SHA-256 verified.
 */
export async function ensureTxtSeeds(client, seeds, options = {}) {
  const { log = noopLog, retry = {}, signal, sha256, encode = defaultEncode } = options;
  if (typeof sha256 !== 'function') throw new Error('ensureTxtSeeds requires a sha256 implementation.');
  const results = [];

  for (const seed of seeds) {
    const existing = await retryOperation(() => client.readFile(seed.path), {
      ...DEFAULT_RETRY,
      ...retry,
      signal,
      describe: `read-seed:${seed.path}`,
    });

    if (existing.value.found && existing.value.bytes?.length && hasContent(existing.value.bytes)) {
      results.push({ path: seed.path, action: 'preserved', bytes: existing.value.bytes.length });
      await log({ stage: 'CREATE_TXT_SEEDS', status: 'info', message: `${seed.fileName} כבר קיים עם תוכן — נשמר ללא שינוי.`, details: { path: seed.path, bytes: existing.value.bytes.length } });
      continue;
    }

    const bytes = encode(seed.content);
    const expectedSha = await sha256(bytes);

    await retryOperation(() => client.uploadFile(seed.path, bytes, SEED_CONTENT_TYPE), {
      ...DEFAULT_RETRY,
      ...retry,
      signal,
      describe: `upload-seed:${seed.path}`,
      onAttempt: async (attempt) => {
        if (!attempt.ok) {
          await log({
            stage: 'CREATE_TXT_SEEDS',
            status: 'info',
            message: `העלאת ${seed.fileName} נכשלה זמנית (ניסיון ${attempt.attempt}) — ${attempt.errorClass}.`,
            details: { attempt: attempt.attempt, errorClass: attempt.errorClass, httpStatus: attempt.httpStatus },
          });
        }
      },
    });

    // Verified read-back is what marks the stage successful, not the upload 200.
    let verified;
    try {
      verified = await stabilize(async () => {
        const readBack = await client.readFile(seed.path);
        if (!readBack.found) return { ready: false, reason: 'SEED_NOT_VISIBLE_YET' };
        if (readBack.bytes.length !== bytes.length) {
          return { ready: false, reason: `SEED_SIZE_MISMATCH:${readBack.bytes.length}!=${bytes.length}` };
        }
        const actualSha = await sha256(readBack.bytes);
        if (actualSha !== expectedSha) return { ready: false, reason: 'SEED_SHA_MISMATCH' };
        return { ready: true, value: { size: readBack.bytes.length, sha256: actualSha } };
      }, {
        ...STABILIZE_RETRY,
        ...retry,
        signal,
        describe: `verify-seed:${seed.path}`,
        onAttempt: async (attempt) => {
          if (!attempt.ready) {
            await log({ stage: 'CREATE_TXT_SEEDS', status: 'info', message: `ממתין לאימות ${seed.fileName} (ניסיון ${attempt.attempt}) — ${attempt.reason}.`, details: { attempt: attempt.attempt, reason: attempt.reason } });
          }
        },
      });
    } catch (error) {
      throw new ProvisioningError(
        PROVISIONING_ERROR.SEED_VERIFY_FAILED,
        `TXT seed ${seed.path} was uploaded but could not be verified: ${error.message}`,
        { errorClass: error.errorClass || SP_ERROR.TRANSIENT_NOT_READY, target: seed.path, expectedSha256: expectedSha, expectedSize: bytes.length },
      );
    }

    results.push({ path: seed.path, action: 'created', bytes: verified.value.size, sha256: verified.value.sha256 });
    await log({ stage: 'CREATE_TXT_SEEDS', status: 'success', message: `${seed.fileName} נוצר ואומת.`, details: { path: seed.path, size: verified.value.size } });
  }

  return results;
}

/** A file of only whitespace counts as empty and is safe to seed. */
function hasContent(bytes) {
  for (const byte of bytes) {
    if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) return true;
  }
  return false;
}

function defaultEncode(value) {
  return new TextEncoder().encode(String(value));
}

function backupFolderName(value) {
  return `backup-${value.toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
}

function backupBaseResult({ sourceFiles, startedAt, backupPath = '', backupUrl = '' }) {
  return {
    outcome: BACKUP_OUTCOME.FAILED,
    strategy: 'SHAREPOINT_TXT_FILES',
    trigger: 'PRE_DEPLOY',
    startedAt,
    finishedAt: '',
    backupPath,
    backupUrl,
    fileCount: sourceFiles.length,
    copiedFiles: [],
    skippedFiles: [],
    failedFiles: [],
    totalSizeBytes: 0,
    verificationStatus: 'FAILED',
    warningDetails: [],
  };
}

/**
 * Best-effort snapshot of the canonical TXT plan into Site Builder's existing
 * <siteAssetsRoot>/Backups/backup-<timestamp> layout.
 *
 * The caller deliberately treats every returned outcome as non-fatal. This
 * function never writes a source path and uses overwrite=false for backup files.
 */
export async function createTxtBackup(client, options = {}) {
  const {
    sourceFiles = [],
    siteAssetsRoot,
    host,
    libraryRoots = [],
    sha256,
    retry = {},
    signal,
    dateNow = () => new Date(),
    log = noopLog,
  } = options;
  if (typeof sha256 !== 'function') throw new Error('createTxtBackup requires a sha256 implementation.');
  if (!siteAssetsRoot || !host) throw new Error('createTxtBackup requires siteAssetsRoot and host.');

  const started = new Date(dateNow());
  const result = backupBaseResult({ sourceFiles, startedAt: started.toISOString() });
  const readable = [];

  for (const source of sourceFiles) {
    try {
      // Sequential reads avoid creating a burst of authenticated requests on
      // older SharePoint farms and reuse the deployment retry classifier.
      // eslint-disable-next-line no-await-in-loop
      const read = await retryOperation(() => client.readFile(source.path), {
        ...DEFAULT_RETRY, ...retry, signal, describe: `backup-read:${source.path}`,
      });
      if (!read.value.found) {
        result.skippedFiles.push({ fileName: source.fileName, sourcePath: source.path, reason: 'SOURCE_MISSING' });
      } else {
        readable.push({ ...source, bytes: read.value.bytes });
      }
    } catch (error) {
      result.failedFiles.push({
        fileName: source.fileName,
        sourcePath: source.path,
        operation: 'read',
        error: error?.message || String(error),
        errorClass: error?.sharePoint?.errorClass || error?.errorClass || '',
        httpStatus: error?.sharePoint?.httpStatus ?? error?.httpStatus ?? null,
      });
    }
  }

  if (!readable.length) {
    result.finishedAt = new Date(dateNow()).toISOString();
    if (!result.failedFiles.length) {
      result.outcome = BACKUP_OUTCOME.SKIPPED_FRESH_TARGET;
      result.verificationStatus = 'NOT_APPLICABLE';
    } else {
      result.warningDetails.push('No canonical TXT source could be read, so no backup folder was created.');
    }
    return result;
  }

  const backupRoot = `${normalizePath(siteAssetsRoot)}/Backups`;
  let selectedPath = '';
  try {
    // Preserve Site Builder's exact second-resolution naming contract while
    // probing subsequent seconds if a folder with that name already exists.
    for (let offset = 0; offset < 120; offset += 1) {
      const candidate = `${backupRoot}/${backupFolderName(new Date(started.getTime() + (offset * 1000)))}`;
      // eslint-disable-next-line no-await-in-loop
      const probe = await client.probeFolder(candidate);
      if (!probe.exists) {
        selectedPath = candidate;
        break;
      }
    }
    if (!selectedPath) throw new Error('Could not allocate a unique backup folder name.');
    result.backupPath = selectedPath;
    result.backupUrl = `https://${host}${selectedPath}`;
    await ensureFolderTree(client, [backupRoot, selectedPath], {
      log, signal, retry, libraryRoots,
    });
  } catch (error) {
    for (const source of readable) {
      result.failedFiles.push({
        fileName: source.fileName,
        sourcePath: source.path,
        operation: 'prepare-folder',
        error: error?.message || String(error),
        errorClass: error?.sharePoint?.errorClass || error?.errorClass || '',
        httpStatus: error?.sharePoint?.httpStatus ?? error?.httpStatus ?? null,
      });
    }
    result.warningDetails.push(`Backup folder preparation failed: ${error?.message || String(error)}`);
    result.finishedAt = new Date(dateNow()).toISOString();
    return result;
  }

  for (const source of readable) {
    const targetPath = `${selectedPath}/${source.fileName}`;
    try {
      // The no-overwrite flag is a second safety barrier after unique-folder
      // allocation: even a collision can never replace an older backup.
      // eslint-disable-next-line no-await-in-loop
      await retryOperation(() => client.uploadFile(targetPath, source.bytes, SEED_CONTENT_TYPE, { overwrite: false }), {
        ...DEFAULT_RETRY, ...retry, signal, describe: `backup-write:${targetPath}`,
      });
      // eslint-disable-next-line no-await-in-loop
      const sourceSha256 = await sha256(source.bytes);
      // eslint-disable-next-line no-await-in-loop
      await verifyRemoteFile(client, targetPath, { size: source.bytes.length, sha256: sourceSha256 }, {
        sha256, retry, signal, describe: `backup-verify:${targetPath}`,
      });
      result.copiedFiles.push({
        fileName: source.fileName,
        sourcePath: source.path,
        targetPath,
        size: source.bytes.length,
        sha256: sourceSha256,
        verified: true,
      });
      result.totalSizeBytes += source.bytes.length;
    } catch (error) {
      result.failedFiles.push({
        fileName: source.fileName,
        sourcePath: source.path,
        targetPath,
        operation: 'copy-or-verify',
        error: error?.message || String(error),
        errorClass: error?.sharePoint?.errorClass || error?.errorClass || '',
        httpStatus: error?.sharePoint?.httpStatus ?? error?.httpStatus ?? null,
      });
    }
  }

  result.finishedAt = new Date(dateNow()).toISOString();
  if (result.copiedFiles.length === sourceFiles.length) {
    result.outcome = BACKUP_OUTCOME.PASSED;
    result.verificationStatus = 'PASSED';
  } else if (result.copiedFiles.length > 0) {
    result.outcome = BACKUP_OUTCOME.PARTIAL;
    result.verificationStatus = 'PARTIAL';
  } else {
    result.outcome = BACKUP_OUTCOME.FAILED;
    result.verificationStatus = 'FAILED';
  }
  return result;
}

/**
 * Upload every non-index asset, verify each one at the target, then commit
 * index.html last and verify it plus every asset it references.
 */
export async function uploadReleaseAssets(client, plan, options = {}) {
  const {
    log = noopLog, retry = {}, signal, sha256, downloadFile,
    onProgress = noopLog, distRoot, commitFile = 'index.html',
    alreadyVerified = new Set(),
    beforeCommit = null,
    // Called ONLY after a file has been uploaded AND verified at the target.
    // Reporting a file as verified any earlier would let a later resume skip
    // a file that was never actually written.
    onVerified = noopLog,
  } = options;
  if (typeof sha256 !== 'function') throw new Error('uploadReleaseAssets requires a sha256 implementation.');
  if (typeof downloadFile !== 'function') throw new Error('uploadReleaseAssets requires downloadFile.');

  const filesByPath = new Map(plan.files.map((file) => [file.path, file]));
  const order = (plan.uploadOrder && plan.uploadOrder.length ? plan.uploadOrder : plan.files.map((file) => file.path));
  const nonCommit = order.filter((filePath) => filePath !== commitFile);
  if (!filesByPath.has(commitFile)) {
    throw new ProvisioningError(PROVISIONING_ERROR.ASSET_VERIFY_FAILED, `Deployment plan is missing ${commitFile}.`, { errorClass: SP_ERROR.PERMANENT_FAILURE });
  }

  const uploaded = [];
  for (let index = 0; index < nonCommit.length; index += 1) {
    const filePath = nonCommit[index];
    const file = filesByPath.get(filePath);
    if (!file) {
      throw new ProvisioningError(PROVISIONING_ERROR.ASSET_VERIFY_FAILED, `Upload order references ${filePath}, which is not in the manifest.`, { errorClass: SP_ERROR.PERMANENT_FAILURE, target: filePath });
    }
    const targetPath = `${distRoot}/${filePath}`;

    // Resume: a file already verified at the target in a previous attempt of
    // this same job is not re-uploaded.
    if (alreadyVerified.has(filePath)) {
      uploaded.push({ path: filePath, action: 'already-verified' });
      continue;
    }

    await onProgress({ index, total: nonCommit.length, filePath });
    const bytes = await downloadFile(file);
    await retryOperation(() => client.uploadFile(targetPath, bytes, ASSET_CONTENT_TYPE), {
      ...DEFAULT_RETRY, ...retry, signal, describe: `upload-asset:${filePath}`,
    });
    await verifyRemoteFile(client, targetPath, file, { sha256, retry, signal, describe: `verify-asset:${filePath}` });
    await onVerified(filePath);
    uploaded.push({ path: filePath, action: 'uploaded', size: file.size });
  }

  await log({ stage: 'FINAL_ASSET_VERIFY', status: 'success', message: `כל ${nonCommit.length} הקבצים (ללא ${commitFile}) הועלו ואומתו ביעד.`, details: { count: nonCommit.length } });

  if (beforeCommit) await beforeCommit();

  // --- Commit index last --------------------------------------------------
  const indexFile = filesByPath.get(commitFile);
  const indexBytes = await downloadFile(indexFile);
  await retryOperation(() => client.uploadFile(`${distRoot}/${commitFile}`, indexBytes, ASSET_CONTENT_TYPE), {
    ...DEFAULT_RETRY, ...retry, signal, describe: `upload-commit:${commitFile}`,
  });
  await verifyRemoteFile(client, `${distRoot}/${commitFile}`, indexFile, { sha256, retry, signal, describe: `verify-commit:${commitFile}` });

  // --- Verify every reference the committed index points at ----------------
  const indexRead = await client.readFile(`${distRoot}/${commitFile}`);
  if (!indexRead.found) {
    throw new ProvisioningError(PROVISIONING_ERROR.ASSET_VERIFY_FAILED, `${commitFile} is not readable after commit.`, { errorClass: SP_ERROR.MISSING, target: `${distRoot}/${commitFile}` });
  }
  const html = new TextDecoder().decode(indexRead.bytes);
  const references = parseIndexReferencesFromHtml(html);
  const missing = [];
  for (const reference of references) {
    const file = filesByPath.get(reference);
    if (!file) { missing.push(`${reference} (not in manifest)`); continue; }
    try {
      await verifyRemoteFile(client, `${distRoot}/${reference}`, file, { sha256, retry, signal, describe: `verify-reference:${reference}` });
    } catch (error) {
      missing.push(`${reference}: ${error.message}`);
    }
  }
  if (missing.length) {
    throw new ProvisioningError(
      PROVISIONING_ERROR.INDEX_REFERENCE_MISSING,
      `index.html references assets that are missing or mismatched at the target: ${missing.slice(0, 8).join(' | ')}`,
      { errorClass: SP_ERROR.PERMANENT_FAILURE, missing },
    );
  }

  return { uploaded, referencesVerified: references.length, indexSha256: indexFile.sha256 };
}

/** Read a file back from SharePoint and assert size + SHA-256. */
export async function verifyRemoteFile(client, targetPath, expected, options = {}) {
  const { sha256, retry = {}, signal, describe = `verify:${targetPath}` } = options;
  try {
    const result = await stabilize(async () => {
      const readBack = await client.readFile(targetPath);
      if (!readBack.found) return { ready: false, reason: 'NOT_VISIBLE_YET' };
      if (Number(readBack.bytes.length) !== Number(expected.size)) {
        return { ready: false, reason: `SIZE_MISMATCH:${readBack.bytes.length}!=${expected.size}` };
      }
      if (expected.sha256) {
        const actual = await sha256(readBack.bytes);
        if (actual !== expected.sha256) return { ready: false, reason: `SHA_MISMATCH:${actual}` };
      }
      return { ready: true, value: { size: readBack.bytes.length } };
    }, { ...STABILIZE_RETRY, ...retry, signal, describe });
    return result.value;
  } catch (error) {
    throw new ProvisioningError(
      PROVISIONING_ERROR.ASSET_VERIFY_FAILED,
      `${targetPath} did not verify at the target: ${error.message}`,
      {
        errorClass: error.errorClass || SP_ERROR.TRANSIENT_NOT_READY,
        target: targetPath,
        expectedSize: expected.size,
        expectedSha256: expected.sha256 || '',
      },
    );
  }
}

function looksLikeHtml(text, contentType = '') {
  const prefix = String(text || '').trim().slice(0, 240).toLowerCase();
  return String(contentType || '').toLowerCase().includes('text/html')
    || prefix.startsWith('<!doctype html')
    || prefix.startsWith('<html')
    || prefix.includes('<head>');
}

async function fetchDirectJson(fetchImpl, url, options = {}) {
  const { retry = {}, signal, kind = 'Runtime Config' } = options;
  const fetched = await retryOperation(async () => {
    const response = await fetchImpl(url, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw sharePointError(classifySharePointError({
        httpStatus: response.status,
        body: text,
        operation: `direct-${kind.toLowerCase().replace(/\s+/g, '-')}-read`,
        target: url,
        url,
        method: 'GET',
      }));
    }
    if (looksLikeHtml(text, response.headers?.get?.('content-type'))) {
      throw new ProvisioningError(
        PROVISIONING_ERROR.RUNTIME_CONFIG_INVALID,
        `${kind} at ${url} returned HTML instead of JSON.`,
        { errorClass: SP_ERROR.PERMANENT_FAILURE, target: url, url },
      );
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new ProvisioningError(
        PROVISIONING_ERROR.RUNTIME_CONFIG_INVALID,
        `${kind} at ${url} is malformed JSON: ${error.message}`,
        { errorClass: SP_ERROR.PERMANENT_FAILURE, target: url, url },
      );
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ProvisioningError(
        PROVISIONING_ERROR.RUNTIME_CONFIG_INVALID,
        `${kind} at ${url} must contain a JSON object.`,
        { errorClass: SP_ERROR.PERMANENT_FAILURE, target: url, url },
      );
    }
    return {
      payload,
      status: response.status,
      contentType: response.headers?.get?.('content-type') || '',
      bytes: new TextEncoder().encode(text).length,
    };
  }, { ...DEFAULT_RETRY, ...retry, signal, describe: `direct-json:${url}` });
  return { ...fetched.value, attempts: fetched.attempts };
}

function assertExpectedFields(payload, expected, fields, kind, url) {
  const mismatches = [];
  for (const field of fields) {
    const wanted = String(expected[field] ?? '');
    if (!wanted) continue;
    const actual = String(payload[field] ?? '');
    if (actual !== wanted) mismatches.push(`${field}="${actual || '(missing)'}" expected "${wanted}"`);
  }
  if (mismatches.length) {
    throw new ProvisioningError(
      PROVISIONING_ERROR.RUNTIME_CONFIG_TARGET_MISMATCH,
      `${kind} does not belong to this deployment target: ${mismatches.join(' | ')}`,
      {
        errorClass: SP_ERROR.PERMANENT_FAILURE,
        target: url,
        url,
        mismatches,
      },
    );
  }
}

/**
 * Fetch exactly the two URLs Site Builder derives beside index.html, parse both
 * JSON files and reject stale/cross-target overlays before index.html is made
 * active for this run.
 */
export async function verifyFinalRuntimeConfig(fetchImpl, verification, options = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('verifyFinalRuntimeConfig requires fetchImpl.');
  const expected = verification?.expected || {};
  const runtimeUrl = verification?.runtimeConfigUrl
    || new URL(RUNTIME_CONFIG_FILE, expected.finalAppUrl).toString();
  const deploymentUrl = verification?.deploymentMetadataUrl
    || new URL(DEPLOYMENT_METADATA_FILE, expected.finalAppUrl).toString();
  const exactRuntimeUrl = new URL(RUNTIME_CONFIG_FILE, expected.finalAppUrl).toString();
  const exactDeploymentUrl = new URL(DEPLOYMENT_METADATA_FILE, expected.finalAppUrl).toString();
  if (runtimeUrl !== exactRuntimeUrl || deploymentUrl !== exactDeploymentUrl) {
    throw new ProvisioningError(
      PROVISIONING_ERROR.RUNTIME_CONFIG_TARGET_MISMATCH,
      'Runtime verification URLs do not match the URLs Site Builder derives from index.html.',
      { errorClass: SP_ERROR.PERMANENT_FAILURE, target: runtimeUrl },
    );
  }

  const runtime = await fetchDirectJson(fetchImpl, runtimeUrl, { ...options, kind: 'Runtime Config' });
  assertExpectedFields(runtime.payload, {
    schemaVersion: 2,
    deploymentGeneratedBy: 'site-release-manager',
  }, ['schemaVersion', 'deploymentGeneratedBy'], 'Runtime Config', runtimeUrl);
  assertExpectedFields(runtime.payload, expected, [
    'host', 'siteCode', 'siteDbFolder', 'siteDbRoot', 'usersDbFolder', 'usersDbRoot',
    'siteAssetsFolder', 'siteAssetsRoot', 'widgetsDbTarget', 'storageBackend',
    'targetDistPath', 'finalAppUrl', 'deploymentJobId', 'releaseId', 'releaseVersion',
  ], 'Runtime Config', runtimeUrl);

  const deployment = await fetchDirectJson(fetchImpl, deploymentUrl, { ...options, kind: 'Deployment Metadata' });
  assertExpectedFields(deployment.payload, {
    kind: 'sitebuilder-deployment',
    schemaVersion: 3,
    generatedBy: 'site-release-manager',
  }, ['kind', 'schemaVersion', 'generatedBy'], 'Deployment Metadata', deploymentUrl);
  assertExpectedFields(deployment.payload, expected, [
    'host', 'siteCode', 'siteDbRoot', 'usersDbRoot', 'siteAssetsRoot', 'storageBackend',
    'targetDistPath', 'finalAppUrl', 'deploymentJobId', 'releaseId', 'releaseVersion',
  ], 'Deployment Metadata', deploymentUrl);

  return {
    ok: true,
    runtimeConfigUrl: runtimeUrl,
    deploymentMetadataUrl: deploymentUrl,
    runtimeStatus: runtime.status,
    deploymentStatus: deployment.status,
    runtimeBytes: runtime.bytes,
    deploymentBytes: deployment.bytes,
    runtimeAttempts: runtime.attempts,
    deploymentAttempts: deployment.attempts,
    deploymentJobId: runtime.payload.deploymentJobId,
    releaseId: runtime.payload.releaseId,
    targetDistPath: runtime.payload.targetDistPath,
  };
}

/**
 * Static smoke check of the deployed application entry point.
 * A static GET only: nothing is mutated and no application state is touched.
 */
export async function finalAppSmoke(client, distRoot, options = {}) {
  const {
    retry = {}, signal, commitFile = 'index.html',
    fetchImpl = null, finalUrl = '', runtimeVerification = null,
  } = options;
  const result = await retryOperation(async () => {
    const readBack = await client.readFile(`${distRoot}/${commitFile}`);
    if (!readBack.found) throw sharePointError(classifySharePointError({ httpStatus: readBack.status, body: '', operation: 'final-app-smoke', target: `${distRoot}/${commitFile}` }));
    return readBack;
  }, { ...DEFAULT_RETRY, ...retry, signal, describe: 'final-app-smoke' });

  let html = new TextDecoder().decode(result.value.bytes);
  let directStatus = null;
  if (fetchImpl && finalUrl) {
    const direct = await retryOperation(async () => {
      const response = await fetchImpl(finalUrl, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'text/html,*/*' },
        signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw sharePointError(classifySharePointError({
          httpStatus: response.status,
          body: text,
          operation: 'final-app-direct-smoke',
          target: finalUrl,
          url: finalUrl,
          method: 'GET',
        }));
      }
      return { text, status: response.status };
    }, { ...DEFAULT_RETRY, ...retry, signal, describe: 'final-app-direct-smoke' });
    html = direct.value.text;
    directStatus = direct.value.status;
  }
  const references = parseIndexReferencesFromHtml(html);
  const hasScript = /<script\b/i.test(html);
  const runtimeConfigVerified = runtimeVerification?.ok === true;
  return {
    ok: hasScript && references.length > 0 && runtimeConfigVerified,
    bytes: new TextEncoder().encode(html).length,
    references: references.length,
    hasScript,
    directStatus,
    runtimeConfigVerified,
    runtimeConfigUrl: runtimeVerification?.runtimeConfigUrl || '',
  };
}
