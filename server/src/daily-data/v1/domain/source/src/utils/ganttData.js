export const GANTT_STATUS_OPTIONS = [
    { value: 'planned', label: 'מתוכנן' },
    { value: 'blocked', label: 'חסום' },
    { value: 'completed', label: 'הושלם' },
    { value: 'cancelled', label: 'בוטל' },
    { value: 'onHold', label: 'בהמתנה' },
];

export const GANTT_TIME_STATUS_OPTIONS = [
    { value: 'upcoming', label: 'עתידי' },
    { value: 'active', label: 'בתהליך' },
    { value: 'overdue', label: 'מאחר' },
    { value: 'completed', label: 'הושלם' },
    { value: 'cancelled', label: 'בוטל' },
    { value: 'ended', label: 'הסתיים' },
    { value: 'invalidDate', label: 'תאריך לא תקין' },
];

export const GANTT_VIEW_OPTIONS = [
    { value: 'day', label: 'יום' },
    { value: 'week', label: 'שבוע' },
    { value: 'month', label: 'חודש' },
    { value: 'quarter', label: 'רבעון' },
];

export const GANTT_RECURRENCE_FREQUENCY_OPTIONS = [
    { value: 'weekly', label: 'שבועי' },
    { value: 'monthly', label: 'חודשי' },
];

export const GANTT_RECURRENCE_MONTHLY_MODE_OPTIONS = [
    { value: 'weekdays', label: 'לפי ימים בשבוע' },
    { value: 'dayOfMonth', label: 'לפי יום בחודש' },
];

export const GANTT_WEEKDAY_OPTIONS = [
    { value: 0, label: 'ראשון', shortLabel: 'א׳' },
    { value: 1, label: 'שני', shortLabel: 'ב׳' },
    { value: 2, label: 'שלישי', shortLabel: 'ג׳' },
    { value: 3, label: 'רביעי', shortLabel: 'ד׳' },
    { value: 4, label: 'חמישי', shortLabel: 'ה׳' },
    { value: 5, label: 'שישי', shortLabel: 'ו׳' },
    { value: 6, label: 'שבת', shortLabel: 'ש׳' },
];

export const GANTT_COLOR_OPTIONS = [
    '#2563eb',
    '#0891b2',
    '#16a34a',
    '#d97706',
    '#dc2626',
    '#7c3aed',
    '#0f766e',
    '#475569',
];

export const DEFAULT_GANTT_CATEGORIES = [
    { id: 'gantt-category-planning', name: 'תכנון', color: '#2563eb', order: 1 },
    { id: 'gantt-category-content', name: 'תוכן', color: '#0891b2', order: 2 },
    { id: 'gantt-category-approval', name: 'אישורים', color: '#d97706', order: 3 },
    { id: 'gantt-category-development', name: 'פיתוח', color: '#7c3aed', order: 4 },
    { id: 'gantt-category-qa', name: 'בדיקות', color: '#16a34a', order: 5 },
    { id: 'gantt-category-delivery', name: 'מסירה', color: '#0f766e', order: 6 },
    { id: 'gantt-category-general', name: 'כללי', color: '#475569', order: 7 },
];

export const DEFAULT_GANTT_ITEMS = [
    {
        id: 'gantt-demo-discovery',
        title: 'איפיון מסלול העבודה',
        owner: 'צוות פרויקט',
        category: 'תכנון',
        status: 'completed',
        startDate: '2026-06-02',
        endDate: '2026-06-07',
        color: '#2563eb',
        details: 'משימה מלאה לדוגמה: איסוף צרכים, מיפוי בעלי עניין וסגירת מבנה ראשוני של הגאנט.',
        dependsOn: [],
        milestones: [
            { id: 'gantt-demo-discovery-interviews', title: 'סיום ראיונות', date: '2026-06-04' },
            { id: 'gantt-demo-discovery-approved', title: 'אישור אפיון', date: '2026-06-07' },
        ],
    },
    {
        id: 'gantt-demo-content',
        title: 'איסוף תכנים מהיחידות',
        owner: 'מדור תוכן',
        category: 'תוכן',
        status: 'planned',
        startDate: '2026-06-12',
        endDate: '2026-07-02',
        color: '#0891b2',
        details: 'ריכוז קבצים, תאריכים וקישורים שייכנסו לעמודי התוכן.',
        dependsOn: ['gantt-demo-discovery'],
        milestones: [
            { id: 'gantt-demo-content-template', title: 'תבנית מוכנה', date: '2026-06-17' },
            { id: 'gantt-demo-content-ready', title: 'תוכן ראשוני מוכן', date: '2026-07-02' },
        ],
    },
    {
        id: 'gantt-demo-approval',
        title: 'אישור גורמי מטה',
        owner: 'מנהל המערכת',
        category: 'אישורים',
        status: 'blocked',
        startDate: '2026-06-24',
        endDate: '2026-07-01',
        color: '#d97706',
        details: 'דוגמה למשימה חסומה: ממתינה להערות סופיות לפני המשך עבודה.',
        dependsOn: ['gantt-demo-content'],
        milestones: [
            { id: 'gantt-demo-approval-review', title: 'סבב הערות', date: '2026-06-30' },
        ],
    },
    {
        id: 'gantt-demo-build',
        title: 'בניית תצוגת גאנט',
        owner: 'צוות פיתוח',
        category: 'פיתוח',
        status: 'planned',
        startDate: '2026-06-27',
        endDate: '2026-07-10',
        color: '#7c3aed',
        details: 'הטמעת מסך ניהול, תצוגה ציבורית, פילטרים ואבני דרך.',
        dependsOn: ['gantt-demo-discovery', 'gantt-demo-content'],
        milestones: [
            { id: 'gantt-demo-build-admin', title: 'מסך ניהול', date: '2026-07-03' },
            { id: 'gantt-demo-build-public', title: 'תצוגה ציבורית', date: '2026-07-10' },
        ],
    },
    {
        id: 'gantt-demo-link-check',
        title: 'בדיקת קישורים',
        category: 'בדיקות',
        status: 'onHold',
        startDate: '2026-07-03',
        endDate: '2026-07-03',
        color: '#16a34a',
    },
    {
        id: 'gantt-demo-weekly-update',
        title: 'תזכורת עדכון שבועי',
        startDate: '2026-07-08',
        endDate: '2026-07-08',
    },
    {
        id: 'gantt-demo-rollout',
        title: 'פרסום גרסה ראשונה',
        category: 'מסירה',
        status: 'planned',
        startDate: '2026-07-11',
        endDate: '2026-07-14',
        color: '#0f766e',
        details: 'משימת מסירה קצרה עם תלות במשימות הבנייה והבדיקה.',
        dependsOn: ['gantt-demo-build', 'gantt-demo-link-check'],
        milestones: [
            { id: 'gantt-demo-rollout-live', title: 'עלייה לאוויר', date: '2026-07-14' },
        ],
    },
    {
        id: 'gantt-demo-cancelled-drill',
        title: 'תרגול שבוטל',
        category: 'בדיקות',
        status: 'cancelled',
        startDate: '2026-06-16',
        endDate: '2026-06-18',
        color: '#dc2626',
        details: 'דוגמה לפריט שבוטל ונשאר בגאנט לצורך תיעוד.',
    },
];

export const DEFAULT_GANTT_DATA = {
    enabled: false,
    buttonLabel: 'גאנט עבודה',
    pageTitle: 'גאנט עבודה',
    description: 'נתוני דוגמה לניהול גאנט: משימות מלאות לצד משימות קצרות שמסתמכות על השלמות אוטומטיות.',
    groupBy: 'category',
    defaultView: 'month',
    showLegend: true,
    showToday: true,
    categories: DEFAULT_GANTT_CATEGORIES,
    items: DEFAULT_GANTT_ITEMS,
};

export const DEFAULT_GANTT_DESIGN = {
    presetId: 'classic-beige',
    layoutMode: 'fullWidth',
    chartWidthMode: 'full',
    chartHeightMode: 'viewport',
    density: 'comfortable',
    taskColumnWidth: 'medium',
    cardStyle: 'soft',
    backgroundStyle: 'site',
    toolbarStyle: 'comfortable',
    gridStyle: 'subtle',
    barStyle: 'rounded',
    milestoneStyle: 'diamond',
    legendPlacement: 'bottom',
    todayLineStyle: 'soft',
    showOuterCard: true,
    barShadow: true,
    showProgressLabel: true,
    showTaskNameOnBar: false,
    showHebrewDate: false,
    showHolidays: false,
    colors: {
        chartBackground: '#ffffff',
        cardBackground: '#ffffff',
        accentColor: '#2563eb',
        todayLineColor: '#ef4444',
    },
};

export const GANTT_DESIGN_PRESETS = [
    {
        id: 'classic-beige',
        name: 'קלאסי חמים',
        description: 'העיצוב הציבורי הנוכחי בגווני בז׳ וחום, מתאים לאתר בעיצוב חמים.',
        settings: {
            ...DEFAULT_GANTT_DESIGN,
            presetId: 'classic-beige',
            layoutMode: 'fullWidth',
            chartWidthMode: 'full',
            cardStyle: 'soft',
            backgroundStyle: 'site',
            toolbarStyle: 'comfortable',
            density: 'comfortable',
            gridStyle: 'subtle',
        },
    },
    {
        id: 'clean-card',
        name: 'כרטיס נקי',
        description: 'עיצוב בהיר ונקי כמו התצוגה המקדימה בניהול, עם כרטיס ממורכז, רקע בהיר וגבולות עדינים.',
        settings: {
            ...DEFAULT_GANTT_DESIGN,
            presetId: 'clean-card',
            layoutMode: 'centered',
            chartWidthMode: 'contained',
            cardStyle: 'clean',
            backgroundStyle: 'clean',
            toolbarStyle: 'compact',
            density: 'comfortable',
            gridStyle: 'subtle',
            barShadow: false,
            colors: {
                chartBackground: '#f8fafc',
                cardBackground: '#ffffff',
                accentColor: '#2563eb',
                todayLineColor: '#ef4444',
            },
        },
    },
    {
        id: 'full-board',
        name: 'לוח מלא',
        description: 'תרשים רחב שמנצל את כל רוחב המסך, מתאים להרבה משימות.',
        settings: {
            ...DEFAULT_GANTT_DESIGN,
            presetId: 'full-board',
            layoutMode: 'fullWidth',
            chartWidthMode: 'full',
            cardStyle: 'minimal',
            backgroundStyle: 'clean',
            toolbarStyle: 'compact',
            density: 'comfortable',
            taskColumnWidth: 'wide',
            showOuterCard: true,
            barShadow: false,
        },
    },
    {
        id: 'compact',
        name: 'קומפקטי',
        description: 'עיצוב צפוף יותר שמתאים למסכים קטנים או להרבה משימות.',
        settings: {
            ...DEFAULT_GANTT_DESIGN,
            presetId: 'compact',
            layoutMode: 'fullWidth',
            chartWidthMode: 'full',
            cardStyle: 'clean',
            backgroundStyle: 'clean',
            toolbarStyle: 'compact',
            chartHeightMode: 'compact',
            density: 'compact',
            taskColumnWidth: 'narrow',
            gridStyle: 'minimal',
            barShadow: false,
            showProgressLabel: false,
        },
    },
    {
        id: 'glass-modern',
        name: 'זכוכית מודרנית',
        description: 'עיצוב זכוכית עדין עם רקע מטושטש ושקיפות קלה.',
        settings: {
            ...DEFAULT_GANTT_DESIGN,
            presetId: 'glass-modern',
            layoutMode: 'centered',
            chartWidthMode: 'contained',
            cardStyle: 'glass',
            backgroundStyle: 'glass',
            toolbarStyle: 'comfortable',
            density: 'comfortable',
            gridStyle: 'subtle',
            colors: {
                chartBackground: '#f8fafc',
                cardBackground: '#ffffff',
                accentColor: '#0f766e',
                todayLineColor: '#dc2626',
            },
        },
    },
];

const VALID_GROUP_BY = new Set(['category', 'owner', 'status', 'none']);
const VALID_STATUS = new Set(GANTT_STATUS_OPTIONS.map((option) => option.value));
const VALID_VIEW = new Set(GANTT_VIEW_OPTIONS.map((option) => option.value));
const VALID_RECURRENCE_FREQUENCY = new Set(GANTT_RECURRENCE_FREQUENCY_OPTIONS.map((option) => option.value));
const VALID_RECURRENCE_MONTHLY_MODE = new Set(GANTT_RECURRENCE_MONTHLY_MODE_OPTIONS.map((option) => option.value));
const VALID_WEEKDAY = new Set(GANTT_WEEKDAY_OPTIONS.map((option) => option.value));
const VALID_DESIGN_PRESET = new Set(GANTT_DESIGN_PRESETS.map((preset) => preset.id));
const VALID_LAYOUT_MODE = new Set(['fullWidth', 'centered']);
const VALID_CHART_WIDTH_MODE = new Set(['full', 'contained']);
const VALID_CHART_HEIGHT_MODE = new Set(['auto', 'viewport', 'fixed', 'compact']);
const VALID_DENSITY = new Set(['compact', 'comfortable', 'spacious']);
const VALID_TASK_COLUMN_WIDTH = new Set(['narrow', 'medium', 'wide']);
const VALID_CARD_STYLE = new Set(['soft', 'clean', 'minimal', 'glass']);
const VALID_BACKGROUND_STYLE = new Set(['site', 'clean', 'subtle', 'glass']);
const VALID_TOOLBAR_STYLE = new Set(['compact', 'comfortable', 'sticky']);
const VALID_GRID_STYLE = new Set(['minimal', 'subtle', 'strong']);
const VALID_BAR_STYLE = new Set(['rounded', 'flat']);
const VALID_MILESTONE_STYLE = new Set(['diamond', 'dot', 'flag']);
const VALID_LEGEND_PLACEMENT = new Set(['bottom', 'top', 'hidden']);
const VALID_TODAY_LINE_STYLE = new Set(['soft', 'strong', 'minimal']);
const LEGACY_STATUS_MAP = {
    active: 'planned',
    done: 'completed',
};
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const toString = (value, fallback = '') => (typeof value === 'string' ? value : fallback);

const toId = (value, fallback) => {
    const normalized = String(value ?? '').trim();
    return normalized || fallback;
};

export const isValidGanttColor = (value) => HEX_COLOR_RE.test(String(value || '').trim());

const normalizeColor = (value, fallback) => {
    const color = toString(value, fallback).trim();
    return isValidGanttColor(color) ? color : fallback;
};

const normalizeOrder = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
};

const normalizeChoice = (value, validValues, fallback) => (
    validValues.has(value) ? value : fallback
);

const normalizeBoolean = (value, fallback) => (
    typeof value === 'boolean' ? value : fallback
);

function getPresetSettings(presetId) {
    return GANTT_DESIGN_PRESETS.find((preset) => preset.id === presetId)?.settings || DEFAULT_GANTT_DESIGN;
}

export function normalizeGanttDesignSettings(designLike) {
    const source = isObject(designLike) ? designLike : {};
    const requestedPresetId = normalizeChoice(source.presetId, VALID_DESIGN_PRESET, DEFAULT_GANTT_DESIGN.presetId);
    const presetDefaults = getPresetSettings(requestedPresetId);
    const merged = {
        ...DEFAULT_GANTT_DESIGN,
        ...presetDefaults,
        ...source,
        presetId: requestedPresetId,
        colors: {
            ...DEFAULT_GANTT_DESIGN.colors,
            ...(isObject(presetDefaults.colors) ? presetDefaults.colors : {}),
            ...(isObject(source.colors) ? source.colors : {}),
        },
    };

    return {
        presetId: requestedPresetId,
        layoutMode: normalizeChoice(merged.layoutMode, VALID_LAYOUT_MODE, presetDefaults.layoutMode),
        chartWidthMode: normalizeChoice(merged.chartWidthMode, VALID_CHART_WIDTH_MODE, presetDefaults.chartWidthMode),
        chartHeightMode: normalizeChoice(merged.chartHeightMode, VALID_CHART_HEIGHT_MODE, presetDefaults.chartHeightMode),
        density: normalizeChoice(merged.density, VALID_DENSITY, presetDefaults.density),
        taskColumnWidth: normalizeChoice(merged.taskColumnWidth, VALID_TASK_COLUMN_WIDTH, presetDefaults.taskColumnWidth),
        cardStyle: normalizeChoice(merged.cardStyle, VALID_CARD_STYLE, presetDefaults.cardStyle),
        backgroundStyle: normalizeChoice(merged.backgroundStyle, VALID_BACKGROUND_STYLE, presetDefaults.backgroundStyle),
        toolbarStyle: normalizeChoice(merged.toolbarStyle, VALID_TOOLBAR_STYLE, presetDefaults.toolbarStyle),
        gridStyle: normalizeChoice(merged.gridStyle, VALID_GRID_STYLE, presetDefaults.gridStyle),
        barStyle: normalizeChoice(merged.barStyle, VALID_BAR_STYLE, presetDefaults.barStyle),
        milestoneStyle: normalizeChoice(merged.milestoneStyle, VALID_MILESTONE_STYLE, presetDefaults.milestoneStyle),
        legendPlacement: normalizeChoice(merged.legendPlacement, VALID_LEGEND_PLACEMENT, presetDefaults.legendPlacement),
        todayLineStyle: normalizeChoice(merged.todayLineStyle, VALID_TODAY_LINE_STYLE, presetDefaults.todayLineStyle),
        showOuterCard: normalizeBoolean(merged.showOuterCard, presetDefaults.showOuterCard),
        barShadow: normalizeBoolean(merged.barShadow, presetDefaults.barShadow),
        showProgressLabel: normalizeBoolean(merged.showProgressLabel, presetDefaults.showProgressLabel),
        showTaskNameOnBar: normalizeBoolean(merged.showTaskNameOnBar, presetDefaults.showTaskNameOnBar ?? DEFAULT_GANTT_DESIGN.showTaskNameOnBar),
        showHebrewDate: normalizeBoolean(merged.showHebrewDate, presetDefaults.showHebrewDate ?? DEFAULT_GANTT_DESIGN.showHebrewDate),
        showHolidays: normalizeBoolean(merged.showHolidays, presetDefaults.showHolidays ?? DEFAULT_GANTT_DESIGN.showHolidays),
        colors: {
            chartBackground: normalizeColor(merged.colors.chartBackground, presetDefaults.colors.chartBackground),
            cardBackground: normalizeColor(merged.colors.cardBackground, presetDefaults.colors.cardBackground),
            accentColor: normalizeColor(merged.colors.accentColor, presetDefaults.colors.accentColor),
            todayLineColor: normalizeColor(merged.colors.todayLineColor, presetDefaults.colors.todayLineColor),
        },
    };
}

export function applyGanttDesignPreset(presetId, overrides = {}) {
    const safePresetId = normalizeChoice(presetId, VALID_DESIGN_PRESET, DEFAULT_GANTT_DESIGN.presetId);
    return normalizeGanttDesignSettings({
        ...getPresetSettings(safePresetId),
        ...overrides,
        presetId: safePresetId,
    });
}

const toLocalDateString = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

export const todayDateString = () => toLocalDateString(new Date());

const toDayTimestamp = (value) => {
    const dateValue = value instanceof Date ? toLocalDateString(value) : parseDateValue(value);
    if (!dateValue) return null;
    const parsed = Date.parse(`${dateValue}T00:00:00Z`);
    return Number.isFinite(parsed) ? parsed : null;
};

const dayDiff = (startMs, endMs) => Math.round((endMs - startMs) / (24 * 60 * 60 * 1000));

const addDaysToTimestamp = (timestamp, days) => timestamp + days * 24 * 60 * 60 * 1000;

const toUtcDateString = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);

const getWeekdayFromDateString = (value) => {
    const parsed = toDayTimestamp(value);
    if (!Number.isFinite(parsed)) return 0;
    return new Date(parsed).getUTCDay();
};

const normalizeInteger = (value, fallback, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
};

function normalizeWeekdays(values, fallbackWeekday = 0) {
    const source = Array.isArray(values) ? values : [];
    const normalized = [...new Set(source
        .map((value) => Number(value))
        .filter((value) => VALID_WEEKDAY.has(value)))]
        .sort((a, b) => a - b);
    return normalized.length > 0 ? normalized : [fallbackWeekday];
}

function getDayOfMonth(value) {
    const parsed = toDayTimestamp(value);
    if (!Number.isFinite(parsed)) return 1;
    return new Date(parsed).getUTCDate();
}

function daysInUtcMonth(year, monthIndex) {
    return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function getUtcMonthStart(timestamp) {
    const date = new Date(timestamp);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function addUtcMonths(timestamp, monthOffset) {
    const date = new Date(timestamp);
    const targetMonth = date.getUTCMonth() + monthOffset;
    const targetYear = date.getUTCFullYear() + Math.floor(targetMonth / 12);
    const normalizedMonth = ((targetMonth % 12) + 12) % 12;
    return Date.UTC(targetYear, normalizedMonth, 1);
}

function diffUtcMonths(startMonthTimestamp, endMonthTimestamp) {
    const start = new Date(startMonthTimestamp);
    const end = new Date(endMonthTimestamp);
    return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
}

function startOfUtcWeek(timestamp) {
    const dayStart = Date.UTC(new Date(timestamp).getUTCFullYear(), new Date(timestamp).getUTCMonth(), new Date(timestamp).getUTCDate());
    return addDaysToTimestamp(dayStart, -new Date(dayStart).getUTCDay());
}

export const createGanttTask = (overrides = {}) => {
    const today = todayDateString();
    return normalizeGanttTask({
        id: `gantt-${Date.now()}`,
        title: 'משימה חדשה',
        owner: '',
        category: 'כללי',
        status: 'planned',
        startDate: today,
        endDate: today,
        color: GANTT_COLOR_OPTIONS[0],
        details: '',
        dependsOn: [],
        milestones: [],
        ...overrides,
    }, 0);
};

export function parseDateValue(value) {
    const raw = toString(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const date = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    return raw;
}

export function normalizeGanttRecurrence(recurrenceLike, taskLike = {}) {
    const source = isObject(recurrenceLike) ? recurrenceLike : {};
    const hasExplicitConfig = Boolean(
        source.enabled === true
        || VALID_RECURRENCE_FREQUENCY.has(source.frequency)
        || Array.isArray(source.weekdays)
        || source.until
    );
    const enabled = source.enabled === true || (source.enabled !== false && hasExplicitConfig);
    if (!enabled) return { enabled: false };

    const startDate = parseDateValue(taskLike.startDate) || todayDateString();
    const fallbackWeekday = getWeekdayFromDateString(startDate);
    const frequency = normalizeChoice(source.frequency, VALID_RECURRENCE_FREQUENCY, 'weekly');
    const monthlyMode = normalizeChoice(source.monthlyMode || source.monthMode, VALID_RECURRENCE_MONTHLY_MODE, 'weekdays');
    const recurrence = {
        enabled: true,
        frequency,
        interval: normalizeInteger(source.interval, 1, 1, 24),
        weekdays: normalizeWeekdays(source.weekdays, fallbackWeekday),
        until: parseDateValue(source.until) || '',
        maxOccurrences: normalizeInteger(source.maxOccurrences, 60, 1, 500),
    };

    if (frequency === 'monthly') {
        recurrence.monthlyMode = monthlyMode;
        recurrence.dayOfMonth = normalizeInteger(source.dayOfMonth, getDayOfMonth(startDate), 1, 31);
    }

    return recurrence;
}

export function normalizeGanttRecurrenceForm(recurrenceLike, taskLike = {}) {
    const source = isObject(recurrenceLike) ? recurrenceLike : {};
    const defaults = normalizeGanttRecurrence({ enabled: true, frequency: 'weekly' }, taskLike);
    const normalized = normalizeGanttRecurrence({ ...defaults, ...source, enabled: true }, taskLike);
    return {
        ...defaults,
        ...normalized,
        enabled: source.enabled === true,
    };
}

export function describeGanttRecurrence(recurrenceLike, taskLike = {}) {
    const recurrence = normalizeGanttRecurrence(recurrenceLike, taskLike);
    if (!recurrence.enabled) return 'חד פעמי';

    const dayLabels = recurrence.weekdays
        .map((weekday) => GANTT_WEEKDAY_OPTIONS.find((option) => option.value === weekday)?.label)
        .filter(Boolean)
        .join(', ');
    const intervalText = recurrence.interval === 1 ? '' : `כל ${recurrence.interval} `;
    const untilText = recurrence.until ? ` עד ${recurrence.until}` : '';

    if (recurrence.frequency === 'monthly') {
        if (recurrence.monthlyMode === 'dayOfMonth') {
            return `${intervalText || 'כל '}חודש ביום ${recurrence.dayOfMonth}${untilText}`;
        }
        return `${intervalText || 'כל '}חודש בימים ${dayLabels}${untilText}`;
    }

    return `${intervalText || 'כל '}שבוע בימים ${dayLabels}${untilText}`;
}

function shouldIncludeOccurrence(occurrenceStart, occurrenceEnd, rangeStart, rangeEnd) {
    if (Number.isFinite(rangeStart) && occurrenceEnd < rangeStart) return false;
    if (Number.isFinite(rangeEnd) && occurrenceStart > rangeEnd) return false;
    return true;
}

function buildWeeklyOccurrenceDates(taskLike, recurrence, options) {
    const startMs = toDayTimestamp(taskLike.startDate);
    const endMs = toDayTimestamp(taskLike.endDate) || startMs;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];

    const taskDurationDays = Math.max(0, dayDiff(startMs, endMs));
    const rangeStart = Number.isFinite(options.rangeStart) ? options.rangeStart : startMs;
    const untilMs = toDayTimestamp(recurrence.until);
    const hardEnd = Math.min(
        Number.isFinite(options.rangeEnd) ? options.rangeEnd : Number.POSITIVE_INFINITY,
        Number.isFinite(untilMs) ? untilMs : Number.POSITIVE_INFINITY
    );
    const searchStart = Math.max(startMs, addDaysToTimestamp(rangeStart, -taskDurationDays));
    const fallbackEnd = Number.isFinite(hardEnd)
        ? hardEnd
        : addDaysToTimestamp(startMs, recurrence.maxOccurrences * recurrence.interval * 8 + 366);
    const anchorWeekStart = startOfUtcWeek(startMs);
    const dates = [];
    let cursor = Date.UTC(new Date(searchStart).getUTCFullYear(), new Date(searchStart).getUTCMonth(), new Date(searchStart).getUTCDate());
    let safety = 0;

    while (cursor <= fallbackEnd && dates.length < recurrence.maxOccurrences && safety < 50000) {
        const occurrenceEnd = addDaysToTimestamp(cursor, taskDurationDays);
        const weekOffset = Math.floor(dayDiff(anchorWeekStart, startOfUtcWeek(cursor)) / 7);
        const isMatchingWeek = weekOffset >= 0 && weekOffset % recurrence.interval === 0;
        if (
            cursor >= startMs
            && isMatchingWeek
            && recurrence.weekdays.includes(new Date(cursor).getUTCDay())
            && shouldIncludeOccurrence(cursor, occurrenceEnd, options.rangeStart, options.rangeEnd)
        ) {
            dates.push(toUtcDateString(cursor));
        }
        cursor = addDaysToTimestamp(cursor, 1);
        safety += 1;
    }

    return dates;
}

function buildMonthlyOccurrenceDates(taskLike, recurrence, options) {
    const startMs = toDayTimestamp(taskLike.startDate);
    const endMs = toDayTimestamp(taskLike.endDate) || startMs;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];

    const taskDurationDays = Math.max(0, dayDiff(startMs, endMs));
    const rangeStart = Number.isFinite(options.rangeStart) ? options.rangeStart : startMs;
    const untilMs = toDayTimestamp(recurrence.until);
    const hardEnd = Math.min(
        Number.isFinite(options.rangeEnd) ? options.rangeEnd : Number.POSITIVE_INFINITY,
        Number.isFinite(untilMs) ? untilMs : Number.POSITIVE_INFINITY
    );
    const searchStart = Math.max(startMs, addDaysToTimestamp(rangeStart, -taskDurationDays));
    const fallbackEnd = Number.isFinite(hardEnd)
        ? hardEnd
        : addUtcMonths(startMs, recurrence.maxOccurrences * Math.max(1, recurrence.interval));
    const anchorMonth = getUtcMonthStart(startMs);
    let cursorMonth = getUtcMonthStart(searchStart);
    const dates = [];
    let safety = 0;

    while (cursorMonth <= fallbackEnd && dates.length < recurrence.maxOccurrences && safety < 1200) {
        const monthOffset = diffUtcMonths(anchorMonth, cursorMonth);
        if (monthOffset >= 0 && monthOffset % recurrence.interval === 0) {
            const cursorDate = new Date(cursorMonth);
            const year = cursorDate.getUTCFullYear();
            const month = cursorDate.getUTCMonth();
            const daysInMonth = daysInUtcMonth(year, month);
            const candidates = [];

            if (recurrence.monthlyMode === 'dayOfMonth') {
                candidates.push(Date.UTC(year, month, Math.min(recurrence.dayOfMonth, daysInMonth)));
            } else {
                for (let day = 1; day <= daysInMonth; day += 1) {
                    const candidate = Date.UTC(year, month, day);
                    if (recurrence.weekdays.includes(new Date(candidate).getUTCDay())) {
                        candidates.push(candidate);
                    }
                }
            }

            candidates.forEach((candidate) => {
                const occurrenceEnd = addDaysToTimestamp(candidate, taskDurationDays);
                if (
                    dates.length < recurrence.maxOccurrences
                    && candidate >= startMs
                    && shouldIncludeOccurrence(candidate, occurrenceEnd, options.rangeStart, options.rangeEnd)
                ) {
                    dates.push(toUtcDateString(candidate));
                }
            });
        }

        cursorMonth = addUtcMonths(cursorMonth, 1);
        safety += 1;
    }

    return dates.sort((a, b) => a.localeCompare(b));
}

export function getGanttRecurringOccurrenceDates(taskLike, options = {}) {
    const recurrence = normalizeGanttRecurrence(taskLike?.recurrence, taskLike);
    if (!recurrence.enabled) return [];
    const normalizedOptions = {
        rangeStart: toDayTimestamp(options.rangeStart) ?? (Number.isFinite(options.rangeStart) ? options.rangeStart : null),
        rangeEnd: toDayTimestamp(options.rangeEnd) ?? (Number.isFinite(options.rangeEnd) ? options.rangeEnd : null),
    };
    return recurrence.frequency === 'monthly'
        ? buildMonthlyOccurrenceDates(taskLike, recurrence, normalizedOptions)
        : buildWeeklyOccurrenceDates(taskLike, recurrence, normalizedOptions);
}

function createRecurringTaskOccurrence(task, startDate, occurrenceIndex) {
    const originalStart = toDayTimestamp(task.startDate);
    const originalEnd = toDayTimestamp(task.endDate) || originalStart;
    const nextStart = toDayTimestamp(startDate);
    const durationDays = Math.max(0, dayDiff(originalStart, originalEnd));
    const shiftDays = dayDiff(originalStart, nextStart);
    const occurrenceTask = {
        ...task,
        id: `${task.id}__occ_${startDate}`,
        startDate,
        endDate: toUtcDateString(addDaysToTimestamp(nextStart, durationDays)),
        milestones: normalizeGanttMilestones((task.milestones || []).map((milestone) => {
            const milestoneMs = toDayTimestamp(milestone.date);
            return Number.isFinite(milestoneMs)
                ? { ...milestone, date: toUtcDateString(addDaysToTimestamp(milestoneMs, shiftDays)) }
                : milestone;
        })),
        isRecurringOccurrence: true,
        recurrenceMeta: {
            sourceTaskId: task.id,
            occurrenceIndex: occurrenceIndex + 1,
            occurrenceDate: startDate,
            ruleLabel: describeGanttRecurrence(task.recurrence, task),
        },
    };

    return {
        ...occurrenceTask,
        progress: computeGanttProgress(occurrenceTask),
    };
}

export function expandGanttRecurringTasks(items, options = {}) {
    if (!Array.isArray(items)) return [];
    return items.flatMap((task) => {
        const recurrence = normalizeGanttRecurrence(task?.recurrence, task);
        if (!recurrence.enabled) return [task];
        return getGanttRecurringOccurrenceDates(task, options)
            .map((date, index) => createRecurringTaskOccurrence(task, date, index));
    });
}

export function computeGanttProgress(taskLike, today = new Date()) {
    const start = toDayTimestamp(taskLike?.startDate);
    const end = toDayTimestamp(taskLike?.endDate);
    const todayMs = toDayTimestamp(today);

    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(todayMs) || end < start) return 0;
    if (todayMs < start) return 0;
    if (todayMs > end) return 100;
    if (start === end) return todayMs >= start ? 100 : 0;

    const elapsedDays = dayDiff(start, todayMs);
    const totalDays = dayDiff(start, end);
    if (totalDays <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((elapsedDays / totalDays) * 100)));
}

export function computeGanttTimeStatus(taskLike, today = new Date()) {
    const manualStatus = normalizeGanttStatus(taskLike?.status);
    if (manualStatus === 'completed') return 'completed';
    if (manualStatus === 'cancelled') return 'cancelled';

    const start = toDayTimestamp(taskLike?.startDate);
    const end = toDayTimestamp(taskLike?.endDate);
    const todayMs = toDayTimestamp(today);

    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(todayMs) || end < start) return 'invalidDate';
    if (todayMs < start) return 'upcoming';
    if (todayMs <= end) return 'active';
    return 'overdue';
}

export function normalizeGanttStatus(value) {
    const normalized = LEGACY_STATUS_MAP[value] || value;
    return VALID_STATUS.has(normalized) ? normalized : 'planned';
}

export function normalizeGanttMilestone(milestoneLike, index = 0) {
    const source = isObject(milestoneLike) ? milestoneLike : {};
    const date = parseDateValue(source.date);
    if (!date) return null;

    return {
        id: toId(source.id, `gantt-milestone-${index + 1}`),
        title: toString(source.title || source.name, '').trim() || `אבן דרך ${index + 1}`,
        date,
        order: index + 1,
        ...(toString(source.createdAt).trim() ? { createdAt: toString(source.createdAt).trim() } : {}),
        ...(toString(source.updatedAt).trim() ? { updatedAt: toString(source.updatedAt).trim() } : {}),
    };
}

export function normalizeGanttMilestones(milestonesLike) {
    if (!Array.isArray(milestonesLike)) return [];
    return milestonesLike
        .map((milestone, index) => normalizeGanttMilestone(milestone, index))
        .filter(Boolean)
        .sort((a, b) => {
            const dateCompare = a.date.localeCompare(b.date);
            if (dateCompare !== 0) return dateCompare;
            return a.title.localeCompare(b.title, 'he');
        })
        .map((milestone, index) => ({
            ...milestone,
            order: index + 1,
        }));
}

export function normalizeGanttTask(taskLike, index = 0) {
    const source = isObject(taskLike) ? taskLike : {};
    const fallbackDate = todayDateString();
    const startDate = parseDateValue(source.startDate) || fallbackDate;
    const endDateCandidate = parseDateValue(source.endDate) || startDate;
    const startMs = Date.parse(`${startDate}T00:00:00`);
    const endMs = Date.parse(`${endDateCandidate}T00:00:00`);
    const fallbackColor = GANTT_COLOR_OPTIONS[index % GANTT_COLOR_OPTIONS.length];
    const endDate = endMs >= startMs ? endDateCandidate : startDate;
    const sourceMilestones = Array.isArray(source.milestones) ? source.milestones : [];
    const legacyMilestones = source.milestone === true && sourceMilestones.length === 0
        ? [{ id: `${toId(source.id, `gantt-task-${index + 1}`)}-legacy-milestone`, title: 'אבן דרך', date: endDate }]
        : [];
    const milestones = normalizeGanttMilestones([...sourceMilestones, ...legacyMilestones]);

    const normalizedTask = {
        id: toId(source.id, `gantt-task-${index + 1}`),
        title: toString(source.title, '').trim() || `משימה ${index + 1}`,
        owner: toString(source.owner, '').trim(),
        category: toString(source.category, '').trim() || 'כללי',
        status: normalizeGanttStatus(source.status),
        startDate,
        endDate,
        color: normalizeColor(source.color, fallbackColor),
        details: toString(source.details, '').trim(),
        dependsOn: Array.isArray(source.dependsOn)
            ? source.dependsOn.map((item) => String(item).trim()).filter(Boolean)
            : [],
        milestones,
    };
    const recurrence = normalizeGanttRecurrence(source.recurrence, normalizedTask);
    if (recurrence.enabled) {
        normalizedTask.recurrence = recurrence;
    }

    return {
        ...normalizedTask,
        progress: computeGanttProgress(normalizedTask),
    };
}

export function normalizeGanttCategory(categoryLike, index = 0) {
    const source = isObject(categoryLike) ? categoryLike : {};
    const name = toString(source.name || source.label || source.category, '').trim() || `תחום ${index + 1}`;
    return {
        id: toId(source.id, `gantt-category-${index + 1}`),
        name,
        color: normalizeColor(source.color, GANTT_COLOR_OPTIONS[index % GANTT_COLOR_OPTIONS.length]),
        order: normalizeOrder(source.order, index + 1),
    };
}

function normalizeGanttCategories(categoriesLike, items) {
    const byName = new Map();
    const addCategory = (category, index) => {
        const normalized = normalizeGanttCategory(category, index);
        const key = normalized.name.trim().toLowerCase();
        if (!key || byName.has(key)) return;
        byName.set(key, normalized);
    };

    if (Array.isArray(categoriesLike)) {
        categoriesLike.forEach(addCategory);
    }

    items.forEach((item, index) => {
        const key = item.category.trim().toLowerCase();
        if (!key || byName.has(key)) return;
        byName.set(key, {
            id: `gantt-category-derived-${index + 1}`,
            name: item.category,
            color: item.color || GANTT_COLOR_OPTIONS[index % GANTT_COLOR_OPTIONS.length],
            order: byName.size + 1,
        });
    });

    return [...byName.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'he'));
}

export function normalizeGanttData(dataLike) {
    const source = isObject(dataLike) ? dataLike : {};
    const settingsSource = isObject(source.settings) ? source.settings : {};
    const items = (Array.isArray(source.items) ? source.items : [])
        .map((item, index) => normalizeGanttTask(item, index));
    const pageTitle = toString(source.pageTitle, DEFAULT_GANTT_DATA.pageTitle).trim() || DEFAULT_GANTT_DATA.pageTitle;

    return {
        enabled: source.enabled === true,
        buttonLabel: toString(source.buttonLabel, '').trim() || pageTitle,
        pageTitle,
        description: toString(source.description, '').trim(),
        groupBy: VALID_GROUP_BY.has(source.groupBy) ? source.groupBy : DEFAULT_GANTT_DATA.groupBy,
        defaultView: VALID_VIEW.has(source.defaultView) ? source.defaultView : DEFAULT_GANTT_DATA.defaultView,
        showLegend: source.showLegend !== false,
        showToday: source.showToday !== false,
        settings: {
            ...settingsSource,
            design: normalizeGanttDesignSettings(settingsSource.design),
        },
        categories: normalizeGanttCategories(source.categories, items),
        items,
    };
}

export function cloneGanttData(dataLike) {
    return normalizeGanttData(JSON.parse(JSON.stringify(normalizeGanttData(dataLike))));
}
