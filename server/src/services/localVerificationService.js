import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ObjectId } from 'mongodb';
import { getDb } from '../db.js';
import { config, paths, rootDir } from '../config.js';
import { buildSeedFiles } from './seedData.js';
import { resolveDeploymentFile } from './deploymentService.js';
import { MANIFEST_KIND, SUPPORTED_MANIFEST_SCHEMA_VERSIONS, RUNTIME_BOOTSTRAP_FILE } from '../../../shared/universalManifest.js';
import {
  RUNTIME_BOOTSTRAP_MARKER, parseRuntimeBootstrapConfig,
  findFirstModuleScriptIndex, findFirstForeignScriptIndex, findRuntimeBootstrapIndex,
} from '../../../shared/runtimeBootstrap.js';
import {
  collectFiles,
  DEPLOYMENT_OVERLAY_FILES,
  ensureDirectory,
  hashDirectory,
  isSafeRelativePath,
  normalizeRelativePath,
  removeDirectory,
} from '../utils/files.js';

const TEXT_EXTENSIONS = new Set(['.html', '.js', '.css', '.json', '.txt', '.svg', '.xml', '.webmanifest']);

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function writeText(target, content) {
  ensureDirectory(path.dirname(target));
  fs.writeFileSync(target, content, 'utf8');
}

function resolveSimulationPath(root, serverRelativePath) {
  const normalized = normalizeRelativePath(serverRelativePath);
  if (!isSafeRelativePath(normalized)) throw new Error(`Unsafe simulated SharePoint path: ${serverRelativePath}`);
  return path.join(root, ...normalized.split('/'));
}

function verifyIndexReferences(finalDistRoot) {
  const indexPath = path.join(finalDistRoot, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const refs = [];
  const absoluteRootRefs = [];
  const regex = /(?:src|href)=["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(html))) {
    const raw = String(match[1] || '').trim();
    if (!raw || /^(?:https?:|data:|mailto:|#|\/\/)/i.test(raw)) continue;
    const cleaned = raw.split(/[?#]/)[0].replace(/^\.\//, '');
    if (!cleaned) continue;
    if (cleaned.startsWith('/')) {
      absoluteRootRefs.push(cleaned);
      continue;
    }
    refs.push(cleaned);
  }
  const missing = refs.filter((relativePath) => !fs.existsSync(path.join(finalDistRoot, ...relativePath.split('/'))));
  return { refs, missing, absoluteRootRefs };
}

function scanTextFiles(root, needles) {
  const hits = [];
  for (const file of collectFiles(root)) {
    if (!TEXT_EXTENSIONS.has(path.extname(file.path).toLowerCase())) continue;
    const filePath = path.join(root, ...file.path.split('/'));
    let text = '';
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    for (const needle of needles) {
      if (needle && text.includes(needle)) hits.push({ file: file.path, needle });
    }
  }
  return hits;
}


function scanTextPatterns(root, patterns) {
  const hits = [];
  for (const file of collectFiles(root)) {
    if (!TEXT_EXTENSIONS.has(path.extname(file.path).toLowerCase())) continue;
    const filePath = path.join(root, ...file.path.split('/'));
    let text = '';
    try { text = fs.readFileSync(filePath, 'utf8'); } catch { continue; }
    for (const { name, regex } of patterns) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(text))) {
        hits.push({ file: file.path, pattern: name, match: String(match[0]).slice(0, 240) });
        if (hits.length >= 40) return hits;
        if (!regex.global) break;
      }
    }
  }
  return hits;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function canonicalRuntime(site) {
  const siteRoot = `/sites/${site.siteCode}`;
  const siteDbFolder = String(site.siteDbFolder || 'siteDB').trim();
  const usersDbFolder = String(site.usersDbFolder || 'siteUsersDb').trim();
  const siteAssetsFolder = String(site.siteAssetsFolder || 'siteAssets').trim();
  const imagesFolder = String(site.imagesFolder || 'images').trim();
  const widgetsDbTarget = String(site.widgetsDbTarget || 'users').trim().toLowerCase() === 'site' ? 'site' : 'users';
  const siteDbRoot = `${siteRoot}/${siteDbFolder}`;
  const usersDbRoot = `${siteRoot}/${usersDbFolder}`;
  const siteAssetsRoot = `${siteDbRoot}/${siteAssetsFolder}`;
  const imagesRoot = `${siteDbRoot}/${imagesFolder}`;
  const targetDistPath = `${siteDbRoot}/dist`;
  const sharePointSiteUrl = `https://${site.host}${siteRoot}`;
  return {
    schemaVersion: 2, storageBackend: 'txt', host: site.host, siteCode: site.siteCode,
    siteRoot, siteApiRoot: siteRoot, siteDbFolder, siteDbRoot, usersDbFolder, usersDbRoot,
    siteAssetsFolder, siteAssetsRoot, imagesFolder, imagesRoot, widgetsDbTarget,
    sharePointSiteUrl, allowedSiteRoot: sharePointSiteUrl, targetDistPath,
    finalAppUrl: `${sharePointSiteUrl}/${siteDbFolder}/dist/index.html`,
  };
}

function runtimeMismatches(runtime, expected) {
  const keys = Object.keys(expected);
  return keys.filter((key) => String(runtime?.[key] ?? '') !== String(expected[key] ?? ''))
    .map((key) => ({ key, expected: expected[key], actual: runtime?.[key] }));
}

function simulateSeedPreservation(root, seeds) {
  removeDirectory(root);
  ensureDirectory(root);
  const sentinels = new Map();
  for (const seed of seeds) {
    const target = resolveSimulationPath(root, seed.path);
    const sentinel = `PRESERVE:${seed.path}\n`;
    sentinels.set(seed.path, sentinel);
    writeText(target, sentinel);
  }
  // This mirrors the browser deployer's contract: keep existing non-empty TXT,
  // create only missing/empty seed files.
  for (const seed of seeds) {
    const target = resolveSimulationPath(root, seed.path);
    const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (!existing.trim()) writeText(target, seed.content);
  }
  return seeds.filter((seed) => fs.readFileSync(resolveSimulationPath(root, seed.path), 'utf8') !== sentinels.get(seed.path));
}

function makeLogger(jobId) {
  const lines = [];
  const add = (level, message) => {
    const line = `[${new Date().toISOString()}] [local-audit] [${level}] ${message}`;
    lines.push(line);
    console.log(`[job ${jobId}] ${line}`);
  };
  return { lines, info: (m) => add('INFO', m), pass: (m) => add('PASS', m), warn: (m) => add('WARN', m), fail: (m) => add('FAIL', m) };
}

export async function runLocalDeploymentVerification(jobId) {
  const db = getDb();
  const objectId = new ObjectId(jobId);
  const job = await db.collection('deployment_jobs').findOne({ _id: objectId });
  if (!job) throw Object.assign(new Error('המשימה לא נמצאה.'), { statusCode: 404 });
  if (!job.manifestPath || !fs.existsSync(job.manifestPath)) {
    throw Object.assign(new Error('הריליס עדיין אינו מוכן לבדיקה מקומית.'), { statusCode: 409 });
  }

  const [site, release] = await Promise.all([
    db.collection('sites').findOne({ _id: job.siteId }),
    db.collection('releases').findOne({ _id: job.releaseId }),
  ]);
  if (!site || !release) throw new Error('Site or release not found.');

  const artifact = JSON.parse(fs.readFileSync(job.manifestPath, 'utf8'));
  const simulationRoot = path.join(paths.localSimulations, jobId);
  const firstInstallRoot = path.join(simulationRoot, 'first-install');
  const existingSiteRoot = path.join(simulationRoot, 'existing-site-update');
  removeDirectory(simulationRoot);
  ensureDirectory(firstInstallRoot);

  const auditLog = makeLogger(jobId);
  const checks = [];
  const addCheck = (status, name, details = '') => {
    const check = { name, status, ok: status !== 'fail', details };
    checks.push(check);
    const fn = status === 'pass' ? auditLog.pass : status === 'warn' ? auditLog.warn : auditLog.fail;
    fn(`${name}${details ? ` | ${details}` : ''}`);
    return check;
  };
  const pass = (name, details = '') => addCheck('pass', name, details);
  const warn = (name, details = '') => addCheck('warn', name, details);
  const fail = (name, details = '') => addCheck('fail', name, details);

  auditLog.info('=== SITE RELEASE MANAGER LOCAL DEEP AUDIT START ===');
  auditLog.info(`jobId=${jobId}`);
  auditLog.info(`site=${site.host}/sites/${site.siteCode}`);
  auditLog.info(`release=${release.version} releaseId=${String(release._id)}`);
  auditLog.info(`releaseDist=${release.distDir}`);
  auditLog.info(`artifactManifest=${job.manifestPath}`);
  auditLog.info(`simulationRoot=${simulationRoot}`);

  // System/database/storage checks.
  const ping = await db.command({ ping: 1 });
  if (Number(ping?.ok) === 1) pass('MongoDB מחובר', config.mongoDbName);
  else fail('MongoDB מחובר', JSON.stringify(ping));

  const [siteCount, releaseCount, jobCount] = await Promise.all([
    db.collection('sites').countDocuments({}),
    db.collection('releases').countDocuments({}),
    db.collection('deployment_jobs').countDocuments({}),
  ]);
  pass('נתוני המערכת שמורים ב-MongoDB', `${siteCount} אתרים · ${releaseCount} ריליסים · ${jobCount} משימות`);

  const storageProbe = path.join(paths.temp, `audit-${jobId}.tmp`);
  try {
    ensureDirectory(paths.temp);
    fs.writeFileSync(storageProbe, 'ok', 'utf8');
    fs.rmSync(storageProbe, { force: true });
    pass('Storage של המערכת ניתן לכתיבה', config.storageRoot);
  } catch (error) {
    fail('Storage של המערכת ניתן לכתיבה', error.message);
  }

  if (config.sharePointHosts.includes(site.host.toLowerCase())) pass('Host נמצא ב-SHAREPOINT_HOSTS', site.host);
  else fail('Host נמצא ב-SHAREPOINT_HOSTS', `${site.host} חסר ב-${config.sharePointHosts.join(', ')}`);

  const deployerDist = path.join(rootDir, 'sharepoint-deployer', 'client', 'dist');
  const deployerRequired = ['index.html', 'app.js', 'styles.css'];
  const missingDeployer = deployerRequired.filter((name) => !fs.existsSync(path.join(deployerDist, name)));
  if (!missingDeployer.length) pass('SharePoint Deployer בנוי מקומית', deployerRequired.join(', '));
  else fail('SharePoint Deployer בנוי מקומית', `חסרים: ${missingDeployer.join(', ')}`);

  // The deployer no longer carries its own copy of the provisioning sequence:
  // it imports the same shared pipeline the in-page worker runs. Check that the
  // shared modules actually shipped alongside it, and that the pipeline still
  // contains the behaviour this project depends on.
  const deployerShared = path.join(deployerDist, 'shared');
  const requiredSharedModules = ['deploymentPipeline.js', 'sharepointProvisioning.js', 'sharepointClient.js', 'sharepointErrors.js', 'retry.js'];
  const missingShared = requiredSharedModules.filter((name) => !fs.existsSync(path.join(deployerShared, name)));
  if (!missingShared.length) pass('Deployer נבנה עם מודולי הפריסה המשותפים', requiredSharedModules.join(', '));
  else fail('Deployer נבנה עם מודולי הפריסה המשותפים', `חסרים: ${missingShared.join(', ')}`);

  if (!missingShared.length) {
    const pipelineJs = fs.readFileSync(path.join(deployerShared, 'deploymentPipeline.js'), 'utf8');
    const provisioningJs = fs.readFileSync(path.join(deployerShared, 'sharepointProvisioning.js'), 'utf8');
    const requiredBehaviour = [
      ['contextinfo', pipelineJs.includes('getContextInfo')],
      ['exact library provisioning', pipelineJs.includes('ensureExactLibrary')],
      ['folder stabilization', pipelineJs.includes('ensureFolderTree')],
      ['TXT seed preservation', provisioningJs.includes("action: 'preserved'")],
      ['index committed last', provisioningJs.includes('commitFile')],
      ['verify after mutation', provisioningJs.includes('verifyRemoteFile')],
    ];
    const missingBehaviour = requiredBehaviour.filter(([, present]) => !present).map(([name]) => name);
    if (!missingBehaviour.length) pass('Deployer מכיל את זרימת SharePoint הנדרשת', requiredBehaviour.map(([name]) => name).join(' · '));
    else fail('Deployer מכיל את זרימת SharePoint הנדרשת', `חסר: ${missingBehaviour.join(', ')}`);
  }

  let publicApi;
  try { publicApi = new URL(config.publicApiUrl); } catch { publicApi = null; }
  if (!publicApi) fail('PUBLIC_API_URL תקין', config.publicApiUrl);
  else if (['localhost', '127.0.0.1'].includes(publicApi.hostname)) {
    warn('PUBLIC_API_URL מוגדר ל-Local test', `${config.publicApiUrl} — זה צפוי בבדיקת SharePoint מאותו מחשב; לפני מעבר לשרת יש להחליף לכתובת השרת הפנימי`);
  } else if (publicApi.protocol !== 'https:') {
    warn('PUBLIC_API_URL אינו HTTPS', `${config.publicApiUrl} — דף SharePoint ב-HTTPS עלול לחסום HTTP כ-Mixed Content`);
  } else {
    pass('PUBLIC_API_URL מתאים לפריסה מ-SharePoint', config.publicApiUrl);
  }

  // Universal release integrity.
  if (!release.distDir || !fs.existsSync(release.distDir)) {
    fail('Universal dist קיים באחסון', String(release.distDir || '—'));
    throw new Error('Release dist directory is missing.');
  }
  const rawFiles = collectFiles(release.distDir);
  const rawStats = rawFiles.reduce((acc, file) => {
    acc.totalBytes += file.size;
    if (!acc.maxFile || file.size > acc.maxFile.size) acc.maxFile = file;
    return acc;
  }, { totalBytes: 0, maxFile: null });
  pass('Universal dist קיים באחסון', `${rawFiles.length} קבצים · ${formatBytes(rawStats.totalBytes)}`);
  auditLog.info(`largestReleaseFile=${rawStats.maxFile?.path || '—'} size=${formatBytes(rawStats.maxFile?.size || 0)}`);

  const currentReleaseHash = hashDirectory(release.distDir);
  if (currentReleaseHash === release.sha256) pass('Hash של הריליס לא השתנה מאז ההעלאה', currentReleaseHash);
  else fail('Hash של הריליס לא השתנה מאז ההעלאה', `stored=${release.sha256} current=${currentReleaseHash}`);

  if (Number(release.fileCount || 0) === rawFiles.length) pass('מספר קבצי הריליס תואם למסד', `${rawFiles.length}`);
  else fail('מספר קבצי הריליס תואם למסד', `DB=${release.fileCount} actual=${rawFiles.length}`);

  const rawOverlayFiles = rawFiles.filter((file) => DEPLOYMENT_OVERLAY_FILES.has(file.path));
  if (!rawOverlayFiles.length) pass('ה-dist הגולמי אינו מכיל Runtime/Deployment overlays', 'ה-overlays נוצרים רק בזמן פריסה');
  else fail('ה-dist הגולמי אינו מכיל Runtime/Deployment overlays', rawOverlayFiles.map((file) => file.path).join(', '));

  const envFiles = rawFiles.filter((file) => /(^|\/)\.env(?:\.|$)/i.test(file.path));
  if (!envFiles.length) pass('אין קובצי .env בתוך הריליס', 'פרטי האתר אינם נשלחים בתוך ה-dist');
  else fail('אין קובצי .env בתוך הריליס', envFiles.map((file) => file.path).join(', '));

  const targetSpecificNeedles = [
    `https://${site.host}/sites/${site.siteCode}`,
    `/sites/${site.siteCode}/${site.siteDbFolder || 'siteDB'}`,
    `/sites/${site.siteCode}/${site.usersDbFolder || 'siteUsersDb'}`, 
    `VITE_SP_SITE_CODE=${site.siteCode}`,
  ];
  const targetHits = scanTextFiles(release.distDir, targetSpecificNeedles);
  if (!targetHits.length) pass('לא נמצאה זהות אתר היעד צרובה ב-dist', 'האתר יקבל זהות רק מ-Runtime Config');
  else fail('לא נמצאה זהות אתר היעד צרובה ב-dist', targetHits.slice(0, 8).map((hit) => `${hit.file} -> ${hit.needle}`).join(' | '));

  const literalIdentityHits = scanTextPatterns(release.distDir, [
    { name: 'literal-sharepoint-final-dist-path', regex: /\/(?:sites|teams)\/[a-z0-9][a-z0-9-]{1,80}\/[A-Za-z0-9._-]{1,80}\/dist/ig },
    { name: 'literal-sharepoint-users-library-path', regex: /\/(?:sites|teams)\/[a-z0-9][a-z0-9-]{1,80}\/[A-Za-z0-9._-]{1,80}\/widgets_data\.txt/ig },
    { name: 'literal-absolute-sharepoint-final-dist', regex: /https?:\/\/[a-z0-9.-]+\/(?:sites|teams)\/[a-z0-9][a-z0-9-]{1,80}\/[A-Za-z0-9._-]{1,80}\/dist/ig },
  ]);
  if (!literalIdentityHits.length) {
    pass('לא נמצאו נתיבי SharePoint פר-אתר ליטרליים ב-dist', 'סריקה כללית לכל siteCode, לא רק לאתר הנבדק');
  } else if (release.universalProof?.verified === true) {
    warn('נמצאו מחרוזות SharePoint בתוך bundle, אך Manifest אוניברסלי מאומת', literalIdentityHits.slice(0, 8).map((hit) => `${hit.file} -> ${hit.match}`).join(' | '));
  } else {
    fail('נמצאו נתיבי SharePoint פר-אתר בתוך Universal dist ללא הוכחת Manifest אוניברסלי', literalIdentityHits.slice(0, 8).map((hit) => `${hit.file} -> ${hit.match}`).join(' | '));
  }

  const rawIndexCheck = verifyIndexReferences(release.distDir);
  if (!rawIndexCheck.absoluteRootRefs.length) pass('index.html משתמש בנתיבי assets יחסיים', `${rawIndexCheck.refs.length} הפניות מקומיות`);
  else fail('index.html משתמש בנתיבי assets יחסיים', `נתיבים מוחלטים: ${rawIndexCheck.absoluteRootRefs.slice(0, 10).join(', ')}`);
  if (!rawIndexCheck.missing.length) pass('כל קישורי index.html קיימים ב-dist הגולמי', `${rawIndexCheck.refs.length} הפניות נבדקו`);
  else fail('כל קישורי index.html קיימים ב-dist הגולמי', `חסרים: ${rawIndexCheck.missing.slice(0, 10).join(', ')}`);

  // Artifact/manifest contract.
  const artifactFiles = Array.isArray(artifact.files) ? artifact.files : [];
  const uploadOrder = Array.isArray(artifact.uploadOrder) ? artifact.uploadOrder : [];
  if (!uploadOrder.length) throw new Error('Artifact uploadOrder is empty.');
  const artifactPaths = artifactFiles.map((file) => file.path);
  const uniqueArtifactPaths = new Set(artifactPaths);
  const uniqueUploadOrder = new Set(uploadOrder);
  if (uniqueArtifactPaths.size === artifactPaths.length) pass('אין כפילויות ב-Artifact manifest', `${artifactPaths.length} entries`);
  else fail('אין כפילויות ב-Artifact manifest', `${artifactPaths.length - uniqueArtifactPaths.size} כפילויות`);
  if (uniqueUploadOrder.size === uploadOrder.length) pass('אין כפילויות בסדר ההעלאה', `${uploadOrder.length} entries`);
  else fail('אין כפילויות בסדר ההעלאה', `${uploadOrder.length - uniqueUploadOrder.size} כפילויות`);

  const uploadMissingFromManifest = uploadOrder.filter((relativePath) => !uniqueArtifactPaths.has(relativePath));
  const manifestMissingFromOrder = artifactPaths.filter((relativePath) => !uniqueUploadOrder.has(relativePath));
  if (!uploadMissingFromManifest.length && !manifestMissingFromOrder.length) pass('Manifest ו-uploadOrder מכסים בדיוק אותם קבצים', `${artifactPaths.length} קבצים`);
  else fail('Manifest ו-uploadOrder מכסים בדיוק אותם קבצים', `orderMissing=${uploadMissingFromManifest.join(', ')} manifestMissing=${manifestMissingFromOrder.join(', ')}`);

  if (uploadOrder.at(-1) === 'index.html') pass('index.html מועלה אחרון');
  else fail('index.html מועלה אחרון', `הקובץ האחרון הוא ${uploadOrder.at(-1) || '—'}`);

  const overlayArtifactPaths = artifactPaths.filter((filePath) => DEPLOYMENT_OVERLAY_FILES.has(filePath));
  const expectedOverlayPaths = [...DEPLOYMENT_OVERLAY_FILES].sort();
  if (JSON.stringify([...overlayArtifactPaths].sort()) === JSON.stringify(expectedOverlayPaths)) {
    pass('Artifact כולל בדיוק את שלושת ה-overlays', expectedOverlayPaths.join(', '));
  } else {
    fail('Artifact כולל בדיוק את שלושת ה-overlays', overlayArtifactPaths.join(', '));
  }

  // Simulate first-time SharePoint provisioning using the same server-relative layout.
  const seeds = buildSeedFiles(site);
  for (const seed of seeds) writeText(resolveSimulationPath(firstInstallRoot, seed.path), seed.content);
  pass('מבנה TXT ראשוני', `${seeds.length} קובצי seed נוצרו`);
  auditLog.info(`seedFiles=${seeds.map((seed) => seed.path).join(', ')}`);

  const expectedRuntimeForSeeds = canonicalRuntime(site);
  const seedWrongRoot = seeds.filter((seed) => !seed.path.startsWith(`${expectedRuntimeForSeeds.siteAssetsRoot}/`) && seed.path !== `${expectedRuntimeForSeeds.usersDbRoot}/widgets_data.txt` && seed.path !== `${expectedRuntimeForSeeds.siteAssetsRoot}/widgets_data.txt`);
  if (!seedWrongRoot.length) pass('כל קובצי ה-TXT מכוונים לנתיבים הצפויים', `${expectedRuntimeForSeeds.siteAssetsRoot} + ${expectedRuntimeForSeeds.usersDbRoot}`);
  else fail('כל קובצי ה-TXT מכוונים לנתיבים הצפויים', seedWrongRoot.map((seed) => seed.path).join(', '));

  const seedOverwriteFailures = simulateSeedPreservation(existingSiteRoot, seeds);
  if (!seedOverwriteFailures.length) pass('עדכון אתר קיים שומר TXT לא-ריק', `${seeds.length}/${seeds.length} קבצי seed נשמרו`);
  else fail('עדכון אתר קיים שומר TXT לא-ריק', seedOverwriteFailures.map((seed) => seed.path).join(', '));

  const fileMap = new Map(artifactFiles.map((item) => [item.path, item]));
  let copied = 0;
  const hashFailures = [];
  const sizeFailures = [];
  const finalDistRoot = resolveSimulationPath(firstInstallRoot, artifact.site.finalDistRoot);
  ensureDirectory(finalDistRoot);

  for (const relativePath of uploadOrder) {
    if (!isSafeRelativePath(relativePath)) throw new Error(`Unsafe artifact path: ${relativePath}`);
    const source = resolveDeploymentFile(job, release, relativePath);
    if (!source || !fs.existsSync(source)) throw new Error(`Deployment source file missing: ${relativePath}`);
    const target = path.join(finalDistRoot, ...relativePath.split('/'));
    ensureDirectory(path.dirname(target));
    fs.copyFileSync(source, target);
    copied += 1;

    const expected = fileMap.get(relativePath);
    if (expected?.sha256 && hashFile(target) !== expected.sha256) hashFailures.push(relativePath);
    if (Number.isFinite(Number(expected?.size)) && fs.statSync(target).size !== Number(expected.size)) sizeFailures.push(relativePath);
  }

  if (copied === uploadOrder.length) pass('כל קובצי הריליס וה-overlays הועתקו בסימולציה', `${copied}/${uploadOrder.length}`);
  else fail('כל קובצי הריליס וה-overlays הועתקו בסימולציה', `${copied}/${uploadOrder.length}`);
  if (!sizeFailures.length) pass('גודל כל הקבצים תואם ל-Manifest', `${copied} קבצים`);
  else fail('גודל כל הקבצים תואם ל-Manifest', sizeFailures.join(', '));
  if (!hashFailures.length) pass('SHA-256 לכל קבצי הפריסה', 'כל הקבצים זהים למקור');
  else fail('SHA-256 לכל קבצי הפריסה', `${hashFailures.length} קבצים לא תואמים`);

  const runtimePath = path.join(finalDistRoot, 'sitebuilder-runtime-config.json');
  const deploymentPath = path.join(finalDistRoot, 'sitebuilder-deployment.json');
  const releaseManifestPath = path.join(finalDistRoot, 'sharepoint-deploy-manifest.json');
  const bootstrapPath = path.join(finalDistRoot, RUNTIME_BOOTSTRAP_FILE);
  const finalIndexPath = path.join(finalDistRoot, 'index.html');
  const requiredDeploymentFiles = [runtimePath, deploymentPath, releaseManifestPath, bootstrapPath, finalIndexPath];
  const missingRequired = requiredDeploymentFiles.filter((required) => !fs.existsSync(required));
  if (!missingRequired.length) pass('קובצי deployment חובה קיימים', 'runtime config · deployment metadata · runtime bootstrap · manifest · index.html');
  else fail('קובצי deployment חובה קיימים', missingRequired.map((filePath) => path.basename(filePath)).join(', '));

  let runtime = null;
  if (fs.existsSync(runtimePath)) {
    runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    const expectedRuntime = canonicalRuntime(site);
    const mismatches = runtimeMismatches(runtime, expectedRuntime);
    if (!mismatches.length) pass('Runtime Config קנוני ותואם כולו לאתר', `${runtime.host}${runtime.siteRoot}`);
    else fail('Runtime Config קנוני ותואם כולו לאתר', mismatches.slice(0, 12).map((item) => `${item.key}: ${item.actual} != ${item.expected}`).join(' | '));
    auditLog.info(`runtimeConfig=${JSON.stringify(runtime)}`);
  }

  // The browser never reads the .json directly on the real farm; it reads this.
  if (fs.existsSync(bootstrapPath) && runtime) {
    const bootstrapSource = fs.readFileSync(bootstrapPath, 'utf8');
    const bootstrapConfig = parseRuntimeBootstrapConfig(bootstrapSource);
    if (bootstrapSource.includes(RUNTIME_BOOTSTRAP_MARKER) && bootstrapConfig
      && JSON.stringify(bootstrapConfig) === JSON.stringify(runtime)) {
      pass('Runtime Bootstrap JS נושא בדיוק את ה-Runtime Config של האתר', `${bootstrapConfig.targetDistPath}`);
    } else {
      fail('Runtime Bootstrap JS נושא בדיוק את ה-Runtime Config של האתר', bootstrapSource.slice(0, 200));
    }
  }

  if (fs.existsSync(finalIndexPath)) {
    const finalIndexHtml = fs.readFileSync(finalIndexPath, 'utf8');
    const bootstrapIndex = findRuntimeBootstrapIndex(finalIndexHtml);
    const moduleIndex = findFirstModuleScriptIndex(finalIndexHtml);
    const firstScriptIndex = findFirstForeignScriptIndex(finalIndexHtml);
    const where = `bootstrap@${bootstrapIndex} script@${firstScriptIndex} module@${moduleIndex}`;
    if (bootstrapIndex >= 0 && (firstScriptIndex < 0 || bootstrapIndex < firstScriptIndex)) {
      pass('index.html טוען את Runtime Bootstrap לפני כל שאר הסקריפטים', where);
    } else {
      fail('index.html טוען את Runtime Bootstrap לפני כל שאר הסקריפטים', where);
    }
  }

  if (fs.existsSync(deploymentPath)) {
    const metadata = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    const metadataOk = metadata.releaseVersion === release.version
      && metadata.releaseId === String(release._id)
      && metadata.releaseSha256 === release.sha256
      && metadata.siteCode === site.siteCode
      && metadata.host === site.host
      && metadata.storageBackend === 'txt'
      && metadata.targetDistPath === canonicalRuntime(site).targetDistPath;
    if (metadataOk) pass('Deployment metadata תואם לריליס ולאתר', `${release.version} · ${release.sha256.slice(0, 12)}…`);
    else fail('Deployment metadata תואם לריליס ולאתר', JSON.stringify(metadata));
    auditLog.info(`deploymentMetadata=${JSON.stringify(metadata)}`);
  }

  if (fs.existsSync(releaseManifestPath)) {
    const releaseManifest = JSON.parse(fs.readFileSync(releaseManifestPath, 'utf8'));
    const expectedListedFiles = artifactFiles.filter((file) => file.path !== 'sharepoint-deploy-manifest.json').map((file) => file.path).sort();
    const listedFiles = (releaseManifest.files || []).map((file) => file.path).sort();
    // The regenerated manifest follows the Site Builder contract: identity lives
    // under `release` and `target`, not as flat top-level fields.
    const manifestChecks = {
      kind: releaseManifest.kind === MANIFEST_KIND,
      schemaVersion: SUPPORTED_MANIFEST_SCHEMA_VERSIONS.includes(Number(releaseManifest.schemaVersion)),
      buildMode: String(releaseManifest.buildMode || '').toLowerCase() === 'universal',
      requiresRuntimeConfig: releaseManifest.requiresRuntimeConfig === true,
      commitFile: releaseManifest.commitFile === 'index.html',
      releaseId: releaseManifest.release?.id === String(release._id),
      releaseVersion: releaseManifest.release?.version === release.version,
      releaseSha256: releaseManifest.release?.sha256 === release.sha256,
      host: releaseManifest.target?.host === site.host,
      siteCode: releaseManifest.target?.siteCode === site.siteCode,
    };
    const manifestProblems = Object.entries(manifestChecks).filter(([, ok]) => !ok).map(([name]) => name);
    if (!manifestProblems.length) pass('SharePoint release manifest metadata תקין', `${listedFiles.length} קבצים רשומים`);
    else fail('SharePoint release manifest metadata תקין', `שדות לא תקינים: ${manifestProblems.join(', ')}`);
    if (JSON.stringify(listedFiles) === JSON.stringify(expectedListedFiles)) pass('SharePoint manifest מכסה את קבצי הפריסה הצפויים', `${listedFiles.length} entries`);
    else fail('SharePoint manifest מכסה את קבצי הפריסה הצפויים', `listed=${listedFiles.length} expected=${expectedListedFiles.length}`);
  }

  const referenceCheck = verifyIndexReferences(finalDistRoot);
  if (!referenceCheck.missing.length) pass('קישורי index.html קיימים ב-dist הסופי', `${referenceCheck.refs.length} הפניות מקומיות נבדקו`);
  else fail('קישורי index.html קיימים ב-dist הסופי', `חסרים: ${referenceCheck.missing.slice(0, 10).join(', ')}`);
  if (!referenceCheck.absoluteRootRefs.length) pass('אין index.html עם נתיבי root שעלולים לשבור SharePoint', 'כל ההפניות המקומיות יחסיות');
  else fail('אין index.html עם נתיבי root שעלולים לשבור SharePoint', referenceCheck.absoluteRootRefs.join(', '));

  if (job.deployerUrl) {
    let deployerUrl;
    try { deployerUrl = new URL(job.deployerUrl); } catch { deployerUrl = null; }
    if (deployerUrl && deployerUrl.hostname.toLowerCase() === site.host.toLowerCase()) pass('Deployer URL מכוון ל-Host הנכון', deployerUrl.origin + deployerUrl.pathname);
    else fail('Deployer URL מכוון ל-Host הנכון', job.deployerUrl);
    if (deployerUrl?.searchParams.get('jobId') === jobId) pass('Deployer URL מכיל jobId נכון', jobId);
    else fail('Deployer URL מכיל jobId נכון', deployerUrl?.searchParams.get('jobId') || '—');
    if (deployerUrl?.searchParams.get('apiBase') === config.publicApiUrl) pass('Deployer URL מקבל PUBLIC_API_URL הנוכחי', config.publicApiUrl);
    else fail('Deployer URL מקבל PUBLIC_API_URL הנוכחי', deployerUrl?.searchParams.get('apiBase') || '—');
  } else {
    fail('Deployer URL נוצר למשימה');
  }

  warn('SharePoint REST / cookies / FormDigest / הרשאות', 'לא ניתן להוכיח מקומית; זו בדיקת ה-Smoke היחידה שנשארת ברשת האמיתית');
  warn('ה-Deployer מותקן בפועל בכל SharePoint Host', `נבדק רק build מקומי. יש להעלות פעם אחת ל-${config.sharePointDeployerPath}`);

  const failedChecks = checks.filter((item) => item.status === 'fail');
  const warningChecks = checks.filter((item) => item.status === 'warn');
  const passedChecks = checks.filter((item) => item.status === 'pass');
  const report = {
    ok: failedChecks.length === 0,
    mode: 'local-sharepoint-deep-audit',
    checkedAt: new Date().toISOString(),
    summary: { passed: passedChecks.length, warnings: warningChecks.length, failed: failedChecks.length },
    site: { host: site.host, siteCode: site.siteCode, finalDistRoot: artifact.site.finalDistRoot, finalUrl: artifact.site.finalUrl },
    release: {
      id: String(release._id),
      version: release.version,
      sha256: release.sha256,
      fileCount: rawFiles.length,
      totalBytes: rawStats.totalBytes,
      largestFile: rawStats.maxFile,
    },
    environment: {
      mongoDbName: config.mongoDbName,
      storageRoot: config.storageRoot,
      sharePointHosts: config.sharePointHosts,
      sharePointDeployerPath: config.sharePointDeployerPath,
      publicApiUrl: config.publicApiUrl,
    },
    runtimeConfig: runtime,
    artifact: {
      manifestPath: job.manifestPath,
      fileCount: artifactFiles.length,
      uploadOrderCount: uploadOrder.length,
      uploadFirst: uploadOrder[0] || null,
      uploadLast: uploadOrder.at(-1) || null,
    },
    fileCount: copied,
    simulationRoot,
    reportPath: path.join(simulationRoot, 'local-verification-report.json'),
    checks,
    logLines: auditLog.lines,
    limitation: 'כל מה שאפשר לבדוק ללא SharePoint אמיתי נבדק כאן. מה שנותר לרשת הסגורה: גישה אמיתית ל-SharePoint REST, session/cookies, FormDigest, הרשאות, CORS/network reachability והתקנת ה-Deployer בפועל על ה-Host.',
  };

  auditLog.info(`summary=PASS:${passedChecks.length} WARN:${warningChecks.length} FAIL:${failedChecks.length}`);
  auditLog.info(`reportPath=${report.reportPath}`);
  auditLog.info(`=== SITE RELEASE MANAGER LOCAL DEEP AUDIT ${report.ok ? 'PASSED' : 'FAILED'} ===`);
  report.logLines = [...auditLog.lines];

  fs.writeFileSync(report.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await db.collection('deployment_jobs').updateOne(
    { _id: objectId },
    {
      $set: { localVerification: report, updatedAt: new Date() },
      $push: { logs: { $each: report.logLines, $slice: -500 } },
    },
  );

  return report;
}
