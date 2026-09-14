const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..', '..');
const sourceRoot = path.join(root, 'server', 'src');
const sharedRoot = path.join(root, 'shared');
const mirroredSharedRoot = path.join(sourceRoot, 'shared');

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? javascriptFiles(fullPath) : entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

function withoutCommentsAndLiterals(source) {
  let output = '';
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (character === '/' && next === '/') {
      index = source.indexOf('\n', index + 2);
      if (index < 0) break;
      output += '\n';
      index += 1;
    } else if (character === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 2;
      output += ' ';
    } else if (character === '"' || character === "'" || character === '`') {
      const quote = character;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2;
        } else if (source[index] === quote) {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      output += ' ';
    } else {
      output += character;
      index += 1;
    }
  }
  return output;
}

function productionSharedNames() {
  return javascriptFiles(sourceRoot)
    .flatMap((file) => [...fs.readFileSync(file, 'utf8').matchAll(/require\((['"])([^'"]+)\1\)/g)])
    .map((match) => match[2])
    .filter((specifier) => specifier.includes('/shared/'))
    .map((specifier) => path.basename(specifier))
    .sort();
}

test('production server files contain no executable ESM syntax', () => {
  const violations = [];
  for (const file of javascriptFiles(sourceRoot)) {
    const executable = withoutCommentsAndLiterals(fs.readFileSync(file, 'utf8'));
    if (/\bimport\s*(?:\(|[\w${*])/.test(executable) || /\bexport\s+(?:default|const|let|var|async|function|class|\{)/.test(executable)) {
      violations.push(path.relative(root, file));
    }
  }
  assert.deepEqual(violations, []);
});

test('production server modules load through native require without ESM errors', () => {
  assert.doesNotThrow(() => require('../src/app.js'));
  assert.doesNotThrow(() => require('../src/db.js'));
  for (const file of javascriptFiles(sourceRoot)) {
    if (file === path.join(sourceRoot, 'index.js')) continue;
    assert.doesNotThrow(() => require(file), path.relative(root, file));
  }
});

test('IIS entrypoint is native CommonJS and web.config targets it', () => {
  const entry = fs.readFileSync(path.join(root, 'index.cjs'), 'utf8');
  const webConfig = fs.readFileSync(path.join(root, 'web.config'), 'utf8');
  assert.match(entry, /\brequire\(/);
  assert.doesNotMatch(withoutCommentsAndLiterals(entry), /\bimport\s*(?:\(|[\w${*])/);
  assert.match(webConfig, /path="index\.cjs"/);
  assert.match(webConfig, /url="index\.cjs"/);
});

test('the production dependency graph is self-contained in server/src and server/node_modules', () => {
  const missingLocalDependencies = [];
  const invalidDependencies = [];
  for (const file of javascriptFiles(sourceRoot)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/require\((['"])([^'"]+)\1\)/g)) {
      const specifier = match[2];
      if (specifier.startsWith('.')) {
        const target = path.resolve(path.dirname(file), specifier);
        if (!fs.existsSync(target)) missingLocalDependencies.push(`${path.relative(root, file)} -> ${specifier}`);
      } else if (!specifier.startsWith('node:') && !['express', 'cors', 'multer', 'mongodb', 'dotenv', 'adm-zip'].includes(specifier)) {
        invalidDependencies.push(`${path.relative(root, file)} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(missingLocalDependencies, []);
  assert.deepEqual(invalidDependencies, []);
  assert.deepEqual(
    [...new Set(productionSharedNames())],
    ['deploymentStages.js', 'runtimeBootstrap.js', 'siteRuntime.js', 'universalManifest.js'],
  );
  const packageSource = fs.readFileSync(path.join(root, 'scripts', 'create-iis-package.mjs'), 'utf8');
  assert.match(packageSource, /copyDir\('server\/src'/);
  assert.match(packageSource, /copyDir\('server\/node_modules'/);
  assert.doesNotMatch(packageSource, /copyDir\('shared'/);
});

test('CommonJS shared contract mirrors retain representative ESM behavior', async () => {
  const names = fs.readdirSync(mirroredSharedRoot).filter((name) => name.endsWith('.js')).sort();
  for (const name of names) {
    const commonjs = require(path.join(mirroredSharedRoot, name));
    const esm = await import(pathToFileURL(path.join(sharedRoot, name)).href);
    assert.deepEqual(Object.keys(commonjs).sort(), Object.keys(esm).sort(), `${name} export surface`);
  }

  const siteRuntime = require(path.join(mirroredSharedRoot, 'siteRuntime.js'));
  const esmSiteRuntime = await import(pathToFileURL(path.join(sharedRoot, 'siteRuntime.js')).href);
  for (const input of [
    { host: 'portal.army.idf', siteCode: 'schedule' },
    { host: 'mazi.army.idf', siteCode: 'alpha', siteDbFolder: 'siteDBFinance', usersDbFolder: 'siteUsersDBFinance', widgetsDbTarget: 'site' },
  ]) {
    assert.deepEqual(siteRuntime.buildSiteIdentity(input), esmSiteRuntime.buildSiteIdentity(input));
    assert.deepEqual(siteRuntime.buildTxtSeedPlan(siteRuntime.buildSiteIdentity(input)), esmSiteRuntime.buildTxtSeedPlan(esmSiteRuntime.buildSiteIdentity(input)));
  }

  const stages = require(path.join(mirroredSharedRoot, 'deploymentStages.js'));
  const esmStages = await import(pathToFileURL(path.join(sharedRoot, 'deploymentStages.js')).href);
  assert.deepEqual(stages.STAGE_ORDER, esmStages.STAGE_ORDER);
  for (const stage of ['release_validated', 'FINAL_INDEX_COMMIT', 'LOCAL_AUDIT', 'unknown']) {
    assert.equal(stages.canonicalStage(stage), esmStages.canonicalStage(stage));
    assert.equal(stages.stageLabel(stage), esmStages.stageLabel(stage));
  }

  const manifest = require(path.join(mirroredSharedRoot, 'universalManifest.js'));
  const esmManifest = await import(pathToFileURL(path.join(sharedRoot, 'universalManifest.js')).href);
  const sampleHtml = '<script src="./assets/main.js"></script><img src="logo.svg">';
  assert.deepEqual(manifest.parseIndexReferencesFromHtml(sampleHtml), esmManifest.parseIndexReferencesFromHtml(sampleHtml));

  const bootstrap = require(path.join(mirroredSharedRoot, 'runtimeBootstrap.js'));
  const esmBootstrap = await import(pathToFileURL(path.join(sharedRoot, 'runtimeBootstrap.js')).href);
  const runtimeConfig = { host: 'portal.army.idf', siteCode: 'schedule', targetDistPath: '/sites/schedule/siteDB/dist' };
  assert.equal(bootstrap.buildRuntimeBootstrapSource(runtimeConfig), esmBootstrap.buildRuntimeBootstrapSource(runtimeConfig));
  assert.deepEqual(bootstrap.injectRuntimeBootstrapIntoIndexHtml('<head></head><script type="module" src="main.js"></script>'), esmBootstrap.injectRuntimeBootstrapIntoIndexHtml('<head></head><script type="module" src="main.js"></script>'));

  const errors = require(path.join(mirroredSharedRoot, 'sharepointErrors.js'));
  const esmErrors = await import(pathToFileURL(path.join(sharedRoot, 'sharepointErrors.js')).href);
  for (const error of [
    { httpStatus: 404, body: '' },
    { httpStatus: 403, body: '{"error":{"code":"-2147024891","message":{"value":"Access denied"}}}' },
    { httpStatus: 400, body: '{"error":{"code":"-2147024894, System.IO.FileNotFoundException"}}' },
  ]) {
    assert.deepEqual(errors.classifySharePointError(error), esmErrors.classifySharePointError(error));
  }

  const retry = require(path.join(mirroredSharedRoot, 'retry.js'));
  const esmRetry = await import(pathToFileURL(path.join(sharedRoot, 'retry.js')).href);
  assert.deepEqual(retry.backoffDelays({ initialDelayMs: 5, factor: 2, maxAttempts: 4 }), esmRetry.backoffDelays({ initialDelayMs: 5, factor: 2, maxAttempts: 4 }));
});
