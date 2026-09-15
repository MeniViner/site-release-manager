export const COMMANDER_IMAGE_SCALE = {
    min: 25,
    max: 300,
    defaultValue: 100,
};

export const COMMANDER_IMAGE_OFFSET_X = {
    min: -160,
    max: 160,
    defaultValue: 0,
};

export const COMMANDER_IMAGE_OFFSET_Y = {
    min: -160,
    max: 160,
    defaultValue: 0,
};

export const DEFAULT_COMMANDER_IMAGE_PATH = '/images/אייל זמיר.png';

export const COMMANDER_IMAGE_SOURCE = Object.freeze({
    custom: 'custom',
    default: 'default',
    none: 'none',
    builtin: 'builtin',
});

export const COMMANDER_BUILTIN_AVATARS = Object.freeze([
    { id: 'slate', label: 'דמות בגוון כחול', path: '/images/commander-avatars/commander-slate.svg' },
    { id: 'navy', label: 'דמות בגוון כהה', path: '/images/commander-avatars/commander-navy.svg' },
    { id: 'teal', label: 'דמות בגוון טורקיז', path: '/images/commander-avatars/commander-teal.svg' },
    { id: 'sand', label: 'דמות בגוון חול', path: '/images/commander-avatars/commander-sand.svg' },
]);

const BUILTIN_BY_ID = new Map(COMMANDER_BUILTIN_AVATARS.map((avatar) => [avatar.id, avatar]));
const BUILTIN_BY_PATH = new Map(COMMANDER_BUILTIN_AVATARS.map((avatar) => [avatar.path, avatar]));

export function clampCommanderImageValue(value, range) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return range.defaultValue;
    return Math.min(range.max, Math.max(range.min, Math.round(parsed)));
}

export function getCommanderImageSettings(commander = {}) {
    return {
        imageScale: clampCommanderImageValue(commander?.imageScale, COMMANDER_IMAGE_SCALE),
        imageOffsetX: clampCommanderImageValue(commander?.imageOffsetX, COMMANDER_IMAGE_OFFSET_X),
        imageOffsetY: clampCommanderImageValue(commander?.imageOffsetY, COMMANDER_IMAGE_OFFSET_Y),
    };
}

export function getCommanderImageSourceSettings(commander = {}) {
    const existingImage = typeof commander?.image === 'string'
        ? commander.image
        : (typeof commander?.imageUrl === 'string' ? commander.imageUrl : '');
    const existingCustomImage = typeof commander?.customImageUrl === 'string'
        ? commander.customImageUrl
        : '';
    const explicitSource = Object.values(COMMANDER_IMAGE_SOURCE).includes(commander?.imageSource)
        ? commander.imageSource
        : null;
    const matchedAvatar = BUILTIN_BY_ID.get(commander?.imageAvatar) || BUILTIN_BY_PATH.get(existingImage);
    const imageSource = explicitSource
        || (matchedAvatar
            ? COMMANDER_IMAGE_SOURCE.builtin
            : existingImage === DEFAULT_COMMANDER_IMAGE_PATH
                ? COMMANDER_IMAGE_SOURCE.default
                : existingImage
                    ? COMMANDER_IMAGE_SOURCE.custom
                    : COMMANDER_IMAGE_SOURCE.none);
    const imageAvatar = imageSource === COMMANDER_IMAGE_SOURCE.builtin
        ? (matchedAvatar?.id || COMMANDER_BUILTIN_AVATARS[0].id)
        : '';
    const customImageUrl = imageSource === COMMANDER_IMAGE_SOURCE.custom
        ? (existingCustomImage || existingImage)
        : existingCustomImage;
    const imageUrl = imageSource === COMMANDER_IMAGE_SOURCE.default
        ? DEFAULT_COMMANDER_IMAGE_PATH
        : imageSource === COMMANDER_IMAGE_SOURCE.builtin
            ? BUILTIN_BY_ID.get(imageAvatar).path
            : imageSource === COMMANDER_IMAGE_SOURCE.none
                ? ''
                : customImageUrl;

    return { imageSource, imageAvatar, customImageUrl, imageUrl };
}

export function normalizeCommanderImageSettings(commander = {}) {
    const source = getCommanderImageSourceSettings(commander);
    return {
        ...commander,
        ...getCommanderImageSettings(commander),
        imageSource: source.imageSource,
        imageAvatar: source.imageAvatar,
        customImageUrl: source.customImageUrl,
        image: source.imageUrl,
        imageUrl: source.imageUrl,
    };
}
