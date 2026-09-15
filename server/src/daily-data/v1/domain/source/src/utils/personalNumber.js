export const ARMY_EMAIL_DOMAIN = 'army.idf.il';
export const PERSONAL_NUMBER_RE = /^[sc]\d{7,8}$/i;

export function normalizePersonalNumber(value) {
    const normalized = String(value ?? '').trim().toUpperCase();
    return PERSONAL_NUMBER_RE.test(normalized) ? normalized : '';
}

export function isValidPersonalNumber(value) {
    return Boolean(normalizePersonalNumber(value));
}

export function personalNumberToArmyEmail(value, domain = ARMY_EMAIL_DOMAIN) {
    const personalNumber = normalizePersonalNumber(value);
    if (!personalNumber) return '';
    const safeDomain = String(domain || ARMY_EMAIL_DOMAIN).trim().toLowerCase() || ARMY_EMAIL_DOMAIN;
    return `${personalNumber}@${safeDomain}`;
}

export function personalNumberToArmyMailto(value, domain = ARMY_EMAIL_DOMAIN) {
    const email = personalNumberToArmyEmail(value, domain);
    return email ? `mailto:${email}` : '';
}
