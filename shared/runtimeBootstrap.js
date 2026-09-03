/**
 * Runtime bootstrap contract.
 *
 * WHY THIS EXISTS
 * ---------------
 * On the real closed SharePoint farm a file uploaded to a Document Library is
 * readable and byte-verifiable through
 * `/_api/web/GetFileByServerRelativeUrl(...)/$value`, but a DIRECT browser GET
 * of `.../dist/sitebuilder-runtime-config.json` answers HTTP 200 with an HTML
 * page instead of the JSON body. The application therefore cannot obtain its
 * per-target identity from a direct `.json` request, no matter how correct the
 * generated artifact is.
 *
 * Site Builder already supports an embedded runtime config: its
 * `loadEmbeddedRuntimeConfig()` reads `window.SITE_BUILDER_RUNTIME_CONFIG` (or
 * the legacy `window.__SITE_BUILDER_RUNTIME_CONFIG__`) BEFORE it ever attempts
 * a runtime JSON fetch. So Release Manager generates one extra per-target file,
 * a plain `.js` overlay carrying the exact same runtime config, and references
 * it from the staged `index.html` before the module bundle.
 *
 * The two JSON files remain authoritative deployment/audit artifacts and are
 * still fully verified — through SharePoint REST `$value`, which is proven to
 * work on this farm.
 *
 * Site Builder itself is NOT modified.
 */

import { RUNTIME_BOOTSTRAP_FILE } from './universalManifest.js';

/** The global Site Builder's loadEmbeddedRuntimeConfig() reads first. */
export const RUNTIME_BOOTSTRAP_GLOBAL = 'SITE_BUILDER_RUNTIME_CONFIG';
/** The legacy alias the same loader accepts. Both are populated. */
export const RUNTIME_BOOTSTRAP_LEGACY_GLOBAL = '__SITE_BUILDER_RUNTIME_CONFIG__';

/**
 * The substring a direct browser GET of the bootstrap must contain.
 * Verification looks for this rather than a MIME type, because this old farm
 * returns legacy JavaScript content types.
 */
export const RUNTIME_BOOTSTRAP_MARKER = `window.${RUNTIME_BOOTSTRAP_GLOBAL}`;

/** The exact tag injected into the staged index.html. */
export const RUNTIME_BOOTSTRAP_SCRIPT_TAG = `<script src="./${RUNTIME_BOOTSTRAP_FILE}"></script>`;

const ESCAPES = Object.freeze({
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
});

/**
 * JSON structural characters never include any of these, so a global replace
 * only ever touches the inside of a string literal. This keeps the emitted
 * JavaScript safe in any embedding context and free of raw line separators.
 */
const escapeJsLiteral = (json) => json.replace(/[<>&\u2028\u2029]/g, (character) => ESCAPES[character]);

const FREEZE_OPEN = `window.${RUNTIME_BOOTSTRAP_GLOBAL} = Object.freeze(`;
const FREEZE_CLOSE = ');';

/**
 * Build the deterministic JavaScript source for one target.
 *
 * Deterministic means: the same runtime config object always produces the same
 * bytes, so the size and SHA-256 recorded in the deployment manifest are exact.
 *
 * @param {object} runtimeConfig the EXACT generated runtime config object
 * @returns {string} valid JavaScript, ending in a newline
 */
export function buildRuntimeBootstrapSource(runtimeConfig) {
  if (!runtimeConfig || typeof runtimeConfig !== 'object' || Array.isArray(runtimeConfig)) {
    throw new TypeError('buildRuntimeBootstrapSource requires the generated runtime config object.');
  }
  const literal = escapeJsLiteral(JSON.stringify(runtimeConfig, null, 2));
  return [
    `/* ${RUNTIME_BOOTSTRAP_FILE}`,
    ' * Generated per deployment target by site-release-manager. Do not edit.',
    ' *',
    ' * This farm does not serve .json reliably through a direct Document Library',
    ' * URL, so the runtime identity is delivered as JavaScript instead. The',
    ' * authoritative copies remain sitebuilder-runtime-config.json and',
    ' * sitebuilder-deployment.json, verified through SharePoint REST.',
    ' */',
    `${FREEZE_OPEN}${literal}${FREEZE_CLOSE}`,
    `window.${RUNTIME_BOOTSTRAP_LEGACY_GLOBAL} = window.${RUNTIME_BOOTSTRAP_GLOBAL};`,
    '',
  ].join('\n');
}

/**
 * Read the runtime config back out of a generated bootstrap file.
 * Used by verification and by tests to prove the file carries this target's
 * identity and no other.
 *
 * @returns {object|null} the parsed config, or null when the source is not a
 *   bootstrap produced by buildRuntimeBootstrapSource
 */
export function parseRuntimeBootstrapConfig(source) {
  const text = String(source || '');
  const start = text.indexOf(FREEZE_OPEN);
  if (start < 0) return null;
  const open = start + FREEZE_OPEN.length;
  const end = text.lastIndexOf(`${FREEZE_CLOSE}`);
  if (end <= open) return null;
  try {
    const payload = JSON.parse(text.slice(open, end));
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const BOOTSTRAP_REFERENCE_PATTERN = new RegExp(
  `<script\\b[^>]*\\bsrc\\s*=\\s*(?:"[^"]*${escapeRegExp(RUNTIME_BOOTSTRAP_FILE)}"|'[^']*${escapeRegExp(RUNTIME_BOOTSTRAP_FILE)}')`,
  'i',
);

const HTML_COMMENT_PATTERN = /<!--[\s\S]*?(?:-->|$)/g;
const SCRIPT_OPEN_TAG_PATTERN = /<script\b[^>]*>/gi;
const MODULE_TYPE_PATTERN = /\btype\s*=\s*(?:"[^"]*\bmodule\b[^"]*"|'[^']*\bmodule\b[^']*'|module\b)/i;

/**
 * Blank out every HTML comment while preserving the length of the document, so
 * indexes computed on the masked text are valid indexes into the original.
 *
 * A commented-out `<script>` is inert in the browser. Scanning the raw text
 * would let the bootstrap be injected inside a comment, where every downstream
 * check would still report it as present while the browser never runs it. An
 * unterminated `<!--` swallows the rest of the document, exactly as a browser
 * treats it.
 */
function maskHtmlComments(html) {
  return String(html || '').replace(HTML_COMMENT_PATTERN, (match) => ' '.repeat(match.length));
}

/** Does this index.html actually load the runtime bootstrap (comments aside)? */
export function hasRuntimeBootstrapReference(html) {
  return BOOTSTRAP_REFERENCE_PATTERN.test(maskHtmlComments(html));
}

/** How many live bootstrap script tags does this index.html carry? */
export function countRuntimeBootstrapReferences(html) {
  const pattern = new RegExp(BOOTSTRAP_REFERENCE_PATTERN.source, 'gi');
  return (maskHtmlComments(html).match(pattern) || []).length;
}

/**
 * Index of the first Vite/module script tag, or -1.
 * Matching is on `type="module"`, never on a hashed bundle filename.
 */
export function findFirstModuleScriptIndex(html) {
  const text = maskHtmlComments(html);
  const pattern = new RegExp(SCRIPT_OPEN_TAG_PATTERN.source, 'gi');
  let match = pattern.exec(text);
  while (match) {
    if (MODULE_TYPE_PATTERN.test(match[0])) return match.index;
    match = pattern.exec(text);
  }
  return -1;
}

/**
 * Index of the first script tag of ANY kind that is not the bootstrap itself,
 * or -1. Classic scripts execute in document order too, so the bootstrap has to
 * win against them and not only against `type="module"`.
 */
export function findFirstForeignScriptIndex(html) {
  const text = maskHtmlComments(html);
  const pattern = new RegExp(SCRIPT_OPEN_TAG_PATTERN.source, 'gi');
  let match = pattern.exec(text);
  while (match) {
    if (!BOOTSTRAP_REFERENCE_PATTERN.test(match[0])) return match.index;
    match = pattern.exec(text);
  }
  return -1;
}

/** Index of the bootstrap script tag, or -1. */
export function findRuntimeBootstrapIndex(html) {
  const match = BOOTSTRAP_REFERENCE_PATTERN.exec(maskHtmlComments(html));
  return match ? match.index : -1;
}

function chooseInsertionPoint(html) {
  const text = maskHtmlComments(html);

  // Anchor on the first live script of any kind: whichever script runs first is
  // the one that could read the global before it exists.
  const firstScript = findFirstForeignScriptIndex(text);
  if (firstScript >= 0) {
    const moduleIndex = findFirstModuleScriptIndex(text);
    return { index: firstScript, anchor: firstScript === moduleIndex ? 'module-script' : 'first-script' };
  }

  const headClose = text.search(/<\/head\s*>/i);
  if (headClose >= 0) return { index: headClose, anchor: 'head-close' };

  const bodyClose = text.search(/<\/body\s*>/i);
  if (bodyClose >= 0) return { index: bodyClose, anchor: 'body-close' };

  return { index: -1, anchor: 'end-of-document' };
}

function describe(html, injected, anchor) {
  return {
    html,
    injected,
    anchor,
    bootstrapIndex: findRuntimeBootstrapIndex(html),
    moduleIndex: findFirstModuleScriptIndex(html),
    firstScriptIndex: findFirstForeignScriptIndex(html),
  };
}

/**
 * Inject `<script src="./sitebuilder-runtime-bootstrap.js"></script>` before the
 * first script the document already runs.
 *
 * The transformation is idempotent: an index.html that already references the
 * bootstrap is returned unchanged, so no duplicate tag can ever appear. HTML
 * comments are ignored, so the tag is never hidden inside one.
 *
 * @returns {{html:string, injected:boolean, anchor:string, bootstrapIndex:number, moduleIndex:number, firstScriptIndex:number}}
 */
export function injectRuntimeBootstrapIntoIndexHtml(html) {
  const text = String(html ?? '');
  if (hasRuntimeBootstrapReference(text)) return describe(text, false, 'already-present');

  const { index, anchor } = chooseInsertionPoint(text);
  if (index < 0) {
    return describe(`${text}${text.endsWith('\n') ? '' : '\n'}${RUNTIME_BOOTSTRAP_SCRIPT_TAG}\n`, true, anchor);
  }

  // Reuse the anchor line's indentation when the tag starts its own line, so a
  // pretty-printed index.html stays readable and a minified one stays minified.
  const lineStart = text.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  const lead = text.slice(lineStart, index);
  const insertion = /^[ \t]*$/.test(lead)
    ? `${RUNTIME_BOOTSTRAP_SCRIPT_TAG}\n${lead}`
    : RUNTIME_BOOTSTRAP_SCRIPT_TAG;

  return describe(`${text.slice(0, index)}${insertion}${text.slice(index)}`, true, anchor);
}
