import {
    normalizePersonalNumber,
    personalNumberToArmyMailto,
} from './personalNumber.js';

export const SMART_TEXT_TOKEN_TYPES = Object.freeze({
    text: 'text',
    link: 'link',
    break: 'break',
});

export const SMART_LINK_TYPES = Object.freeze({
    url: 'url',
    email: 'email',
    personalNumber: 'personalNumber',
    phone: 'phone',
});

export const SMART_TEXT_MARKS = Object.freeze({
    bold: 'bold',
    italic: 'italic',
    underline: 'underline',
});

const KNOWN_MARKS = new Set(Object.values(SMART_TEXT_MARKS));
const URL_RE = /^https?:\/\/[^\s<>"']+$/i;
const WWW_RE = /^www\.[^\s<>"']+$/i;
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/i;
const MAILTO_RE = /^mailto:([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/i;
const TEL_RE = /^tel:(\+?[\d\s().-]+)$/i;
const LINK_CANDIDATE_RE = /https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b[SC]\d{7,8}\b|\+?\d[\d\s().-]{7,}\d/gi;
const TRAILING_PUNCTUATION_RE = /[.,;:!?]+$/;
const BARE_DOMAIN_RE = /^(?![a-z][a-z0-9+.-]*:)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?::\d{2,5})?(?:[/?#][^\s<>"']*)?$/i;

export function cleanSmartText(value) {
    return String(value ?? '')
        .split('')
        .filter((char) => {
            const code = char.charCodeAt(0);
            return !(code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127);
        })
        .join('');
}

function normalizeMarks(marks = []) {
    return [...new Set((Array.isArray(marks) ? marks : []).filter((mark) => KNOWN_MARKS.has(mark)))];
}

function sameMarks(left = [], right = []) {
    if (left.length !== right.length) return false;
    return left.every((mark, index) => mark === right[index]);
}

function sameLinkIdentity(left, right) {
    return left.href === right.href
        && left.linkType === right.linkType
        && left.target === right.target
        && left.rel === right.rel
        && left.raw === right.raw
        && left.value === right.value;
}

function pushTextToken(tokens, text, marks = []) {
    const clean = cleanSmartText(text);
    if (!clean) return;
    const normalizedMarks = normalizeMarks(marks);
    const last = tokens[tokens.length - 1];

    if (last?.type === SMART_TEXT_TOKEN_TYPES.text && sameMarks(last.marks, normalizedMarks)) {
        last.text += clean;
        return;
    }

    tokens.push({
        type: SMART_TEXT_TOKEN_TYPES.text,
        text: clean,
        marks: normalizedMarks,
    });
}

function pushBreakToken(tokens) {
    const last = tokens[tokens.length - 1];
    if (last?.type === SMART_TEXT_TOKEN_TYPES.break) return;
    tokens.push({ type: SMART_TEXT_TOKEN_TYPES.break });
}

function pushLinkToken(tokens, token) {
    const text = cleanSmartText(token.text);
    if (!text || !token.href) return;
    const normalized = {
        type: SMART_TEXT_TOKEN_TYPES.link,
        linkType: token.linkType || SMART_LINK_TYPES.url,
        text,
        raw: cleanSmartText(token.raw || text),
        value: cleanSmartText(token.value || token.href),
        href: token.href,
        marks: normalizeMarks(token.marks),
        ...(token.target ? { target: token.target } : {}),
        ...(token.rel ? { rel: token.rel } : {}),
    };
    const last = tokens[tokens.length - 1];

    if (
        last?.type === SMART_TEXT_TOKEN_TYPES.link
        && sameMarks(last.marks, normalized.marks)
        && sameLinkIdentity(last, normalized)
    ) {
        last.text += normalized.text;
        return;
    }

    tokens.push(normalized);
}

function trimTrailingPunctuation(candidate) {
    const trimmed = String(candidate || '').replace(TRAILING_PUNCTUATION_RE, '');
    if (!trimmed.endsWith(')')) return trimmed;

    const opens = (trimmed.match(/\(/g) || []).length;
    const closes = (trimmed.match(/\)/g) || []).length;
    return closes > opens ? trimmed.slice(0, -1) : trimmed;
}

export function sanitizeSmartUrl(value) {
    const raw = trimTrailingPunctuation(cleanSmartText(value).trim());
    const withProtocol = WWW_RE.test(raw) ? `https://${raw}` : raw;

    try {
        const url = new URL(withProtocol);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
        return url.href;
    } catch {
        return '';
    }
}

function normalizePhoneHrefValue(value) {
    const raw = cleanSmartText(value).trim();
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    return `${raw.startsWith('+') ? '+' : ''}${digits}`;
}

export function isConservativePhoneNumber(value) {
    const raw = cleanSmartText(value).trim();
    if (!raw) return false;
    if (!/^\+?[\d\s().-]+$/.test(raw)) return false;

    const digits = raw.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15) return false;

    const hasFormatting = raw.startsWith('+') || /[\s().-]/.test(raw);
    const isIsraeliLocal = /^0(?:[23489]\d{7}|5\d{8}|7\d{8})$/.test(digits);
    const isIsraeliInternational = /^972(?:[23489]\d{7}|5\d{8}|7\d{8})$/.test(digits);

    return hasFormatting || isIsraeliLocal || isIsraeliInternational;
}

export function sanitizeSmartHref(value) {
    const raw = cleanSmartText(value).trim();
    if (!raw) return '';

    if (URL_RE.test(raw) || WWW_RE.test(raw)) return sanitizeSmartUrl(raw);

    const mailtoMatch = raw.match(MAILTO_RE);
    if (mailtoMatch) {
        const [localPart, domainPart] = mailtoMatch[1].split('@');
        const personalNumber = normalizePersonalNumber(localPart);
        const safeLocalPart = personalNumber || String(localPart || '').toLowerCase();
        return `mailto:${safeLocalPart}@${String(domainPart || '').toLowerCase()}`;
    }

    const telMatch = raw.match(TEL_RE);
    if (telMatch && isConservativePhoneNumber(telMatch[1])) {
        return `tel:${normalizePhoneHrefValue(telMatch[1])}`;
    }

    return '';
}

function getSmartLinkTypeFromHref(href) {
    const normalizedHref = cleanSmartText(href).trim();

    if (/^mailto:/i.test(normalizedHref)) {
        const email = normalizedHref.replace(/^mailto:/i, '');
        const localPart = email.split('@')[0];
        return normalizePersonalNumber(localPart) ? SMART_LINK_TYPES.personalNumber : SMART_LINK_TYPES.email;
    }

    if (/^tel:/i.test(normalizedHref)) return SMART_LINK_TYPES.phone;

    return SMART_LINK_TYPES.url;
}

export function normalizeSmartLinkInput(value) {
    const raw = trimTrailingPunctuation(cleanSmartText(value).trim());
    if (!raw) return null;

    const explicitHref = sanitizeSmartHref(raw);
    if (explicitHref) {
        const linkType = getSmartLinkTypeFromHref(explicitHref);
        return {
            linkType,
            raw,
            href: explicitHref,
            value: linkType === SMART_LINK_TYPES.url ? explicitHref : explicitHref.replace(/^(mailto:|tel:)/i, ''),
            ...(linkType === SMART_LINK_TYPES.url ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
        };
    }

    const inferred = classifySmartLink(raw);
    if (inferred) {
        return {
            linkType: inferred.type,
            raw: inferred.raw,
            href: inferred.href,
            value: inferred.value,
            ...(inferred.target ? { target: inferred.target } : {}),
            ...(inferred.rel ? { rel: inferred.rel } : {}),
        };
    }

    if (BARE_DOMAIN_RE.test(raw)) {
        const href = sanitizeSmartUrl(`https://${raw}`);
        if (href) {
            return {
                linkType: SMART_LINK_TYPES.url,
                raw,
                href,
                value: href,
                target: '_blank',
                rel: 'noopener noreferrer',
            };
        }
    }

    return null;
}

export function createSmartTextLinkToken({ text, href, marks = [] } = {}) {
    const label = cleanSmartText(text).replace(/\s+/g, ' ').trim();
    const link = normalizeSmartLinkInput(href);

    if (!label || !link) return null;

    return {
        type: SMART_TEXT_TOKEN_TYPES.link,
        linkType: link.linkType,
        text: label,
        raw: link.raw,
        value: link.value,
        href: link.href,
        marks: normalizeMarks(marks),
        ...(link.target ? { target: link.target } : {}),
        ...(link.rel ? { rel: link.rel } : {}),
    };
}

export function classifySmartLink(value) {
    const raw = trimTrailingPunctuation(cleanSmartText(value).trim());
    if (!raw) return null;

    const href = sanitizeSmartUrl(raw);
    if ((URL_RE.test(raw) || WWW_RE.test(raw)) && href) {
        return {
            type: SMART_LINK_TYPES.url,
            raw,
            href,
            value: href,
            text: raw,
            target: '_blank',
            rel: 'noopener noreferrer',
        };
    }

    if (EMAIL_RE.test(raw)) {
        const email = raw.toLowerCase();
        return {
            type: SMART_LINK_TYPES.email,
            raw,
            href: `mailto:${email}`,
            value: email,
            text: email,
        };
    }

    const personalNumber = normalizePersonalNumber(raw);
    if (personalNumber) {
        return {
            type: SMART_LINK_TYPES.personalNumber,
            raw,
            href: personalNumberToArmyMailto(personalNumber),
            value: personalNumber,
            text: personalNumber,
        };
    }

    if (isConservativePhoneNumber(raw)) {
        const normalized = normalizePhoneHrefValue(raw);
        return {
            type: SMART_LINK_TYPES.phone,
            raw,
            href: `tel:${normalized}`,
            value: normalized,
            text: raw,
        };
    }

    return null;
}

function getLabelFromMap(linkLabelMap, keys) {
    if (!linkLabelMap) return '';

    const readValue = (key) => {
        if (linkLabelMap instanceof Map) return linkLabelMap.get(key);
        if (typeof linkLabelMap === 'object') return linkLabelMap[key];
        return undefined;
    };

    for (const key of keys) {
        const value = readValue(key);
        if (typeof value === 'string' && value.trim()) return cleanSmartText(value.trim());
    }

    return '';
}

function getLinkText(link, linkLabelMap) {
    return getLabelFromMap(linkLabelMap, [
        link.raw,
        link.value,
        link.href,
        String(link.raw || '').toLowerCase(),
        String(link.value || '').toLowerCase(),
        String(link.href || '').toLowerCase(),
    ]) || link.text || link.raw;
}

export function findSmartLinkMatches(text) {
    const source = cleanSmartText(text);
    const matches = [];
    LINK_CANDIDATE_RE.lastIndex = 0;

    let match = LINK_CANDIDATE_RE.exec(source);
    while (match) {
        const matchedText = match[0];
        const raw = trimTrailingPunctuation(matchedText);
        const link = classifySmartLink(raw);

        if (link) {
            matches.push({
                start: match.index,
                end: match.index + raw.length,
                raw,
                href: link.href,
                value: link.value,
                text: link.text,
                linkType: link.type,
                target: link.target,
                rel: link.rel,
            });
        }

        match = LINK_CANDIDATE_RE.exec(source);
    }

    return matches;
}

function pushTextWithLinks(tokens, text, marks, linkLabelMap) {
    if (!text) return;
    const matches = findSmartLinkMatches(text);
    let cursor = 0;

    matches.forEach((match) => {
        if (match.start > cursor) {
            pushTextToken(tokens, text.slice(cursor, match.start), marks);
        }

        pushLinkToken(tokens, {
            linkType: match.linkType,
            text: getLabelFromMap(linkLabelMap, [
                match.raw,
                match.value,
                match.href,
                String(match.raw || '').toLowerCase(),
                String(match.value || '').toLowerCase(),
                String(match.href || '').toLowerCase(),
            ]) || match.text || match.raw,
            raw: match.raw,
            value: match.value,
            href: match.href,
            marks,
            target: match.target,
            rel: match.rel,
        });
        cursor = match.end;
    });

    if (cursor < text.length) {
        pushTextToken(tokens, text.slice(cursor), marks);
    }
}

function pushPlainTextInto(tokens, source, marks, linkLabelMap) {
    const lines = cleanSmartText(source).split(/\r\n|\r|\n/);
    lines.forEach((line, index) => {
        if (index > 0) pushBreakToken(tokens);
        pushTextWithLinks(tokens, line, marks, linkLabelMap);
    });
}

export function normalizeSmartTextTokens(value, linkLabelMap = {}) {
    const source = Array.isArray(value)
        ? value
        : (Array.isArray(value?.tokens) ? value.tokens : []);
    const tokens = [];

    source.forEach((token) => {
        if (!token || typeof token !== 'object') return;

        if (token.type === SMART_TEXT_TOKEN_TYPES.break) {
            pushBreakToken(tokens);
            return;
        }

        if (token.type === SMART_TEXT_TOKEN_TYPES.link) {
            const explicitHref = sanitizeSmartHref(token.href);
            const inferred = classifySmartLink(token.raw || token.value || token.text);
            const href = explicitHref || inferred?.href || '';
            if (!href) {
                pushTextToken(tokens, token.text || token.raw || token.value, token.marks);
                return;
            }

            const linkType = token.linkType || inferred?.type || SMART_LINK_TYPES.url;
            const normalizedLink = {
                type: SMART_TEXT_TOKEN_TYPES.link,
                linkType,
                text: cleanSmartText(token.text || getLinkText(inferred || { raw: token.raw, value: token.value, href }, linkLabelMap)),
                raw: cleanSmartText(token.raw || inferred?.raw || token.text),
                value: cleanSmartText(token.value || inferred?.value || href),
                href,
                marks: normalizeMarks(token.marks),
                ...(linkType === SMART_LINK_TYPES.url ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
            };

            pushLinkToken(tokens, normalizedLink);
            return;
        }

        pushPlainTextInto(tokens, token.text, token.marks, linkLabelMap);
    });

    return tokens;
}

export function autoLinkSmartTextTokens(value, linkLabelMap = {}) {
    const tokens = [];
    normalizeSmartTextTokens(value, linkLabelMap).forEach((token) => {
        if (token.type === SMART_TEXT_TOKEN_TYPES.text) {
            pushTextWithLinks(tokens, token.text, token.marks, linkLabelMap);
            return;
        }

        if (token.type === SMART_TEXT_TOKEN_TYPES.link) {
            pushLinkToken(tokens, token);
            return;
        }

        if (token.type === SMART_TEXT_TOKEN_TYPES.break) {
            pushBreakToken(tokens);
        }
    });
    return tokens;
}

function pushTokenTextSlice(tokens, token, text) {
    if (!text) return;

    if (token.type === SMART_TEXT_TOKEN_TYPES.link) {
        pushLinkToken(tokens, { ...token, text });
        return;
    }

    pushTextToken(tokens, text, token.marks);
}

function cloneWholeTokenInto(tokens, token) {
    if (token.type === SMART_TEXT_TOKEN_TYPES.break) {
        pushBreakToken(tokens);
        return;
    }

    pushTokenTextSlice(tokens, token, token.text);
}

export function insertSmartTextLinkToken(value, selectionOffsets, linkToken) {
    if (!linkToken || linkToken.type !== SMART_TEXT_TOKEN_TYPES.link) {
        return normalizeSmartTextTokens(value);
    }

    const sourceTokens = normalizeSmartTextTokens(value);
    const plainLength = smartTextTokensToPlainText(sourceTokens).length;
    const rawStart = Number.isFinite(selectionOffsets?.start) ? selectionOffsets.start : plainLength;
    const rawEnd = Number.isFinite(selectionOffsets?.end) ? selectionOffsets.end : rawStart;
    const start = Math.max(0, Math.min(rawStart, rawEnd, plainLength));
    const end = Math.max(start, Math.min(Math.max(rawStart, rawEnd), plainLength));
    const tokens = [];
    let cursor = 0;
    let inserted = false;

    const insertLink = () => {
        if (inserted) return;
        pushLinkToken(tokens, linkToken);
        inserted = true;
    };

    sourceTokens.forEach((token) => {
        const isBreak = token.type === SMART_TEXT_TOKEN_TYPES.break;
        const text = isBreak ? '\n' : (token.text || '');
        const length = isBreak ? 1 : text.length;
        const tokenStart = cursor;
        const tokenEnd = cursor + length;

        if (!inserted && start <= tokenStart) {
            insertLink();
        }

        if (tokenEnd <= start || tokenStart >= end) {
            cloneWholeTokenInto(tokens, token);
            cursor = tokenEnd;
            return;
        }

        if (!isBreak) {
            const beforeEnd = Math.max(0, Math.min(start - tokenStart, length));
            const afterStart = Math.max(0, Math.min(end - tokenStart, length));
            pushTokenTextSlice(tokens, token, text.slice(0, beforeEnd));
            insertLink();
            pushTokenTextSlice(tokens, token, text.slice(afterStart));
        } else {
            insertLink();
        }

        cursor = tokenEnd;
    });

    insertLink();
    return normalizeSmartTextTokens(tokens);
}

export function tokenizeSmartText(value, linkLabelMap = {}) {
    const tokens = [];
    pushPlainTextInto(tokens, value, [], linkLabelMap);
    return tokens;
}

export function getSmartTextDocument(value, fallbackText = '', linkLabelMap = {}) {
    if (Array.isArray(value) || Array.isArray(value?.tokens)) {
        return autoLinkSmartTextTokens(value, linkLabelMap);
    }
    return tokenizeSmartText(fallbackText, linkLabelMap);
}

export function smartTextTokensToPlainText(value) {
    return normalizeSmartTextTokens(value)
        .map((token) => {
            if (token.type === SMART_TEXT_TOKEN_TYPES.break) return '\n';
            return token.text || '';
        })
        .join('');
}

export function updateSmartTextLinkLabel(value, prompt, label) {
    const normalizedLabel = cleanSmartText(label).trim();
    if (!normalizedLabel) return normalizeSmartTextTokens(value);

    const keys = new Set([prompt?.raw, prompt?.href, prompt?.value]
        .map((item) => cleanSmartText(item).trim())
        .filter(Boolean));

    return normalizeSmartTextTokens(value).map((token) => {
        if (token.type !== SMART_TEXT_TOKEN_TYPES.link) return token;
        const tokenKeys = [token.raw, token.href, token.value]
            .map((item) => cleanSmartText(item).trim())
            .filter(Boolean);
        if (!tokenKeys.some((key) => keys.has(key))) return token;
        return { ...token, text: normalizedLabel };
    });
}

export function smartTextToRenderData(value, linkLabelMap = {}) {
    return {
        tokens: Array.isArray(value) || Array.isArray(value?.tokens)
            ? autoLinkSmartTextTokens(value, linkLabelMap)
            : tokenizeSmartText(value, linkLabelMap),
    };
}
