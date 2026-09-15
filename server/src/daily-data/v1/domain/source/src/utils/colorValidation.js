export const HEX_COLOR_RE = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
export const LEGACY_EVENT_COLORS = Object.freeze({
    red: '#ef4444',
    gray: '#6b7280',
});

export function isValidHexColor(value) {
    return typeof value === 'string' && HEX_COLOR_RE.test(value.trim());
}

export function normalizeHexColor(value, fallback = '') {
    if (!isValidHexColor(value)) return fallback;

    const hex = value.trim().slice(1);
    const expanded = hex.length === 3
        ? hex.split('').map((char) => `${char}${char}`).join('')
        : hex;
    return `#${expanded.toUpperCase()}`;
}

export function isLegacyEventColor(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(LEGACY_EVENT_COLORS, normalized);
}

export function normalizeEventColor(value, fallback = 'gray') {
    const hex = normalizeHexColor(value);
    if (hex) return hex;

    const normalized = String(value ?? '').trim().toLowerCase();
    if (isLegacyEventColor(normalized)) return normalized;

    const fallbackHex = normalizeHexColor(fallback);
    if (fallbackHex) return fallbackHex;

    const normalizedFallback = String(fallback ?? '').trim().toLowerCase();
    return isLegacyEventColor(normalizedFallback) ? normalizedFallback : 'gray';
}

export function eventColorToHex(value, fallback = LEGACY_EVENT_COLORS.gray) {
    const hex = normalizeHexColor(value);
    if (hex) return hex;

    const normalized = String(value ?? '').trim().toLowerCase();
    if (isLegacyEventColor(normalized)) return LEGACY_EVENT_COLORS[normalized];

    return normalizeHexColor(fallback, LEGACY_EVENT_COLORS.gray);
}

export function getContrastingTextColor(value) {
    const hex = eventColorToHex(value).slice(1);
    const red = parseInt(hex.slice(0, 2), 16) / 255;
    const green = parseInt(hex.slice(2, 4), 16) / 255;
    const blue = parseInt(hex.slice(4, 6), 16) / 255;
    const linearize = (channel) => (
        channel <= 0.03928
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4
    );
    const luminance = (0.2126 * linearize(red)) + (0.7152 * linearize(green)) + (0.0722 * linearize(blue));
    return luminance > 0.45 ? '#111827' : '#FFFFFF';
}
