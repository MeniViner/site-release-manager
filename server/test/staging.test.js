/**
 * Fresh-staging guarantees.
 *
 * These tests use the real Site Builder dist-universal when it is available, so
 * they exercise the actual artifact shape rather than a hand-made fixture.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  createStaging, writeTargetOverlay, injectRuntimeBootstrap, regenerateManifest, verifyStaging,
  buildUploadOrder, destroyStaging, REGENERATED_FILES, StagingError,
} from '../src/services/stagingService.js';
import { buildSiteIdentity } from '../../shared/siteRuntime.js';
import {
  RUNTIME_CONFIG_FILE, DEPLOYMENT_METADATA_FILE, RUNTIME_BOOTSTRAP_FILE, MANIFEST_FILE,
  validateUniversalManifest, parseIndexReferencesFromHtml,
} from '../../shared/universalManifest.js';
import {
  RUNTIME_BOOTSTRAP_MARKER, RUNTIME_BOOTSTRAP_LEGACY_GLOBAL, parseRuntimeBootstrapConfig,
  findFirstModuleScriptIndex, findRuntimeBootstrapIndex, injectRuntimeBootstrapIntoIndexHtml,
  hasRuntimeBootstrapReference, countRuntimeBootstrapReferences,
} from '../../shared/runtimeBootstrap.js';
import { hashDirectory } from '../src/utils/files.js';

const SITE_BUILDER_ROOT = process.env.SITE_BUILDER_PATH || path.resolve(process.cwd(), '..', '..', 'site-builder');
const REAL_DIST = path.join(SITE_BUILDER_ROOT, 'dist-universal');
const hasRealDist = fs.existsSync(path.join(REAL_DIST, 'index.html'));

const RELEASE = { _id: 'release-1', version: '1.4.0', sha256: 'deadbeef' };

/** A small synthetic Universal artifact for the tests that do not need the real one. */
function makeArtifact() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-artifact-'));
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'console.log("universal build")');
  fs.writeFileSync(path.join(root, 'assets', 'app.css'), 'body{margin:0}');
  // Shaped like a real Vite index.html: the entry point is a module script.
  fs.writeFileSync(path.join(root, 'index.html'), [
    '<!DOCTYPE html>',
    '<html lang="he" dir="rtl">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <link rel="stylesheet" crossorigin href="./assets/app.css">',
    '    <script type="module" crossorigin src="./assets/app.js"></script>',
    '  </head>',
    '  <body><div id="root"></div></body>',
    '</html>',
    '',
  ].join('\n'));
  return root;
}

/** Stage and write the overlay only, leaving index.html for the test to shape. */
function stageOverlayOnly(sourceDist, site = { host: 'portal.army.idf', siteCode: 'schedule' }, jobId = 'job-shape') {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), `srm-staging-${jobId}-`));
  const identity = buildSiteIdentity(site);
  const staging = createStaging({ releaseDistDir: sourceDist, stagingRoot });
  writeTargetOverlay({ distDir: staging.distDir, identity, release: RELEASE, jobId, deployedAt: '2026-08-31T00:00:00.000Z' });
  return { stagingRoot, distDir: staging.distDir, identity };
}

function stage(sourceDist, site, jobId) {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), `srm-staging-${jobId}-`));
  const identity = buildSiteIdentity(site);
  const staging = createStaging({ releaseDistDir: sourceDist, stagingRoot });
  const overlay = writeTargetOverlay({ distDir: staging.distDir, identity, release: RELEASE, jobId, deployedAt: '2026-08-31T00:00:00.000Z' });
  // Exactly the production ordering: overlay -> bootstrap injection -> manifest.
  const injection = injectRuntimeBootstrap({ distDir: staging.distDir });
  const manifest = regenerateManifest({ distDir: staging.distDir, release: RELEASE, identity, jobId, sourceProof: { buildId: 'source-build-id', generatedAt: '2026-08-18T10:34:32.820Z', schemaVersion: 4, storageCompatibility: ['txt', 'mongo'] } });
  verifyStaging({ distDir: staging.distDir, manifest });
  return { stagingRoot, distDir: staging.distDir, manifest, identity, overlay, injection };
}

test('the stored release artifact is never mutated by a deployment', () => {
  const source = makeArtifact();
  try {
    const before = hashDirectory(source);
    const a = stage(source, { host: 'portal.army.idf', siteCode: 'schedule' }, 'job-a');
    try {
      assert.equal(hashDirectory(source), before, 'the immutable release directory changed during staging');
      assert.equal(fs.existsSync(path.join(source, RUNTIME_CONFIG_FILE)), false);
      assert.equal(fs.existsSync(path.join(source, MANIFEST_FILE)), false);
    } finally { destroyStaging(a.stagingRoot); }
  } finally { fs.rmSync(source, { recursive: true, force: true }); }
});

test('target B never inherits target A runtime identity', () => {
  const source = makeArtifact();
  const jobs = [];
  try {
    const a = stage(source, { host: 'portal.army.idf', siteCode: 'schedule' }, 'job-a');
    jobs.push(a.stagingRoot);
    const b = stage(source, {
      host: 'mazi.army.idf', siteCode: 'finance',
      siteDbFolder: 'siteDBFinance', usersDbFolder: 'siteUsersDBFinance', widgetsDbTarget: 'site',
    }, 'job-b');
    jobs.push(b.stagingRoot);

    const configA = JSON.parse(fs.readFileSync(path.join(a.distDir, RUNTIME_CONFIG_FILE), 'utf8'));
    const configB = JSON.parse(fs.readFileSync(path.join(b.distDir, RUNTIME_CONFIG_FILE), 'utf8'));

    assert.equal(configA.targetDistPath, '/sites/schedule/siteDB/dist');
    assert.equal(configB.targetDistPath, '/sites/finance/siteDBFinance/dist');
    assert.equal(configA.widgetsDbTarget, 'users');
    assert.equal(configB.widgetsDbTarget, 'site');

    // No value from A may appear anywhere in B's staged overlay.
    const bOverlay = [
      fs.readFileSync(path.join(b.distDir, RUNTIME_CONFIG_FILE), 'utf8'),
      fs.readFileSync(path.join(b.distDir, DEPLOYMENT_METADATA_FILE), 'utf8'),
      fs.readFileSync(path.join(b.distDir, MANIFEST_FILE), 'utf8'),
    ].join('\n');
    for (const leak of ['/sites/schedule', 'portal.army.idf', 'job-a']) {
      assert.equal(bOverlay.includes(leak), false, `target B overlay leaked "${leak}" from target A`);
    }

    // The shared application bundle must be byte-identical between targets.
    assert.equal(
      fs.readFileSync(path.join(a.distDir, 'assets', 'app.js'), 'utf8'),
      fs.readFileSync(path.join(b.distDir, 'assets', 'app.js'), 'utf8'),
    );
  } finally {
    for (const root of jobs) destroyStaging(root);
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('a target overlay left in the source artifact is stripped defensively', () => {
  const source = makeArtifact();
  try {
    fs.writeFileSync(path.join(source, RUNTIME_CONFIG_FILE), JSON.stringify({ host: 'contaminated.host', siteCode: 'other' }));
    fs.writeFileSync(path.join(source, DEPLOYMENT_METADATA_FILE), JSON.stringify({ siteCode: 'other' }));
    const a = stage(source, { host: 'portal.army.idf', siteCode: 'schedule' }, 'job-a');
    try {
      const config = JSON.parse(fs.readFileSync(path.join(a.distDir, RUNTIME_CONFIG_FILE), 'utf8'));
      assert.equal(config.host, 'portal.army.idf');
      assert.equal(config.siteCode, 'schedule');
      assert.equal(fs.readFileSync(path.join(a.distDir, RUNTIME_CONFIG_FILE), 'utf8').includes('contaminated.host'), false);
    } finally { destroyStaging(a.stagingRoot); }
  } finally { fs.rmSync(source, { recursive: true, force: true }); }
});

test('the regenerated manifest includes the overlay and commits index.html last', () => {
  const source = makeArtifact();
  try {
    const a = stage(source, { host: 'portal.army.idf', siteCode: 'schedule' }, 'job-a');
    try {
      const paths = a.manifest.files.map((file) => file.path);
      assert.ok(paths.includes(RUNTIME_CONFIG_FILE));
      assert.ok(paths.includes(DEPLOYMENT_METADATA_FILE));
      assert.equal(paths.includes(MANIFEST_FILE), false, 'the manifest must not list itself');
      const order = buildUploadOrder(a.manifest);
      assert.equal(order.at(-1), 'index.html');
      assert.equal(order.filter((entry) => entry === 'index.html').length, 1);
      assert.equal(a.manifest.sourceBuild.buildId, 'source-build-id', 'source provenance must be preserved');
    } finally { destroyStaging(a.stagingRoot); }
  } finally { fs.rmSync(source, { recursive: true, force: true }); }
});

test('staging verification catches a tampered staged file', () => {
  const source = makeArtifact();
  try {
    const a = stage(source, { host: 'portal.army.idf', siteCode: 'schedule' }, 'job-a');
    try {
      fs.writeFileSync(path.join(a.distDir, 'assets', 'app.js'), 'tampered');
      assert.throws(
        () => verifyStaging({ distDir: a.distDir, manifest: a.manifest }),
        (error) => {
          assert.ok(error instanceof StagingError);
          assert.ok(error.problems.some((problem) => problem.includes('app.js')));
          return true;
        },
      );
    } finally { destroyStaging(a.stagingRoot); }
  } finally { fs.rmSync(source, { recursive: true, force: true }); }
});

test('every regenerated file name is excluded from the staging copy', () => {
  assert.deepEqual(
    [...REGENERATED_FILES].sort(),
    [DEPLOYMENT_METADATA_FILE, MANIFEST_FILE, RUNTIME_CONFIG_FILE, RUNTIME_BOOTSTRAP_FILE].sort(),
  );
});

test('the real Site Builder dist-universal stages and re-verifies cleanly', (t) => {
  if (!hasRealDist) { t.skip('site-builder/dist-universal is not present.'); return; }
  const a = stage(REAL_DIST, { host: 'portal.army.idf', siteCode: 'schedule' }, 'job-real');
  try {
    const report = validateUniversalManifest(a.manifest, { allowTargetOverlay: true });
    assert.deepEqual(report.errors, [], `regenerated manifest is invalid: ${report.errors.join(' | ')}`);
    assert.ok(a.manifest.files.length > 40);
    assert.ok(a.manifest.indexReferences.length > 0);
    const order = buildUploadOrder(a.manifest);
    assert.equal(order.at(-1), 'index.html');

    // The real Vite index must end up loading the bootstrap before its module entry.
    const html = fs.readFileSync(path.join(a.distDir, 'index.html'), 'utf8');
    const bootstrapIndex = findRuntimeBootstrapIndex(html);
    const moduleIndex = findFirstModuleScriptIndex(html);
    assert.ok(bootstrapIndex >= 0, 'the real staged index.html must reference the runtime bootstrap');
    assert.ok(moduleIndex >= 0, 'the real Site Builder index.html is expected to use a module script');
    assert.ok(bootstrapIndex < moduleIndex, 'the bootstrap must load before the Site Builder module entry');
    assert.ok(a.manifest.indexReferences.includes(RUNTIME_BOOTSTRAP_FILE));
  } finally { destroyStaging(a.stagingRoot); }
});

// --- Runtime bootstrap overlay ---------------------------------------------

test('staging generates a runtime bootstrap carrying this target runtime config exactly', () => {
  const source = makeArtifact();
  try {
    const a = stage(source, { host: 'portal.army.idf', siteCode: 'schedule' }, 'job-a');
    try {
      const bootstrapPath = path.join(a.distDir, RUNTIME_BOOTSTRAP_FILE);
      assert.ok(fs.existsSync(bootstrapPath), 'the bootstrap must exist in staging');
      const source_ = fs.readFileSync(bootstrapPath, 'utf8');
      assert.ok(source_.includes(RUNTIME_BOOTSTRAP_MARKER));
      assert.ok(source_.includes(`window.${RUNTIME_BOOTSTRAP_LEGACY_GLOBAL} = window.SITE_BUILDER_RUNTIME_CONFIG;`));

      // Byte-for-byte the same object as the authoritative JSON overlay.
      const fromJson = JSON.parse(fs.readFileSync(path.join(a.distDir, RUNTIME_CONFIG_FILE), 'utf8'));
      const fromBootstrap = parseRuntimeBootstrapConfig(source_);
      assert.deepEqual(fromBootstrap, fromJson);
      assert.equal(fromBootstrap.targetDistPath, '/sites/schedule/siteDB/dist');
      assert.equal(fromBootstrap.deploymentJobId, 'job-a');
      assert.equal(fromBootstrap.releaseId, 'release-1');
      assert.equal(fromBootstrap.releaseVersion, '1.4.0');

      // Valid, executable JavaScript that populates both globals.
      const scope = {};
      // eslint-disable-next-line no-new-func
      new Function('window', source_)(scope);
      assert.deepEqual(scope.SITE_BUILDER_RUNTIME_CONFIG, fromJson);
      assert.equal(scope.__SITE_BUILDER_RUNTIME_CONFIG__, scope.SITE_BUILDER_RUNTIME_CONFIG);
      assert.equal(Object.isFrozen(scope.SITE_BUILDER_RUNTIME_CONFIG), true);
    } finally { destroyStaging(a.stagingRoot); }
  } finally { fs.rmSync(source, { recursive: true, force: true }); }
});

test('a target A bootstrap can never carry target B identity', () => {
  const source = makeArtifact();
  const jobs = [];
  try {
    const a = stage(source, { host: 'portal.army.idf', siteCode: 'schedule' }, 'job-a');
    jobs.push(a.stagingRoot);
    const b = stage(source, {
      host: 'mazi.army.idf', siteCode: 'finance',
      siteDbFolder: 'siteDBFinance', usersDbFolder: 'siteUsersDBFinance', widgetsDbTarget: 'site',
    }, 'job-b');
    jobs.push(b.stagingRoot);

    const bootstrapA = fs.readFileSync(path.join(a.distDir, RUNTIME_BOOTSTRAP_FILE), 'utf8');
    const bootstrapB = fs.readFileSync(path.join(b.distDir, RUNTIME_BOOTSTRAP_FILE), 'utf8');
    const configA = parseRuntimeBootstrapConfig(bootstrapA);
    const configB = parseRuntimeBootstrapConfig(bootstrapB);

    assert.equal(configA.targetDistPath, '/sites/schedule/siteDB/dist');
    assert.equal(configB.targetDistPath, '/sites/finance/siteDBFinance/dist');
    assert.equal(configA.widgetsDbTarget, 'users');
    assert.equal(configB.widgetsDbTarget, 'site');
    for (const leak of ['/sites/schedule', 'portal.army.idf', 'job-a', 'siteDBFinance']) {
      const inWrongFile = leak === 'siteDBFinance' ? bootstrapA : bootstrapB;
      assert.equal(inWrongFile.includes(leak), false, `bootstrap leaked "${leak}" across targets`);
    }
  } finally {
    for (const root of jobs) destroyStaging(root);
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('two logical targets under the same SharePoint Web keep separate bootstraps', () => {
  const source = makeArtifact();
  const jobs = [];
  try {
    const a = stage(source, { host: 'portal.army.idf', siteCode: 'schedule' }, 'job-a');
    jobs.push(a.stagingRoot);
    const b = stage(source, {
      host: 'portal.army.idf', siteCode: 'schedule',
      siteDbFolder: 'siteDB1', usersDbFolder: 'siteUsersDb1',
    }, 'job-b');
    jobs.push(b.stagingRoot);

    const configA = parseRuntimeBootstrapConfig(fs.readFileSync(path.join(a.distDir, RUNTIME_BOOTSTRAP_FILE), 'utf8'));
    const configB = parseRuntimeBootstrapConfig(fs.readFileSync(path.join(b.distDir, RUNTIME_BOOTSTRAP_FILE), 'utf8'));
    assert.equal(configA.siteCode, configB.siteCode);
    assert.notEqual(configA.siteDbRoot, configB.siteDbRoot);
    assert.notEqual(configA.usersDbRoot, configB.usersDbRoot);
    assert.notEqual(configA.targetDistPath, configB.targetDistPath);
    assert.notEqual(configA.finalAppUrl, configB.finalAppUrl);
  } finally {
    for (const root of jobs) destroyStaging(root);
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('the bootstrap script is injected before the first module script and only once', () => {
  const source = makeArtifact();
  try {
    const a = stage(source, { host: 'portal.army.idf', siteCode: 'schedule' }, 'job-a');
    try {
      const html = fs.readFileSync(path.join(a.distDir, 'index.html'), 'utf8');
      const bootstrapIndex = findRuntimeBootstrapIndex(html);
      const moduleIndex = findFirstModuleScriptIndex(html);
      assert.ok(bootstrapIndex >= 0);
      assert.ok(moduleIndex >= 0);
      assert.ok(bootstrapIndex < moduleIndex, 'the bootstrap must be parsed before the module bundle');
      assert.equal(a.injection.injected, true);
      assert.equal(a.injection.anchor, 'module-script');
      assert.equal(html.split(RUNTIME_BOOTSTRAP_FILE).length - 1, 1, 'exactly one bootstrap reference');

      // Idempotent: re-running the injection changes nothing.
      const again = injectRuntimeBootstrap({ distDir: a.distDir });
      assert.equal(again.injected, false);
      assert.equal(fs.readFileSync(path.join(a.distDir, 'index.html'), 'utf8'), html);
    } finally { destroyStaging(a.stagingRoot); }
  } finally { fs.rmSync(source, { recursive: true, force: true }); }
});

test('index injection falls back to </head> when there is no module script', () => {
  const withoutModule = '<html>\n  <head>\n    <link href="./assets/app.css">\n  </head>\n  <body></body>\n</html>\n';
  const once = injectRuntimeBootstrapIntoIndexHtml(withoutModule);
  assert.equal(once.injected, true);
  assert.equal(once.anchor, 'head-close');
  assert.ok(once.html.indexOf(RUNTIME_BOOTSTRAP_FILE) < once.html.indexOf('</head>'));
  const twice = injectRuntimeBootstrapIntoIndexHtml(once.html);
  assert.equal(twice.injected, false);
  assert.equal(twice.html, once.html);
});

test('a commented-out module script is never used as the injection anchor', () => {
  // A comment is inert in the browser. Anchoring on it would bury the bootstrap
  // inside the comment, where it would look present to every check and still
  // never execute.
  const html = '<html><head>\n'
    + '  <!-- dev only: <script type="module" src="/src/main.jsx"></script> -->\n'
    + '  <script type="module" crossorigin src="./assets/index-Bx8sT2q9.js"></script>\n'
    + '</head><body></body></html>';
  const result = injectRuntimeBootstrapIntoIndexHtml(html);

  assert.equal(result.injected, true);
  assert.equal(result.anchor, 'module-script');
  const commentEnd = result.html.indexOf('-->');
  assert.ok(result.bootstrapIndex > commentEnd, 'the bootstrap must be injected outside the comment');
  assert.ok(result.bootstrapIndex < result.html.indexOf('index-Bx8sT2q9.js'));
  assert.equal(countRuntimeBootstrapReferences(result.html), 1);
});

test('a bootstrap reference that only exists inside a comment is not treated as present', () => {
  const commented = '<html><head>\n'
    + `  <!-- <script src="./${RUNTIME_BOOTSTRAP_FILE}"></script> -->\n`
    + '  <script type="module" src="./assets/app.js"></script>\n'
    + '</head><body></body></html>';
  assert.equal(hasRuntimeBootstrapReference(commented), false);
  assert.equal(countRuntimeBootstrapReferences(commented), 0);

  const result = injectRuntimeBootstrapIntoIndexHtml(commented);
  assert.equal(result.injected, true, 'a commented reference must not suppress the real injection');
  assert.equal(countRuntimeBootstrapReferences(result.html), 1);
  assert.ok(result.bootstrapIndex < result.moduleIndex);
});

test('the bootstrap wins against a classic non-module script too', () => {
  // Classic scripts execute in document order, so anchoring on </head> would put
  // the bootstrap AFTER the script that consumes the global.
  const legacy = '<html>\n  <head>\n    <script src="./assets/app-legacy.js"></script>\n  </head>\n  <body></body>\n</html>\n';
  const result = injectRuntimeBootstrapIntoIndexHtml(legacy);

  assert.equal(result.injected, true);
  assert.equal(result.anchor, 'first-script');
  assert.equal(result.moduleIndex, -1);
  assert.ok(result.bootstrapIndex < result.html.indexOf('app-legacy.js'));
  assert.ok(result.bootstrapIndex < result.firstScriptIndex);
});

test('staging rejects an index whose bootstrap tag is hidden inside a comment', () => {
  const source = makeArtifact();
  try {
    const staged = stageOverlayOnly(source);
    try {
      const indexPath = path.join(staged.distDir, 'index.html');
      fs.writeFileSync(indexPath, '<html><head>\n'
        + `  <!-- <script src="./${RUNTIME_BOOTSTRAP_FILE}"></script> -->\n`
        + '  <script type="module" src="./assets/app.js"></script>\n'
        + '</head><body></body></html>', 'utf8');

      // Injection must still add a live tag rather than trusting the comment.
      const injection = injectRuntimeBootstrap({ distDir: staged.distDir });
      assert.equal(injection.injected, true);
      const html = fs.readFileSync(indexPath, 'utf8');
      assert.equal(countRuntimeBootstrapReferences(html), 1);
      assert.ok(injection.bootstrapIndex < injection.firstScriptIndex);
    } finally { destroyStaging(staged.stagingRoot); }
  } finally { fs.rmSync(source, { recursive: true, force: true }); }
});

test('index injection does not depend on hashed bundle filenames', () => {
  const hashed = '<html><head><script type="module" crossorigin src="./assets/index-Bx8sT2q9.js"></script></head><body></body></html>';
  const result = injectRuntimeBootstrapIntoIndexHtml(hashed);
  assert.equal(result.injected, true);
  assert.equal(result.anchor, 'module-script');
  assert.ok(result.bootstrapIndex < result.moduleIndex);
  assert.ok(result.html.includes('index-Bx8sT2q9.js'), 'the hashed bundle reference must survive untouched');
});

test('the regenerated manifest records the bootstrap and the modified index exactly', () => {
  const source = makeArtifact();
  try {
    const a = stage(source, { host: 'portal.army.idf', siteCode: 'schedule' }, 'job-a');
    try {
      const entries = new Map(a.manifest.files.map((file) => [file.path, file]));
      for (const name of [RUNTIME_BOOTSTRAP_FILE, 'index.html']) {
        const entry = entries.get(name);
        assert.ok(entry, `${name} must be listed in the regenerated manifest`);
        const full = path.join(a.distDir, name);
        assert.equal(entry.size, fs.statSync(full).size, `${name} size must match the staged file`);
        assert.equal(
          entry.sha256,
          crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'),
          `${name} sha256 must match the staged file`,
        );
      }
      assert.ok(a.manifest.indexReferences.includes(RUNTIME_BOOTSTRAP_FILE));
      assert.equal(a.manifest.runtimeBootstrapFile, RUNTIME_BOOTSTRAP_FILE);

      // The manifest must describe the MODIFIED index, not the source index.
      const sourceIndex = fs.readFileSync(path.join(source, 'index.html'), 'utf8');
      assert.equal(parseIndexReferencesFromHtml(sourceIndex).includes(RUNTIME_BOOTSTRAP_FILE), false);
      assert.notEqual(entries.get('index.html').size, Buffer.byteLength(sourceIndex, 'utf8'));

      // index.html is still the last file uploaded.
      assert.equal(buildUploadOrder(a.manifest).at(-1), 'index.html');
    } finally { destroyStaging(a.stagingRoot); }
  } finally { fs.rmSync(source, { recursive: true, force: true }); }
});

test('a stale bootstrap left in the source artifact is stripped defensively', () => {
  const source = makeArtifact();
  try {
    fs.writeFileSync(
      path.join(source, RUNTIME_BOOTSTRAP_FILE),
      'window.SITE_BUILDER_RUNTIME_CONFIG = Object.freeze({"host":"contaminated.host"});\n',
    );
    const a = stage(source, { host: 'portal.army.idf', siteCode: 'schedule' }, 'job-a');
    try {
      const staged = fs.readFileSync(path.join(a.distDir, RUNTIME_BOOTSTRAP_FILE), 'utf8');
      assert.equal(staged.includes('contaminated.host'), false);
      assert.equal(parseRuntimeBootstrapConfig(staged).host, 'portal.army.idf');
    } finally { destroyStaging(a.stagingRoot); }
  } finally { fs.rmSync(source, { recursive: true, force: true }); }
});

test('staging verification fails when the manifest predates the index injection', () => {
  const source = makeArtifact();
  try {
    const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-staging-order-'));
    const identity = buildSiteIdentity({ host: 'portal.army.idf', siteCode: 'schedule' });
    try {
      const staging = createStaging({ releaseDistDir: source, stagingRoot });
      writeTargetOverlay({ distDir: staging.distDir, identity, release: RELEASE, jobId: 'job-a', deployedAt: '2026-08-31T00:00:00.000Z' });
      // Wrong order on purpose: manifest regenerated BEFORE the injection.
      const manifest = regenerateManifest({ distDir: staging.distDir, release: RELEASE, identity, jobId: 'job-a' });
      assert.throws(
        () => verifyStaging({ distDir: staging.distDir, manifest }),
        (error) => {
          assert.ok(error instanceof StagingError);
          assert.ok(error.problems.some((problem) => problem.includes(RUNTIME_BOOTSTRAP_FILE)));
          return true;
        },
      );
    } finally { destroyStaging(stagingRoot); }
  } finally { fs.rmSync(source, { recursive: true, force: true }); }
});
