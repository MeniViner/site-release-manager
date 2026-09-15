export const IMAGE_GALLERY_SCHEMA_VERSION = 1;

export const IMAGE_GALLERY_STYLES = Object.freeze([
    {
        value: 'magal-strips',
        label: 'רצועות בתנועה',
        description: 'שורות תמונות זוויתיות הנעות ברצף ובכיוונים מנוגדים.',
    },
    {
        value: 'classic-carousel',
        label: 'קרוסלה קלאסית',
        description: 'תמונה ראשית, כפתורי ניווט ונקודות מעבר.',
    },
    {
        value: 'center-carousel',
        label: 'קרוסלה ממוקדת',
        description: 'התמונה הפעילה במרכז ותמונות שכנות נשארות גלויות.',
    },
    {
        value: 'coverflow',
        label: 'כרטיסי עומק',
        description: 'כרטיסים מדורגים עם דגש ברור על התמונה הפעילה.',
    },
    {
        value: 'masonry',
        label: 'גריד פסיפס',
        description: 'פריסה גמישה; לחיצה פותחת תצוגה מוגדלת.',
    },
]);

export const IMAGE_GALLERY_STYLE_VALUES = Object.freeze(IMAGE_GALLERY_STYLES.map((style) => style.value));

export const MAGAL_STRIP_REPEAT_GROUP_COUNT = 4;
export const MAGAL_STRIP_MINIMUM_ITEMS_PER_GROUP = 12;

export const DEFAULT_MAGAL_STRIPS_SETTINGS = Object.freeze({
    rowCount: 2,
    cardSizePx: 180,
    gapPx: 12,
    rows: Object.freeze([
        Object.freeze({ id: 'row-1', direction: 'left', durationSeconds: 34, angleDegrees: 3 }),
        Object.freeze({ id: 'row-2', direction: 'right', durationSeconds: 40, angleDegrees: -3 }),
        Object.freeze({ id: 'row-3', direction: 'left', durationSeconds: 38, angleDegrees: 2 }),
        Object.freeze({ id: 'row-4', direction: 'right', durationSeconds: 44, angleDegrees: -2 }),
    ]),
});

const MAX_GALLERIES = 50;
const MAX_IMAGES_PER_GALLERY = 120;
const DEFAULT_IMAGE_WIDTH = 1600;
const DEFAULT_IMAGE_HEIGHT = 900;

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
}

function asTrimmedString(value, fallback = '') {
    const normalized = asString(value, fallback).trim();
    return normalized || fallback;
}

function clampInteger(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
}

function clampNumber(value, min, max, fallback) {
    if (value === '' || value === null || value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed * 10) / 10));
}

function boundedText(value, maxLength, fallback = '') {
    return asString(value, fallback).trim().slice(0, maxLength);
}

function normalizeId(value, fallback) {
    return boundedText(value, 180, fallback) || fallback;
}

function uniqueId(value, seen, fallback) {
    const candidate = normalizeId(value, fallback);
    if (!seen.has(candidate)) {
        seen.add(candidate);
        return candidate;
    }

    let suffix = 2;
    while (seen.has(`${candidate}-${suffix}`)) suffix += 1;
    const unique = `${candidate}-${suffix}`;
    seen.add(unique);
    return unique;
}

/**
 * A gallery record contains references only. Data URLs and blob URLs are intentionally
 * rejected because they are not durable media references and would put binary data in
 * the site configuration.
 */
export function isSafeGalleryMediaReference(value) {
    const ref = asTrimmedString(value);
    if (!ref || ref.length > 4096) return false;
    if (/^(?:data|blob|javascript|vbscript):/i.test(ref)) return false;
    return /^(?:https?:)?\/\//i.test(ref)
        || ref.startsWith('/')
        || ref.startsWith('gallery-media://');
}

export function createImageGalleryId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `gallery-${crypto.randomUUID()}`;
    }
    return `gallery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createImageGalleryImageId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `gallery-image-${crypto.randomUUID()}`;
    }
    return `gallery-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeMagalStripsSettings(settingsLike) {
    const source = isObject(settingsLike) ? settingsLike : {};
    const sourceRows = Array.isArray(source.rows) ? source.rows : [];
    const rows = DEFAULT_MAGAL_STRIPS_SETTINGS.rows.map((fallbackRow, index) => {
        const rowSource = isObject(sourceRows[index]) ? sourceRows[index] : {};
        return {
            id: fallbackRow.id,
            direction: rowSource.direction === 'right' ? 'right' : (
                rowSource.direction === 'left' ? 'left' : fallbackRow.direction
            ),
            durationSeconds: clampNumber(
                rowSource.durationSeconds ?? rowSource.speedSeconds,
                10,
                120,
                fallbackRow.durationSeconds,
            ),
            angleDegrees: clampNumber(
                rowSource.angleDegrees ?? rowSource.angle,
                -12,
                12,
                fallbackRow.angleDegrees,
            ),
        };
    });

    return {
        rowCount: clampInteger(source.rowCount, 1, 4, DEFAULT_MAGAL_STRIPS_SETTINGS.rowCount),
        cardSizePx: clampInteger(
            source.cardSizePx ?? source.globalSize,
            120,
            280,
            DEFAULT_MAGAL_STRIPS_SETTINGS.cardSizePx,
        ),
        gapPx: clampInteger(
            source.gapPx ?? source.globalGap,
            4,
            32,
            DEFAULT_MAGAL_STRIPS_SETTINGS.gapPx,
        ),
        rows,
    };
}

export function normalizeImageGalleryDisplay(displayLike, legacySourceLike) {
    const source = isObject(displayLike) ? displayLike : {};
    const legacySource = isObject(legacySourceLike) ? legacySourceLike : {};
    const showTitleSource = source.showTitle ?? legacySource.showTitle;
    const showDescriptionSource = source.showDescription ?? legacySource.showDescription;
    const titleAlignmentSource = source.titleAlignment ?? legacySource.titleAlignment;

    return {
        showTitle: typeof showTitleSource === 'boolean' ? showTitleSource : true,
        showDescription: typeof showDescriptionSource === 'boolean' ? showDescriptionSource : true,
        titleAlignment: titleAlignmentSource === 'right' ? 'right' : 'center',
        magalStrips: normalizeMagalStripsSettings(
            source.magalStrips ?? legacySource.magalStrips ?? legacySource.gallerySettings,
        ),
    };
}

export function buildMagalStripLoopItems(images, rowIndex = 0) {
    const source = Array.isArray(images) ? images : [];
    if (source.length === 0) return [];
    const normalizedOffset = ((rowIndex % source.length) + source.length) % source.length;
    const rowImages = [...source.slice(normalizedOffset), ...source.slice(0, normalizedOffset)];
    const itemCount = Math.max(MAGAL_STRIP_MINIMUM_ITEMS_PER_GROUP, rowImages.length);
    return Array.from({ length: itemCount }, (_, index) => ({
        image: rowImages[index % rowImages.length],
        sourceIndex: index % rowImages.length,
        loopIndex: index,
    }));
}

export function createEmptyImageGallery(order = 0) {
    return {
        id: createImageGalleryId(),
        title: '',
        description: '',
        active: true,
        style: 'classic-carousel',
        order: clampInteger(order, 0, MAX_GALLERIES, 0),
        images: [],
        display: normalizeImageGalleryDisplay(),
    };
}

export function normalizeImageGalleryImage(imageLike, index = 0, galleryId = 'gallery') {
    const source = isObject(imageLike) ? imageLike : {};
    const rawMediaRef = asTrimmedString(
        source.mediaRef || source.imageUrl || source.url || source.src || source.image,
    );
    const mediaRef = isSafeGalleryMediaReference(rawMediaRef) ? rawMediaRef : '';
    const media = isObject(source.media) ? source.media : {};

    return {
        id: normalizeId(source.id, `${galleryId}-image-${index + 1}`),
        mediaRef,
        alt: boundedText(source.alt, 500),
        caption: boundedText(source.caption, 1000),
        width: clampInteger(source.width ?? media.width, 1, 10000, DEFAULT_IMAGE_WIDTH),
        height: clampInteger(source.height ?? media.height, 1, 10000, DEFAULT_IMAGE_HEIGHT),
        media: {
            fileName: boundedText(media.fileName ?? source.fileName, 255),
            mimeType: boundedText(media.mimeType ?? source.mimeType, 160),
            sizeBytes: clampInteger(media.sizeBytes ?? source.sizeBytes, 0, 100 * 1024 * 1024, 0),
        },
    };
}

export function normalizeImageGalleryRecord(galleryLike, index = 0) {
    const source = isObject(galleryLike) ? galleryLike : {};
    const display = isObject(source.display) ? source.display : {};
    const id = normalizeId(source.id, `gallery-${index + 1}`);
    const seenImageIds = new Set();
    const images = (Array.isArray(source.images) ? source.images : [])
        .filter(isObject)
        .slice(0, MAX_IMAGES_PER_GALLERY)
        .map((image, imageIndex) => {
            const normalized = normalizeImageGalleryImage(image, imageIndex, id);
            return {
                ...normalized,
                id: uniqueId(normalized.id, seenImageIds, `${id}-image-${imageIndex + 1}`),
            };
        });

    return {
        id,
        title: boundedText(source.title, 180),
        description: boundedText(source.description, 2000),
        active: typeof source.active === 'boolean' ? source.active : true,
        style: IMAGE_GALLERY_STYLE_VALUES.includes(source.style)
            ? source.style
            : 'classic-carousel',
        order: clampInteger(source.order, 0, MAX_GALLERIES, index),
        images,
        display: normalizeImageGalleryDisplay(display, source),
    };
}

export function normalizeImageGalleryBranch(branchLike) {
    const source = Array.isArray(branchLike)
        ? { items: branchLike }
        : (isObject(branchLike) ? branchLike : {});
    const seenGalleryIds = new Set();
    const items = (Array.isArray(source.items) ? source.items : [])
        .filter(isObject)
        .slice(0, MAX_GALLERIES)
        .map((gallery, index) => {
            const normalized = normalizeImageGalleryRecord(gallery, index);
            return {
                ...normalized,
                id: uniqueId(normalized.id, seenGalleryIds, `gallery-${index + 1}`),
            };
        })
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
        .map((gallery, index) => ({ ...gallery, order: index }));

    return {
        schemaVersion: IMAGE_GALLERY_SCHEMA_VERSION,
        items,
    };
}

export function isPublishableGalleryImage(imageLike) {
    const image = normalizeImageGalleryImage(imageLike);
    return Boolean(image.mediaRef && image.alt);
}

export function getPublishableGalleryImages(galleryLike) {
    const gallery = normalizeImageGalleryRecord(galleryLike);
    return gallery.images.filter(isPublishableGalleryImage);
}

export function isPublishableImageGallery(galleryLike) {
    const gallery = normalizeImageGalleryRecord(galleryLike);
    return Boolean(gallery.active && gallery.title && getPublishableGalleryImages(gallery).length > 0);
}

export function getActiveImageGalleries(branchLike) {
    return normalizeImageGalleryBranch(branchLike).items
        .filter(isPublishableImageGallery)
        .map((gallery) => ({
            ...gallery,
            images: getPublishableGalleryImages(gallery),
        }));
}

export function getImageGalleryValidationIssues(galleryLike) {
    const gallery = normalizeImageGalleryRecord(galleryLike);
    const issues = [];

    if (!gallery.title) {
        issues.push({ field: 'title', severity: 'error', message: 'יש להזין כותרת לגלריה.' });
    }
    if (gallery.images.length === 0) {
        issues.push({ field: 'images', severity: 'error', message: 'יש להוסיף לפחות תמונה אחת לגלריה.' });
    }

    gallery.images.forEach((image, index) => {
        if (!image.mediaRef) {
            issues.push({ field: `images.${image.id}.mediaRef`, severity: 'error', message: `לתמונה ${index + 1} חסרה הפניה לקובץ תקין.` });
        }
        if (!image.alt) {
            issues.push({ field: `images.${image.id}.alt`, severity: 'error', message: `יש להזין טקסט חלופי לתמונה ${index + 1}.` });
        }
    });

    return issues;
}

export function reorderImageGalleryItems(itemsLike, sourceId, targetId) {
    const items = normalizeImageGalleryBranch({ items: itemsLike }).items;
    const sourceIndex = items.findIndex((item) => item.id === sourceId);
    const targetIndex = items.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return items;

    const next = [...items];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    return next.map((item, index) => ({ ...item, order: index }));
}

export function reorderGalleryImages(imagesLike, sourceId, targetId) {
    const images = (Array.isArray(imagesLike) ? imagesLike : []).map((image, index) => normalizeImageGalleryImage(image, index));
    const sourceIndex = images.findIndex((image) => image.id === sourceId);
    const targetIndex = images.findIndex((image) => image.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return images;

    const next = [...images];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    return next;
}
