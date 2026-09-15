import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverSource = path.join(root, 'server', 'src');
const checks = [
  ['IIS CommonJS entry', 'index.cjs'],
  ['IIS config', 'web.config'],
  ['Environment', '.env'],
  ['Server dependencies', 'server/node_modules/express/package.json'],
  ['Client build', 'client/dist/index.html'],
  ['Client runtime API config', 'client/dist/release-manager-runtime-config.json'],
  ['Client runtime API config TXT fallback', 'client/dist/release-manager-runtime-config.txt'],
  ['SharePoint deployer build', 'sharepoint-deployer/client/dist/index.html'],
];
let failed = 0;
for (const [label, rel] of checks) {
  const ok = fs.existsSync(path.join(root, rel));
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${rel}`);
  if (!ok) failed += 1;
}

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
        if (source[index] === '\\') index += 2;
        else if (source[index] === quote) {
          index += 1;
          break;
        } else index += 1;
      }
      output += ' ';
    } else {
      output += character;
      index += 1;
    }
  }
  return output;
}

const serverPackage = JSON.parse(fs.readFileSync(path.join(root, 'server', 'package.json'), 'utf8'));
const entrySource = fs.readFileSync(path.join(root, 'index.cjs'), 'utf8');
const webConfig = fs.readFileSync(path.join(root, 'web.config'), 'utf8');
const runtimeFailures = [];
const dependencyFailures = [];
for (const file of javascriptFiles(serverSource)) {
  const source = fs.readFileSync(file, 'utf8');
  const executable = withoutCommentsAndLiterals(source);
  if (/\bimport\s*\(|\bimport\s+(?:[\w${*])/.test(executable) || /\bexport\s+(?:default|const|let|var|async|function|class|\{)/.test(executable)) {
    runtimeFailures.push(`${path.relative(root, file)} contains executable ESM syntax`);
  }
  for (const match of source.matchAll(/require\((['"])([^'"]+)\1\)/g)) {
    const specifier = match[2];
    if (specifier.startsWith('.')) {
      const target = path.resolve(path.dirname(file), specifier);
      if (!fs.existsSync(target)) dependencyFailures.push(`${path.relative(root, file)} -> ${specifier} is missing`);
    } else if (!specifier.startsWith('node:') && !builtinModules.includes(specifier) && !fs.existsSync(path.join(root, 'server', 'node_modules', specifier, 'package.json'))) {
      dependencyFailures.push(`${path.relative(root, file)} -> ${specifier} is not in server/node_modules`);
    }
  }
}

for (const [label, ok] of [
  ['Server package is CommonJS', serverPackage.type === 'commonjs'],
  ['IIS entry has native require()', /\brequire\(/.test(entrySource)],
  ['IIS entry has no dynamic import', !/\bimport\s*\(/.test(withoutCommentsAndLiterals(entrySource))],
  ['web.config handler targets index.cjs', /path="index\.cjs"/.test(webConfig)],
  ['web.config rewrite targets index.cjs', /url="index\.cjs"/.test(webConfig)],
  ['Production runtime has no executable ESM syntax', runtimeFailures.length === 0],
  ['Production runtime local dependencies stay inside server/src', dependencyFailures.length === 0],
]) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failed += 1;
}
for (const problem of [...runtimeFailures, ...dependencyFailures]) console.error(`  - ${problem}`);

if (failed) process.exit(1);
console.log('IIS SOURCE READY FOR PACKAGING');
