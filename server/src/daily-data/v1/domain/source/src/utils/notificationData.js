import { normalizeSmartTextTokens, sanitizeSmartHref, smartTextTokensToPlainText } from './smartText.js';

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const dateText = (value) => {
    const candidate = text(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : '';
};

export function normalizeIdentityKey(value) {
    return text(value).toLowerCase();
}

export function getStableUserIdentity(user) {
    if (!user) return '';
    const sharePointId = Number(user.sharePointUserId ?? user.Id ?? user.id);
    if (Number.isInteger(sharePointId) && sharePointId > 0) return `sp:${sharePointId}`;
    const loginName = normalizeIdentityKey(user.loginName ?? user.LoginName);
    if (loginName) return `login:${loginName}`;
    const email = normalizeIdentityKey(user.email ?? user.Email);
    if (email) return `email:${email}`;
    const personalNumber = text(user.personalNumber).replace(/\D/g, '');
    return personalNumber ? `pn:${personalNumber}` : '';
}

export function getStableUserIdentities(user) {
    if (!user) return [];
    const identities = [];
    const sharePointId = Number(user.sharePointUserId ?? user.Id ?? user.id);
    if (Number.isInteger(sharePointId) && sharePointId > 0) identities.push(`sp:${sharePointId}`);
    const loginName = normalizeIdentityKey(user.loginName ?? user.LoginName);
    if (loginName) identities.push(`login:${loginName}`);
    const email = normalizeIdentityKey(user.email ?? user.Email);
    if (email) identities.push(`email:${email}`);
    const personalNumber = text(user.personalNumber).replace(/\D/g, '');
    if (personalNumber) identities.push(`pn:${personalNumber}`);
    return [...new Set(identities)];
}

export function normalizeNotificationAudience(audienceLike) {
    const source = isObject(audienceLike) ? audienceLike : {};
    const type = source.type === 'users' ? 'users' : 'all';
    if (type === 'all') return { type: 'all', identities: [] };

    const identities = (Array.isArray(source.identities) ? source.identities : [])
        .map(normalizeIdentityKey)
        .filter(Boolean);
    return { type, identities: [...new Set(identities)] };
}

export function normalizeNotification(itemLike, index = 0) {
    const source = isObject(itemLike) ? itemLike : {};
    const richContent = normalizeSmartTextTokens(source.richContent?.tokens ?? source.richContent);
    const richPlainText = smartTextTokensToPlainText(richContent).trim();
    const legacyText = text(source.text);
    const createdAt = text(source.createdAt) || '';
    const updatedAt = text(source.updatedAt) || createdAt;
    const status = source.status === 'draft' ? 'draft' : 'published';
    const startsAt = dateText(source.startsAt ?? source.from);
    const endsAt = dateText(source.endsAt ?? source.to);
    const popupActive = source.popupActive !== undefined
        ? source.popupActive === true
        : source.displayMode === 'popup';
    const displayMode = popupActive ? 'popup' : 'center';

    return {
        id: text(source.id) || `notification-${index + 1}`,
        title: text(source.title),
        text: legacyText || richPlainText,
        richContent,
        isUrgent: source.isUrgent === true,
        popupActive,
        displayMode,
        status,
        startsAt,
        endsAt,
        ctaLabel: text(source.ctaLabel ?? source.cta),
        ctaUrl: sanitizeSmartHref(source.ctaUrl ?? source.url),
        requiresAcknowledgement: source.requiresAcknowledgement === true || source.ack === true,
        audience: normalizeNotificationAudience(source.audience),
        source: text(source.source) || 'admin',
        sourceEntityId: text(source.sourceEntityId),
        eventKey: text(source.eventKey),
        createdAt,
        updatedAt,
    };
}

export function getNotificationEffectiveStatus(notificationLike, today = new Date()) {
    const notification = normalizeNotification(notificationLike);
    if (notification.status === 'draft') return 'draft';
    const date = today instanceof Date ? today : new Date(today);
    const currentDate = Number.isFinite(date.getTime())
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        : '';
    if (notification.startsAt && currentDate && notification.startsAt > currentDate) return 'scheduled';
    if (notification.endsAt && currentDate && notification.endsAt < currentDate) return 'ended';
    return 'published';
}

export function isNotificationCurrentlyVisible(notificationLike, today = new Date()) {
    return getNotificationEffectiveStatus(notificationLike, today) === 'published';
}

export function normalizeNotifications(itemsLike) {
    return (Array.isArray(itemsLike) ? itemsLike : [])
        .filter(isObject)
        .map(normalizeNotification);
}

export function isNotificationForUser(notificationLike, user) {
    const notification = normalizeNotification(notificationLike);
    if (notification.audience.type === 'all') return true;
    const identities = getStableUserIdentities(user);
    return identities.some((identity) => notification.audience.identities.includes(identity));
}

export function filterNotificationsForUser(items, user) {
    return normalizeNotifications(items)
        .filter((item) => isNotificationForUser(item, user))
        .filter((item) => isNotificationCurrentlyVisible(item))
        .sort((left, right) => {
            const leftTime = Date.parse(left.updatedAt || left.createdAt || '') || 0;
            const rightTime = Date.parse(right.updatedAt || right.createdAt || '') || 0;
            return rightTime - leftTime;
        });
}

export function buildBoomAssignmentNotification(task, assignee, now = new Date()) {
    const identityKey = normalizeIdentityKey(assignee?.identityKey || getStableUserIdentity(assignee));
    if (!identityKey || !task?.id) return null;
    const assignmentVersion = Math.max(1, Number(task.assignmentVersion) || 1);
    const eventKey = `boom-assignment:${task.id}:${identityKey}:${assignmentVersion}`;
    const timestamp = now.toISOString();
    const details = [
        `המשימה "${text(task.title)}" הוקצתה לך.`,
        text(task.category) ? `תחום: ${text(task.category)}.` : '',
        text(task.endDate) ? `תאריך יעד: ${text(task.endDate)}.` : '',
    ].filter(Boolean).join(' ');

    return normalizeNotification({
        id: eventKey,
        title: 'משימת BOOM חדשה',
        text: details,
        isUrgent: false,
        popupActive: true,
        displayMode: 'popup',
        status: 'published',
        audience: { type: 'users', identities: [identityKey] },
        source: 'boom-assignment',
        sourceEntityId: task.id,
        eventKey,
        createdAt: timestamp,
        updatedAt: timestamp,
    });
}

export function appendNotificationOnce(items, notification) {
    const current = normalizeNotifications(items);
    if (!notification) return current;
    const eventKey = text(notification.eventKey);
    if (eventKey && current.some((item) => item.eventKey === eventKey)) return current;
    if (current.some((item) => item.id === notification.id)) return current;
    return [...current, normalizeNotification(notification, current.length)];
}

export function getNotificationDismissalStorageKey(siteIdentity, user) {
    const siteKey = normalizeIdentityKey(siteIdentity) || 'default-site';
    const userKey = getStableUserIdentity(user) || 'anonymous';
    return `siteBuilder.notifications.dismissed.v1:${encodeURIComponent(siteKey)}:${encodeURIComponent(userKey)}`;
}
