/**
 * One normalized SharePoint error classifier.
 *
 * The closed SharePoint farm this project targets is eventually consistent and
 * does NOT report "not there yet" with a single status code. The same logical
 * condition arrives as HTTP 404, HTTP 400 with a FileNotFound/DirectoryNotFound
 * payload, or a bare Microsoft.SharePoint.SPException. Classifying on HTTP
 * status alone is what made provisioning fail on the first attempt and only
 * succeed after a manual browser refresh.
 *
 * Everything here is pure and dependency-free so the Node API, the browser
 * worker and the tests all share exactly one interpretation.
 */

export const SP_ERROR = Object.freeze({
  MISSING: 'MISSING',
  TRANSIENT_NOT_READY: 'TRANSIENT_NOT_READY',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  AUTH_FAILURE: 'AUTH_FAILURE',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  PATH_COLLISION: 'PATH_COLLISION',
  INVALID_PATH: 'INVALID_PATH',
  NON_DOCUMENT_LIBRARY: 'NON_DOCUMENT_LIBRARY',
  PERMANENT_FAILURE: 'PERMANENT_FAILURE',
  UNKNOWN: 'UNKNOWN',
});

/**
 * Classes that a bounded retry may sit through. MISSING is deliberately absent:
 * "not found" is only retryable when the caller just created the object and is
 * waiting for it to become readable. That decision belongs to the stabilization
 * helper, not to the classifier.
 */
export const RETRYABLE_CLASSES = Object.freeze([SP_ERROR.TRANSIENT_NOT_READY]);

/**
 * Classes that mean "the thing you asked for is not readable yet or not there".
 * A stabilization barrier keeps polling through these.
 */
export const NOT_READY_CLASSES = Object.freeze([SP_ERROR.MISSING, SP_ERROR.TRANSIENT_NOT_READY]);

const EXCEPTION_TYPES = Object.freeze({
  FILE_NOT_FOUND: 'System.IO.FileNotFoundException',
  DIRECTORY_NOT_FOUND: 'System.IO.DirectoryNotFoundException',
  ARGUMENT: 'System.ArgumentException',
  UNAUTHORIZED_ACCESS: 'System.UnauthorizedAccessException',
  SP_EXCEPTION: 'Microsoft.SharePoint.SPException',
  SP_QUERY_THROTTLED: 'Microsoft.SharePoint.SPQueryThrottledException',
});

/** SharePoint numeric HRESULT-style codes seen on this farm. */
export const SP_CODES = Object.freeze({
  FILE_NOT_FOUND: '-2147024894',
  DIRECTORY_NOT_FOUND: '-2147024893',
  LIST_ALREADY_EXISTS: '-2130575342',
  FILE_ALREADY_EXISTS: '-2130575257',
  ITEM_NOT_FOUND: '-2130575338',
  ACCESS_DENIED: '-2147024891',
  INVALID_URL: '-2130575245',
});

const truncate = (value, max = 900) => String(value ?? '').slice(0, max);

/**
 * SharePoint returns verbose JSON, minimal JSON or XML depending on the endpoint
 * and the Accept header that survived. Parse all three shapes.
 */
export function parseSharePointErrorPayload(body) {
  const result = { code: '', numericCode: '', exceptionType: '', message: '' };
  if (body == null) return result;

  if (typeof body === 'object') return fromErrorObject(body, result);

  const text = String(body);
  if (!text.trim()) return result;

  try {
    return fromErrorObject(JSON.parse(text), result);
  } catch {
    // Not JSON — fall through to XML/plain-text scanning.
  }

  const xmlCode = text.match(/<m:code>([\s\S]*?)<\/m:code>/i) || text.match(/<code>([\s\S]*?)<\/code>/i);
  const xmlMessage = text.match(/<m:message[^>]*>([\s\S]*?)<\/m:message>/i) || text.match(/<message[^>]*>([\s\S]*?)<\/message>/i);
  if (xmlCode) result.code = truncate(xmlCode[1].trim(), 200);
  if (xmlMessage) result.message = truncate(xmlMessage[1].trim());
  if (!result.code && !result.message) result.message = truncate(text);
  return splitCode(result);
}

function fromErrorObject(parsed, result) {
  const error = parsed?.error || parsed?.['odata.error'] || parsed;
  const rawCode = error?.code ?? parsed?.code ?? '';
  const rawMessage = error?.message?.value ?? error?.message ?? parsed?.message?.value ?? parsed?.message ?? '';
  result.code = truncate(typeof rawCode === 'string' ? rawCode : JSON.stringify(rawCode), 200);
  result.message = truncate(typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage));
  return splitCode(result);
}

/** SharePoint packs "<numeric>, <ExceptionType>" into a single `code` string. */
function splitCode(result) {
  const match = String(result.code || '').match(/^\s*(-?\d+)\s*,\s*(.+?)\s*$/);
  if (match) {
    result.numericCode = match[1];
    result.exceptionType = match[2];
  } else if (/^-?\d+$/.test(String(result.code || '').trim())) {
    result.numericCode = String(result.code).trim();
  } else if (result.code) {
    result.exceptionType = result.code;
  }
  return result;
}

const has = (haystack, needle) => String(haystack || '').toLowerCase().includes(String(needle).toLowerCase());

function looksLikeNotFound({ numericCode, exceptionType, message }, rawText) {
  if (numericCode === SP_CODES.FILE_NOT_FOUND || numericCode === SP_CODES.DIRECTORY_NOT_FOUND) return true;
  if (has(exceptionType, EXCEPTION_TYPES.FILE_NOT_FOUND)) return true;
  if (has(exceptionType, EXCEPTION_TYPES.DIRECTORY_NOT_FOUND)) return true;
  const blob = `${message} ${rawText}`;
  if (has(blob, EXCEPTION_TYPES.DIRECTORY_NOT_FOUND)) return true;
  if (has(blob, EXCEPTION_TYPES.FILE_NOT_FOUND)) return true;
  if (has(blob, 'file not found')) return true;
  if (has(blob, 'does not exist')) return true;
  if (has(blob, 'could not be found')) return true;
  if (has(blob, 'was not found')) return true;
  if (has(blob, 'cannot find the file')) return true;
  if (has(blob, 'value does not fall within the expected range')) return true;
  return false;
}

function looksLikeAlreadyExists({ numericCode, message }, rawText) {
  if (numericCode === SP_CODES.LIST_ALREADY_EXISTS || numericCode === SP_CODES.FILE_ALREADY_EXISTS) return true;
  const blob = `${message} ${rawText}`;
  return has(blob, 'already exists');
}

function looksLikeInvalidPath({ numericCode, exceptionType, message }, rawText) {
  if (numericCode === SP_CODES.INVALID_URL) return true;
  const blob = `${message} ${rawText}`;
  if (has(exceptionType, EXCEPTION_TYPES.ARGUMENT) && !looksLikeNotFound({ numericCode, exceptionType, message }, rawText)) return true;
  if (has(blob, 'the url') && has(blob, 'is invalid')) return true;
  if (has(blob, 'invalid file name')) return true;
  if (has(blob, 'invalid characters')) return true;
  return false;
}

/**
 * Normalize any SharePoint failure into one structured, loggable record.
 *
 * @param {object} input
 * @param {number|null} input.httpStatus
 * @param {string|object|null} input.body   raw response body (text or parsed)
 * @param {string} input.operation          logical operation, e.g. "create-library"
 * @param {string} input.target             logical target, e.g. "/sites/x/siteDB"
 * @param {string} input.url
 * @param {string} input.method
 * @param {Error|null} input.cause          network/abort error when there is no response
 */
export function classifySharePointError(input = {}) {
  const rawStatus = input.httpStatus;
  const httpStatus = (rawStatus === null || rawStatus === undefined || rawStatus === '' || !Number.isFinite(Number(rawStatus)))
    ? null
    : Number(rawStatus);
  const rawText = typeof input.body === 'string' ? input.body : (input.body ? safeJson(input.body) : '');
  const parsed = parseSharePointErrorPayload(input.body);
  const causeMessage = input.cause?.message || '';

  const record = {
    errorClass: SP_ERROR.UNKNOWN,
    httpStatus,
    sharePointCode: parsed.numericCode || '',
    sharePointExceptionType: parsed.exceptionType || '',
    message: parsed.message || causeMessage || (httpStatus ? `HTTP ${httpStatus}` : 'SharePoint request failed'),
    url: truncate(input.url || '', 2000),
    method: String(input.method || '').toUpperCase(),
    operation: truncate(input.operation || '', 200),
    target: truncate(input.target || '', 500),
    responsePreview: truncate(rawText, 900),
    retryable: false,
    nextAction: '',
  };

  // No HTTP response at all: network drop, DNS, CORS or abort. Treat as transient
  // unless the caller aborted deliberately.
  if (httpStatus == null) {
    const aborted = input.cause?.name === 'AbortError' || has(causeMessage, 'abort');
    record.errorClass = aborted ? SP_ERROR.PERMANENT_FAILURE : SP_ERROR.TRANSIENT_NOT_READY;
    record.message = causeMessage || record.message;
    return finalize(record);
  }

  if (httpStatus === 401) { record.errorClass = SP_ERROR.AUTH_FAILURE; return finalize(record); }
  if (httpStatus === 403) {
    // SharePoint uses 403 both for genuine denial and for a stale/expired digest.
    const digestProblem = has(`${parsed.message} ${rawText}`, 'digest') || has(`${parsed.message} ${rawText}`, 'security validation');
    record.errorClass = digestProblem ? SP_ERROR.AUTH_FAILURE : SP_ERROR.PERMISSION_DENIED;
    return finalize(record);
  }
  if (parsed.numericCode === SP_CODES.ACCESS_DENIED || has(parsed.exceptionType, EXCEPTION_TYPES.UNAUTHORIZED_ACCESS)) {
    record.errorClass = SP_ERROR.PERMISSION_DENIED;
    return finalize(record);
  }

  if (looksLikeAlreadyExists(parsed, rawText)) { record.errorClass = SP_ERROR.ALREADY_EXISTS; return finalize(record); }

  // The critical case: this farm answers "not there yet" with 400 as often as 404.
  if (looksLikeNotFound(parsed, rawText)) { record.errorClass = SP_ERROR.MISSING; return finalize(record); }
  if (httpStatus === 404) { record.errorClass = SP_ERROR.MISSING; return finalize(record); }

  if (looksLikeInvalidPath(parsed, rawText)) { record.errorClass = SP_ERROR.INVALID_PATH; return finalize(record); }

  if (httpStatus === 409) { record.errorClass = SP_ERROR.ALREADY_EXISTS; return finalize(record); }
  if (httpStatus === 423) { record.errorClass = SP_ERROR.TRANSIENT_NOT_READY; return finalize(record); }
  if (httpStatus === 429) { record.errorClass = SP_ERROR.TRANSIENT_NOT_READY; return finalize(record); }
  if (httpStatus >= 500) { record.errorClass = SP_ERROR.TRANSIENT_NOT_READY; return finalize(record); }

  // A bare SPException with no recognizable payload is the farm's generic
  // "busy / inconsistent right now" answer. Retry it rather than hiding it.
  if (has(parsed.exceptionType, EXCEPTION_TYPES.SP_EXCEPTION) || has(parsed.exceptionType, EXCEPTION_TYPES.SP_QUERY_THROTTLED)) {
    record.errorClass = SP_ERROR.TRANSIENT_NOT_READY;
    return finalize(record);
  }

  if (httpStatus === 400) { record.errorClass = SP_ERROR.TRANSIENT_NOT_READY; return finalize(record); }
  if (httpStatus >= 200 && httpStatus < 300) { record.errorClass = SP_ERROR.UNKNOWN; return finalize(record); }

  record.errorClass = SP_ERROR.PERMANENT_FAILURE;
  return finalize(record);
}

const NEXT_ACTIONS = Object.freeze({
  MISSING: 'האובייקט לא נמצא ב-SharePoint. אם הוא זה עתה נוצר, המערכת תמתין ותבדוק שוב.',
  TRANSIENT_NOT_READY: 'SharePoint עדיין לא עקבי. המערכת תנסה שוב עם המתנה מתגברת.',
  ALREADY_EXISTS: 'האובייקט כבר קיים. המערכת תאמת את המצב הקיים במקום ליצור שוב.',
  AUTH_FAILURE: 'נדרש חיבור מחדש ל-SharePoint. פתח את Release Manager מתוך ה-Host הנכון ובדוק שאתה מחובר.',
  PERMISSION_DENIED: 'למשתמש אין הרשאות לבצע את הפעולה באתר היעד.',
  PATH_COLLISION: 'קיים אובייקט אחר באותו נתיב. יש לפנות אותו ידנית או לבחור שם אחר.',
  INVALID_PATH: 'הנתיב או השם אינם חוקיים ב-SharePoint. תקן את הגדרות האתר.',
  NON_DOCUMENT_LIBRARY: 'קיימת רשימה בשם הזה שאינה ספריית מסמכים. יש לבחור שם אחר.',
  PERMANENT_FAILURE: 'שגיאה קבועה. עיין בפרטי הבקשה והתשובה.',
  UNKNOWN: 'שגיאה לא מסווגת. הפרטים הגולמיים נשמרו לאבחון.',
});

function finalize(record) {
  record.retryable = RETRYABLE_CLASSES.includes(record.errorClass);
  record.nextAction = NEXT_ACTIONS[record.errorClass] || NEXT_ACTIONS.UNKNOWN;
  return record;
}

function safeJson(value) {
  try { return JSON.stringify(value); } catch { return String(value); }
}

/** True when the condition may resolve on its own while a barrier keeps polling. */
export function isNotReady(errorClass) {
  return NOT_READY_CLASSES.includes(errorClass);
}

export function isRetryable(errorClass) {
  return RETRYABLE_CLASSES.includes(errorClass);
}

/** Build an Error that carries the normalized record for telemetry. */
export function sharePointError(record, fallbackMessage = 'SharePoint request failed') {
  const error = new Error(`${record.operation || 'sharepoint'}: ${record.message || fallbackMessage}`);
  error.sharePoint = record;
  error.errorClass = record.errorClass;
  error.httpStatus = record.httpStatus;
  error.url = record.url;
  error.method = record.method;
  error.operation = record.operation;
  return error;
}
