export const DEFAULT_ACTIVE_WIDGETS = ['events', 'countdown', 'polls'];

export const DEFAULT_WIDGET_SETTINGS = {
  alerts: { itemsPerView: 3, autoScroll: true, intervalMs: 5000 },
  outstanding: { itemsPerView: 1, autoScroll: true, intervalMs: 5000 },
  news: { itemsPerView: 3, autoScroll: true, intervalMs: 5000 },
  phonebook: { itemsPerView: 4, autoScroll: true, intervalMs: 5000 },
  shuttles: { itemsPerView: 3, autoScroll: true, intervalMs: 5000 },
  polls: { itemsPerView: 4, autoScroll: true, intervalMs: 5000 },
  celebrations: { itemsPerView: 1, autoScroll: true, intervalMs: 5000 },
  heritage: { itemsPerView: 1, autoScroll: true, intervalMs: 7000 },
  tips: { itemsPerView: 1, autoScroll: true, intervalMs: 6000 },
};

export function mergeWidgetSettings(rawSettings = {}) {
  const merged = {};
  Object.entries(DEFAULT_WIDGET_SETTINGS).forEach(([key, defaults]) => {
    const candidate = rawSettings?.[key] || {};
    merged[key] = {
      ...defaults,
      ...candidate,
      itemsPerView: Math.max(1, Number(candidate.itemsPerView ?? defaults.itemsPerView) || defaults.itemsPerView),
      autoScroll: candidate.autoScroll ?? defaults.autoScroll,
      intervalMs: Math.max(2000, Number(candidate.intervalMs ?? defaults.intervalMs) || defaults.intervalMs),
    };
  });
  return merged;
}

export function getWidgetSetting(widgetSettings, key) {
  return mergeWidgetSettings(widgetSettings)[key] || { itemsPerView: 1, autoScroll: true, intervalMs: 5000 };
}
