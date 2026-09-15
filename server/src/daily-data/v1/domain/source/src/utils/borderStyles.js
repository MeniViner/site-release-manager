export const DEFAULT_BORDER_TARGETS = {
    commander: true,
    widget: true,
    search: true,
    topNav: false,
    sideNav: false,
    flipCards: true,
    extLinks: false,
    hqDash: false,
};

const LEGACY_BORDER_STYLE_MAP = {
    'tactical-1': 'cyber',
    'tactical-2': 'shield',
    'tactical-3': 'armor',
};

export function normalizeBorderStyle(style) {
    if (!style) return 'cyber';
    return LEGACY_BORDER_STYLE_MAP[style] || style;
}

export function isTacticalStyle(style) {
    const normalizedStyle = normalizeBorderStyle(style);
    return normalizedStyle !== 'standard' && normalizedStyle !== 'square';
}

export function normalizeBorderTargets(targets) {
    return {
        ...DEFAULT_BORDER_TARGETS,
        ...(targets && typeof targets === 'object' ? targets : {}),
    };
}

export function tacticalClip(style, size) {
    const normalizedStyle = normalizeBorderStyle(style);
    const s = size;

    switch (normalizedStyle) {
        case 'square':
            return null;
        case 'cyber':
            return `polygon(${s}px 0, 100% 0, 100% calc(100% - ${s}px), calc(100% - ${s}px) 100%, 0 100%, 0 ${s}px)`;
        case 'armor':
            return `polygon(${s}px 0, calc(100% - ${s}px) 0, 100% ${s}px, 100% calc(100% - ${s}px), calc(100% - ${s}px) 100%, ${s}px 100%, 0 calc(100% - ${s}px), 0 ${s}px)`;
        case 'shield':
            return `polygon(${s}px 0, calc(100% - ${s}px) 0, 100% ${s}px, 100% 100%, 0 100%, 0 ${s}px)`;
        case 'blade':
            return `polygon(0 0, 100% 0, 100% 100%, ${s * 1.5}px 100%, 0 calc(100% - ${s * 1.5}px))`;
        case 'standard':
        default:
            return null;
    }
}

export function panelStyle(borderStyle, size) {
    const normalizedStyle = normalizeBorderStyle(borderStyle);
    const clip = tacticalClip(normalizedStyle, size);
    if (normalizedStyle === 'square') {
        return { borderRadius: '0px' };
    }
    return clip ? { clipPath: clip } : { borderRadius: `${Math.min(size, 16)}px` };
}
