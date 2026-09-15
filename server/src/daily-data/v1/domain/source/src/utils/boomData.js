import { computeGanttProgress } from './ganttData.js';

export const BOOM_STATUS_OPTIONS = Object.freeze([
    { value: 'planned', label: 'מתוכנן' },
    { value: 'active', label: 'בביצוע' },
    { value: 'blocked', label: 'חסום' },
    { value: 'onHold', label: 'בהמתנה' },
    { value: 'completed', label: 'הושלם' },
]);

export const BOOM_SUMMARY_METRICS = Object.freeze([
    { id: 'total', label: 'משימות', icon: 'tasks' },
    { id: 'active', label: 'בביצוע', icon: 'activity' },
    { id: 'blocked', label: 'חסומות', icon: 'blocked' },
    { id: 'completed', label: 'הושלמו', icon: 'completed' },
    { id: 'overdue', label: 'באיחור', icon: 'overdue' },
    { id: 'upcoming', label: 'קרובות', icon: 'upcoming' },
    { id: 'owners', label: 'אחראים', icon: 'owners' },
    { id: 'categories', label: 'תחומים', icon: 'categories' },
]);

const DEFAULT_SUMMARY_METRICS = ['total', 'active', 'owners', 'categories'];

export const BOOM_TABLE_DENSITIES = Object.freeze([
    { value: 'compact', label: 'קומפקטי' },
    { value: 'comfortable', label: 'מאוזן' },
]);

export const BOOM_ACCENT_OPTIONS = Object.freeze([
    { value: 'primary', label: 'צבע האתר' },
    { value: 'sky', label: 'כחול פיקודי' },
    { value: 'emerald', label: 'ירוק תפעולי' },
]);

const VALID_SUMMARY_METRICS = new Set(BOOM_SUMMARY_METRICS.map((metric) => metric.id));
const VALID_TABLE_DENSITIES = new Set(BOOM_TABLE_DENSITIES.map((option) => option.value));
const VALID_ACCENTS = new Set(BOOM_ACCENT_OPTIONS.map((option) => option.value));

export const BOOM_COLOR_OPTIONS = Object.freeze([
    '#2563eb',
    '#0891b2',
    '#0f766e',
    '#7c3aed',
    '#d97706',
    '#dc2626',
    '#475569',
]);

export const DEFAULT_BOOM_DATA = Object.freeze({
    enabled: false,
    buttonLabel: 'בום',
    pageTitle: 'BOOM - תמונת מצב',
    description: 'מערכת שליטה ובקרה למשימות, אחריות והתקדמות.',
    design: {
        showSummaryStrip: true,
        summaryMetrics: DEFAULT_SUMMARY_METRICS,
        tableDensity: 'comfortable',
        showCategoryColors: true,
        showSummaryChips: true,
        accent: 'primary',
    },
    categories: [
        { id: 'boom-category-general', name: 'כללי', color: BOOM_COLOR_OPTIONS[0], order: 1 },
    ],
    items: [],
});

const VALID_STATUS = new Set(BOOM_STATUS_OPTIONS.map((option) => option.value));
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, fallback = '') {
    return typeof value === 'string' ? value.trim() : fallback;
}

export function normalizeBoomAssignee(assigneeLike) {
    if (!isObject(assigneeLike)) return null;
    const sharePointUserId = Number(assigneeLike.sharePointUserId ?? assigneeLike.Id);
    const loginName = text(assigneeLike.loginName ?? assigneeLike.LoginName);
    const email = text(assigneeLike.email ?? assigneeLike.Email).toLowerCase();
    const personalNumber = text(assigneeLike.personalNumber).replace(/\D/g, '');
    const identityKey = text(assigneeLike.identityKey).toLowerCase()
        || (Number.isInteger(sharePointUserId) && sharePointUserId > 0 ? `sp:${sharePointUserId}` : '')
        || (loginName ? `login:${loginName.toLowerCase()}` : '')
        || (email ? `email:${email}` : '')
        || (personalNumber ? `pn:${personalNumber}` : '');
    if (!identityKey) return null;

    return {
        displayName: text(assigneeLike.displayName ?? assigneeLike.Title),
        personalNumber,
        loginName,
        email,
        sharePointUserId: Number.isInteger(sharePointUserId) && sharePointUserId > 0 ? sharePointUserId : null,
        identityKey,
    };
}

function integer(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
}

function validDate(value, fallback) {
    const candidate = text(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return fallback;
    return Number.isFinite(Date.parse(`${candidate}T00:00:00`)) ? candidate : fallback;
}

function todayDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function normalizeSummaryMetrics(value) {
    const metrics = Array.isArray(value)
        ? value.filter((metric) => VALID_SUMMARY_METRICS.has(metric))
        : DEFAULT_SUMMARY_METRICS;
    return [...new Set(metrics)];
}

function normalizeBoomDesign(designLike) {
    const source = isObject(designLike) ? designLike : {};
    return {
        showSummaryStrip: source.showSummaryStrip !== undefined
            ? source.showSummaryStrip !== false
            : source.showDashboard !== false,
        summaryMetrics: normalizeSummaryMetrics(source.summaryMetrics),
        tableDensity: VALID_TABLE_DENSITIES.has(source.tableDensity)
            ? source.tableDensity
            : DEFAULT_BOOM_DATA.design.tableDensity,
        showCategoryColors: source.showCategoryColors !== false,
        showSummaryChips: source.showSummaryChips !== false,
        accent: VALID_ACCENTS.has(source.accent) ? source.accent : DEFAULT_BOOM_DATA.design.accent,
    };
}

export function isValidBoomColor(value) {
    return HEX_COLOR_RE.test(text(value));
}

export function normalizeBoomStatus(value) {
    return VALID_STATUS.has(value) ? value : BOOM_STATUS_OPTIONS[0].value;
}

export function normalizeBoomTask(taskLike, index = 0) {
    const source = isObject(taskLike) ? taskLike : {};
    const startDate = validDate(source.startDate, '');
    const endCandidate = validDate(source.endDate ?? source.deadline, startDate);
    const endDate = !startDate || !endCandidate || Date.parse(`${endCandidate}T00:00:00`) >= Date.parse(`${startDate}T00:00:00`)
        ? endCandidate
        : startDate;

    return {
        id: text(source.id, `boom-task-${index + 1}`),
        title: text(source.title, `משימה ${index + 1}`),
        category: text(source.category ?? source.domain, 'כללי'),
        owner: text(source.owner ?? source.responsibleOwner),
        ...(normalizeBoomAssignee(source.linkedAssignee)
            ? { linkedAssignee: normalizeBoomAssignee(source.linkedAssignee) }
            : {}),
        ...(Number(source.assignmentVersion) > 0
            ? { assignmentVersion: integer(source.assignmentVersion, 1, Number.MAX_SAFE_INTEGER, 1) }
            : {}),
        status: normalizeBoomStatus(source.status),
        startDate,
        endDate,
        details: text(source.details ?? source.description ?? source.notes),
        color: isValidBoomColor(source.color) ? source.color : BOOM_COLOR_OPTIONS[0],
        order: integer(source.order, 0, Number.MAX_SAFE_INTEGER, index + 1),
    };
}

function normalizeBoomCategories(categoriesLike, tasks) {
    const source = Array.isArray(categoriesLike) ? categoriesLike : [];
    const seen = new Set();
    const categories = [];

    source.forEach((categoryLike, index) => {
        const category = isObject(categoryLike) ? categoryLike : {};
        const name = text(category.name ?? category.label);
        const key = name.toLocaleLowerCase('he');
        if (!name || seen.has(key)) return;
        seen.add(key);
        categories.push({
            id: text(category.id, `boom-category-${index + 1}`),
            name,
            color: isValidBoomColor(category.color)
                ? category.color
                : BOOM_COLOR_OPTIONS[index % BOOM_COLOR_OPTIONS.length],
            order: integer(category.order, 0, Number.MAX_SAFE_INTEGER, index + 1),
        });
    });

    tasks.forEach((task) => {
        const key = task.category.toLocaleLowerCase('he');
        if (seen.has(key)) return;
        seen.add(key);
        categories.push({
            id: `boom-category-${categories.length + 1}`,
            name: task.category,
            color: task.color,
            order: categories.length + 1,
        });
    });

    if (categories.length === 0) {
        categories.push({ ...DEFAULT_BOOM_DATA.categories[0] });
    }

    return categories.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, 'he'));
}

export function normalizeBoomData(dataLike) {
    const source = isObject(dataLike) ? dataLike : {};
    const items = (Array.isArray(source.items) ? source.items : [])
        .map((item, index) => normalizeBoomTask(item, index))
        .sort((left, right) => left.order - right.order);
    const categories = normalizeBoomCategories(source.categories, items);
    const categoryByName = new Map(categories.map((category) => [category.name.toLocaleLowerCase('he'), category]));

    return {
        enabled: source.enabled === true,
        buttonLabel: text(source.buttonLabel, DEFAULT_BOOM_DATA.buttonLabel),
        pageTitle: text(source.pageTitle, DEFAULT_BOOM_DATA.pageTitle),
        description: text(source.description, DEFAULT_BOOM_DATA.description),
        design: normalizeBoomDesign(source.design),
        categories,
        items: items.map((task) => {
            const category = categoryByName.get(task.category.toLocaleLowerCase('he'));
            return {
                ...task,
                category: category?.name || task.category,
                color: category?.color || task.color,
            };
        }),
    };
}

export function cloneBoomData(value = DEFAULT_BOOM_DATA) {
    return normalizeBoomData(JSON.parse(JSON.stringify(value)));
}

export function createBoomTask(overrides = {}) {
    const now = todayDateString();
    return normalizeBoomTask({
        id: `boom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: '',
        category: 'כללי',
        owner: '',
        status: 'planned',
        startDate: now,
        endDate: now,
        details: '',
        color: BOOM_COLOR_OPTIONS[0],
        order: Date.now(),
        ...overrides,
    });
}

export function createBoomCategory(overrides = {}, categories = []) {
    const highestOrder = (Array.isArray(categories) ? categories : [])
        .reduce((max, category) => Math.max(max, Number(category?.order) || 0), 0);
    const index = Math.max(0, highestOrder);
    return {
        id: text(overrides.id, `boom-category-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
        name: text(overrides.name, `תחום ${index + 1}`),
        color: isValidBoomColor(overrides.color) ? overrides.color : BOOM_COLOR_OPTIONS[index % BOOM_COLOR_OPTIONS.length],
        order: integer(overrides.order, 0, Number.MAX_SAFE_INTEGER, index + 1),
    };
}

export function updateBoomCategory(dataLike, categoryId, patch = {}) {
    const current = normalizeBoomData(dataLike);
    const target = current.categories.find((category) => category.id === categoryId);
    if (!target) return current;

    const name = text(patch.name, target.name);
    const hasDuplicateName = current.categories.some((category) => (
        category.id !== categoryId && category.name.localeCompare(name, 'he', { sensitivity: 'accent' }) === 0
    ));
    if (!name || hasDuplicateName) return current;

    const color = isValidBoomColor(patch.color) ? patch.color : target.color;
    const categories = current.categories.map((category) => (
        category.id === categoryId ? { ...category, name, color } : category
    ));
    const items = current.items.map((task) => (
        task.category === target.name ? { ...task, category: name, color } : task
    ));
    return normalizeBoomData({ ...current, categories, items });
}

export function deleteBoomCategory(dataLike, categoryId, replacementCategoryId) {
    const current = normalizeBoomData(dataLike);
    const target = current.categories.find((category) => category.id === categoryId);
    if (!target) return current;

    const alternatives = current.categories.filter((category) => category.id !== categoryId);
    if (alternatives.length === 0) {
        throw new Error('לא ניתן למחוק את הקטגוריה האחרונה. יש להוסיף קטגוריה חלופית תחילה.');
    }
    const replacement = alternatives.find((category) => category.id === replacementCategoryId) || alternatives[0];
    const categories = alternatives.map((category, index) => ({ ...category, order: index + 1 }));
    const items = current.items.map((task) => (
        task.category === target.name
            ? { ...task, category: replacement.name, color: replacement.color }
            : task
    ));
    return normalizeBoomData({ ...current, categories, items });
}

export function reorderBoomCategory(dataLike, categoryId, direction) {
    const current = normalizeBoomData(dataLike);
    const index = current.categories.findIndex((category) => category.id === categoryId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= current.categories.length) return current;

    const categories = [...current.categories];
    [categories[index], categories[nextIndex]] = [categories[nextIndex], categories[index]];
    return normalizeBoomData({
        ...current,
        categories: categories.map((category, order) => ({ ...category, order: order + 1 })),
    });
}

function addDays(date, days) {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    next.setDate(next.getDate() + days);
    return [
        next.getFullYear(),
        String(next.getMonth() + 1).padStart(2, '0'),
        String(next.getDate()).padStart(2, '0'),
    ].join('-');
}

export function computeBoomProgress(taskLike, today = new Date()) {
    return computeGanttProgress(taskLike, today);
}

export function createBoomDemoData(today = new Date()) {
    const categories = [
        { id: 'boom-category-operations', name: 'מבצעים', color: '#2563eb', order: 1 },
        { id: 'boom-category-readiness', name: 'כשירות', color: '#0f766e', order: 2 },
        { id: 'boom-category-community', name: 'קהילה', color: '#7c3aed', order: 3 },
    ];
    const items = [
        {
            id: 'boom-demo-completed',
            title: 'סיכום תמונת מצב קודמת',
            category: 'מבצעים',
            owner: 'חדר מבצעים',
            status: 'completed',
            startDate: addDays(today, -18),
            endDate: addDays(today, -8),
            details: 'סיכום המשימות והפקת לקחים מהתקופה שהסתיימה.',
            color: '#2563eb',
            order: 1,
        },
        {
            id: 'boom-demo-active',
            title: 'עדכון תמונת מצב יומית',
            category: 'מבצעים',
            owner: 'קצין תורן',
            status: 'active',
            startDate: addDays(today, -5),
            endDate: addDays(today, 5),
            details: 'איסוף תמונת מצב, חסמים והחלטות לביצוע.',
            color: '#2563eb',
            order: 2,
        },
        {
            id: 'boom-demo-blocked',
            title: 'השלמת כשירות צוותים',
            category: 'כשירות',
            owner: 'רכז כשירות',
            status: 'blocked',
            startDate: addDays(today, -3),
            endDate: addDays(today, 9),
            details: 'מעקב אחר פערי הכשרה וציוד הדורשים טיפול.',
            color: '#0f766e',
            order: 3,
        },
        {
            id: 'boom-demo-planned',
            title: 'היערכות לפעילות קהילתית',
            category: 'קהילה',
            owner: 'רכזת קהילה',
            status: 'planned',
            startDate: addDays(today, 7),
            endDate: addDays(today, 21),
            details: 'תיאום בעלי תפקידים, תשתיות ופרסום.',
            color: '#7c3aed',
            order: 4,
        },
    ];

    return normalizeBoomData({
        ...DEFAULT_BOOM_DATA,
        categories,
        items,
    });
}

export function createInitialBoomData(today = new Date()) {
    return createBoomDemoData(today);
}

export function loadBoomDemoData(current, today = new Date()) {
    const demo = createBoomDemoData(today);
    const normalizedCurrent = normalizeBoomData(current);
    return {
        ...normalizedCurrent,
        categories: demo.categories,
        items: demo.items,
    };
}

export function clearBoomTasks(current) {
    return {
        ...normalizeBoomData(current),
        items: [],
    };
}
