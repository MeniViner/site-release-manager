// src/config/AppSchema.js
import { DEFAULT_BORDER_TARGETS } from '../utils/borderStyles.js';
import { normalizeEventColor } from '../utils/colorValidation.js';
import { normalizeSmartTextTokens } from '../utils/smartText.js';
import { DEFAULT_ACTIVE_WIDGETS } from '../utils/widgetDisplay.js';
import {
    NAVIGATION_MAX_LEVEL,
    getNavigationChildren,
    getNavigationKind,
    getNavigationUrl,
    normalizeNavigationTargetBinding,
} from '../utils/navigationModel.js';
import { normalizeImageGalleryBranch } from '../utils/imageGallery.js';
import { normalizeNotifications } from '../utils/notificationData.js';
import { SITE_BUILDER_DATA_SCHEMA_VERSION } from './siteBuilderContract.js';
import {
    COMMANDER_IMAGE_OFFSET_Y,
    COMMANDER_IMAGE_OFFSET_X,
    COMMANDER_IMAGE_SCALE,
    DEFAULT_COMMANDER_IMAGE_PATH,
    normalizeCommanderImageSettings,
} from '../utils/commanderImage.js';

const SCHEMA_VERSION = SITE_BUILDER_DATA_SCHEMA_VERSION;
const VALID_THEME_DISPLAY_MODES = ['dark', 'light', 'user-toggle'];
const VALID_BORDER_STYLES = ['standard', 'square', 'cyber', 'armor', 'shield', 'blade'];
const VALID_OVERLAY_BORDER_STYLES = ['none', ...VALID_BORDER_STYLES];
const VALID_WIDGET_HEIGHTS = ['full', 'high', 'medium', 'low'];
const VALID_NAV_LAYOUT_MODES = ['sidebar-right', 'grid', 'compact', 'hq'];
const VALID_EXTERNAL_LINK_LAYOUT_MODES = ['cards', 'minimal', 'floating'];
const VALID_EVENT_DISPLAY_MODES = ['default', 'monthly', 'calendar'];
const VALID_ORG_CHART_LAYOUT_DIRECTIONS = ['tree-center', 'step-rtl', 'step-ltr', '3d-graph', 'flow-canvas'];
const VALID_ORG_CHART_CARD_STYLES = ['classic', 'horizontal', 'large-avatar', 'compact'];
const VALID_ORG_CHART_LINE_STYLES = ['solid', 'dashed', 'dotted'];
const VALID_ORG_CHART_AVATAR_SHAPES = ['circle', 'rounded', 'square'];
const VALID_ORG_CHART_3D_LABEL_TYPES = ['all', 'auto', 'none', 'nodes', 'edges'];
const VALID_ORG_CHART_3D_LAYOUT_TYPES = ['forceDirected3d', 'concentric3d', 'treeTd3d', 'treeLr3d', 'radialOut3d'];
const VALID_ORG_CHART_3D_CAMERA_MODES = ['pan', 'rotate', 'orbit', 'orthographic'];
const VALID_ORG_CHART_3D_EDGE_INTERPOLATIONS = ['linear', 'curved'];
const VALID_ORG_CHART_3D_EDGE_ARROW_POSITIONS = ['none', 'mid', 'end'];
const VALID_ORG_CHART_3D_EDGE_LABEL_POSITIONS = ['below', 'above', 'inline', 'natural'];
const VALID_FLOW_EDGE_TYPES = ['default', 'straight', 'step', 'smoothstep', 'simplebezier'];
const VALID_FLOW_BACKGROUND_VARIANTS = ['dots', 'lines', 'cross'];
const VALID_FLOW_CONTROL_ORIENTATION = ['vertical', 'horizontal'];
const VALID_FLOW_VIEWPORT_MODES = ['map', 'design'];
const VALID_FLOW_NODE_VISUAL_STYLES = ['command', 'clean', 'minimal'];
const VALID_FLOW_AUTO_LAYOUT_DIRECTIONS = ['center', 'compact', 'rtl', 'ltr'];
const VALID_OVERLAY_OBJECT_FIT = ['contain', 'cover'];
const VALID_OVERLAY_POSITION_MODES = ['fixed', 'absolute'];
const VALID_OVERLAY_DISPLAY_AREAS = ['fixed-site', 'hero-full', 'hero-content'];
const VALID_OVERLAY_ANCHORS = [
    'top-left',
    'top-center',
    'top-right',
    'middle-left',
    'middle-center',
    'middle-right',
    'bottom-left',
    'bottom-center',
    'bottom-right',
];
const VALID_DECORATIVE_ELEMENTS = ['line-diamond-line', 'dots', 'line', 'double-line'];
const VALID_SHUTTLE_TYPES = ['bus', 'minibus'];
const VALID_WIDGET_IDS = [
    'events',
    'alerts',
    'outstanding',
    'countdown',
    'news',
    'phonebook',
    'shuttles',
    'polls',
    'celebrations',
    'heritage',
    'tips',
];
const VALID_WIDGET_ID_SET = new Set(VALID_WIDGET_IDS);
const HEX_COLOR_RE = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

/**
 * @typedef {Object} OrgNode
 * @property {string} id
 * @property {string} name
 * @property {string} rank
 * @property {string} role
 * @property {string} imageUrl
 * @property {OrgNode[]} children
 */

/**
 * @typedef {Object} OrgChartConfig
 * @property {boolean} enabled
 * @property {string} pageTitle
 * @property {'tree-center' | 'step-rtl' | 'step-ltr' | '3d-graph' | 'flow-canvas'} layoutDirection
 * @property {'classic' | 'horizontal' | 'large-avatar' | 'compact'} cardStyle
 * @property {'solid' | 'dashed' | 'dotted'} lineStyle
 * @property {'circle' | 'rounded' | 'square'} avatarShape
 * @property {{initialExpandLevels:number,linkDistance:number,nodeStrength:number,minDistance:number,maxDistance:number,labelType:'all'|'auto'|'none'|'nodes'|'edges',layoutType:'forceDirected3d'|'concentric3d'|'treeTd3d'|'treeLr3d'|'radialOut3d',cameraMode:'pan'|'rotate'|'orbit'|'orthographic',edgeInterpolation:'linear'|'curved',edgeArrowPosition:'none'|'mid'|'end',edgeLabelPosition:'below'|'above'|'inline'|'natural',draggable:boolean,animated:boolean,aggregateEdges:boolean,defaultNodeSize:number,minNodeSize:number,maxNodeSize:number,minZoom:number,maxZoom:number}} graph3d
 * @property {{edgeType:'default'|'straight'|'step'|'smoothstep'|'simplebezier',edgeAnimated:boolean,edgeOpacityPercent:number,edgeStrokeWidth:number,backgroundVariant:'dots'|'lines'|'cross',backgroundGap:number,backgroundSize:number,showMiniMap:boolean,miniMapPannable:boolean,miniMapZoomable:boolean,showControls:boolean,showControlZoom:boolean,showControlFitView:boolean,showControlInteractive:boolean,controlsOrientation:'vertical'|'horizontal',viewportMode:'map'|'design',panOnScroll:boolean,zoomOnDoubleClick:boolean,snapToGrid:boolean,snapGridX:number,snapGridY:number,fitViewPaddingPercent:number,onlyRenderVisibleElements:boolean,nodeVisualStyle:'command'|'clean'|'minimal',hierarchySizing:boolean,rootScalePercent:number,levelScaleStepPercent:number,minScalePercent:number,showRank:boolean,showRole:boolean,showAvatar:boolean,autoLayoutDirection:'center'|'rtl'|'ltr'}} flowCanvas
 * @property {Record<string, {x:number, y:number}>} nodePositions
 * @property {OrgNode[]} nodes
 */

/**
 * @typedef {Object} ContentConfig
 * @property {object} hero
 * @property {object} commander
 * @property {object} overlayImage
 * @property {OrgChartConfig} orgChart
 */

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
    return isObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isObject(value)) {
        const next = {};
        Object.keys(value).forEach((key) => {
            next[key] = clone(value[key]);
        });
        return next;
    }
    return value;
}

function deepMergeReplaceArrays(baseValue, overrideValue) {
    if (overrideValue === undefined) return clone(baseValue);

    if (Array.isArray(baseValue) || Array.isArray(overrideValue)) {
        return Array.isArray(overrideValue) ? overrideValue.map(clone) : clone(overrideValue);
    }

    if (isObject(baseValue) && isObject(overrideValue)) {
        const result = {};
        const keys = new Set([...Object.keys(baseValue), ...Object.keys(overrideValue)]);
        keys.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(overrideValue, key)) {
                result[key] = deepMergeReplaceArrays(baseValue[key], overrideValue[key]);
            } else {
                result[key] = clone(baseValue[key]);
            }
        });
        return result;
    }

    return clone(overrideValue);
}

function asString(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
}

function asNonEmptyString(value, fallback = '') {
    return typeof value === 'string' && value.trim() ? value : fallback;
}

function asBoolean(value, fallback = false) {
    return typeof value === 'boolean' ? value : fallback;
}

function asEnum(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
}

function asOverlayDisplayArea(value, fallback) {
    const mapped = value === 'site'
        ? 'fixed-site'
        : (value === 'hero' ? 'hero-full' : value);
    return asEnum(mapped, VALID_OVERLAY_DISPLAY_AREAS, fallback);
}

function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
}

function asId(value, fallback) {
    if (value === null || value === undefined) return fallback;
    const normalized = String(value).trim();
    return normalized || fallback;
}

function asStringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function normalizeStringMap(value) {
    const source = isObject(value) ? value : {};
    const normalized = {};

    Object.entries(source).forEach(([key, entryValue]) => {
        const normalizedKey = typeof key === 'string' ? key.trim() : '';
        if (!normalizedKey || typeof entryValue !== 'string') return;
        const normalizedValue = entryValue.trim();
        if (normalizedValue) normalized[normalizedKey] = normalizedValue;
    });

    return normalized;
}

function normalizeActiveWidgets(value) {
    const input = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
    const seen = new Set();
    const normalized = [];

    input.forEach((item) => {
        const id = typeof item === 'string' ? item.trim() : '';
        if (!VALID_WIDGET_ID_SET.has(id) || seen.has(id)) return;
        seen.add(id);
        normalized.push(id);
    });

    return normalized.slice(0, 3);
}

function normalizeNavigationNodes(nodes, prefix = 'nav', level = 1) {
    const source = Array.isArray(nodes) ? nodes : [];
    const normalized = [];

    source.forEach((node, index) => {
        if (!isObject(node)) return;

        const id = asId(node.id, `${prefix}-${index + 1}`);
        const label = asNonEmptyString(node.label, asNonEmptyString(node.title, id));
        // Navigation is capped at exactly three levels, so anything a legacy
        // payload nests below level 3 is dropped instead of persisted.
        const childrenSource = level < NAVIGATION_MAX_LEVEL ? getNavigationChildren(node) : [];
        const url = getNavigationUrl(node);
        const targetBinding = normalizeNavigationTargetBinding(node.targetBinding);

        normalized.push({
            id,
            label,
            kind: getNavigationKind({ ...node, url, children: childrenSource }),
            icon: asString(node.icon, ''),
            iconUrl: asString(node.iconUrl, asString(node.imageUrl, asString(node.image, ''))),
            url,
            ...(targetBinding ? { targetBinding } : {}),
            children: normalizeNavigationNodes(childrenSource, id, level + 1),
        });
    });

    return normalized;
}

function normalizeOrgNode(node, index, prefix = 'org-node') {
    const source = isObject(node) ? node : {};
    const id = asId(source.id, `${prefix}-${index + 1}`);

    return {
        id,
        name: asString(source.name, ''),
        rank: asString(source.rank, ''),
        role: asString(source.role, ''),
        personalNumber: asString(source.personalNumber, ''),
        imageUrl: asString(source.imageUrl, asString(source.image, '')),
        children: normalizeOrgNodes(source.children, id),
    };
}

function normalizeOrgNodes(nodes, prefix = 'org-node') {
    const source = Array.isArray(nodes) ? nodes : [];

    return source
        .filter(isObject)
        .map((node, index) => normalizeOrgNode(node, index, prefix));
}

function normalizeNodePositions(nodePositionsLike) {
    const source = isObject(nodePositionsLike) ? nodePositionsLike : {};
    const normalized = {};

    Object.entries(source).forEach(([nodeId, coordinates]) => {
        const id = typeof nodeId === 'string' ? nodeId.trim() : '';
        if (!id || !isObject(coordinates)) return;

        const x = Number(coordinates.x);
        const y = Number(coordinates.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;

        normalized[id] = {
            x: Math.round(x),
            y: Math.round(y),
        };
    });

    return normalized;
}

function normalizeOrgChart3D(graph3dLike, fallback) {
    const source = isObject(graph3dLike) ? graph3dLike : {};
    const defaults = isObject(fallback) ? fallback : DEFAULT_CONFIG_V1.content.orgChart.graph3d;
    const minDistance = clampNumber(source.minDistance, 80, 4000, defaults.minDistance);
    const maxDistanceCandidate = clampNumber(source.maxDistance, 1200, 30000, defaults.maxDistance);
    const minNodeSize = clampNumber(source.minNodeSize, 2, 24, defaults.minNodeSize);
    const maxNodeSizeCandidate = clampNumber(source.maxNodeSize, 4, 48, defaults.maxNodeSize);
    const minZoom = clampNumber(source.minZoom, 1, 40, defaults.minZoom);
    const maxZoomCandidate = clampNumber(source.maxZoom, 4, 240, defaults.maxZoom);

    return {
        initialExpandLevels: clampNumber(source.initialExpandLevels, 1, 2, defaults.initialExpandLevels),
        linkDistance: clampNumber(source.linkDistance, 80, 420, defaults.linkDistance),
        nodeStrength: clampNumber(source.nodeStrength, -700, -40, defaults.nodeStrength),
        minDistance,
        maxDistance: Math.max(maxDistanceCandidate, minDistance + 200),
        labelType: asEnum(source.labelType, VALID_ORG_CHART_3D_LABEL_TYPES, defaults.labelType),
        layoutType: asEnum(source.layoutType, VALID_ORG_CHART_3D_LAYOUT_TYPES, defaults.layoutType),
        cameraMode: asEnum(source.cameraMode, VALID_ORG_CHART_3D_CAMERA_MODES, defaults.cameraMode),
        edgeInterpolation: asEnum(
            source.edgeInterpolation,
            VALID_ORG_CHART_3D_EDGE_INTERPOLATIONS,
            defaults.edgeInterpolation
        ),
        edgeArrowPosition: asEnum(
            source.edgeArrowPosition,
            VALID_ORG_CHART_3D_EDGE_ARROW_POSITIONS,
            defaults.edgeArrowPosition
        ),
        edgeLabelPosition: asEnum(
            source.edgeLabelPosition,
            VALID_ORG_CHART_3D_EDGE_LABEL_POSITIONS,
            defaults.edgeLabelPosition
        ),
        draggable: asBoolean(source.draggable, defaults.draggable),
        animated: asBoolean(source.animated, defaults.animated),
        aggregateEdges: asBoolean(source.aggregateEdges, defaults.aggregateEdges),
        defaultNodeSize: clampNumber(source.defaultNodeSize, 4, 28, defaults.defaultNodeSize),
        minNodeSize,
        maxNodeSize: Math.max(maxNodeSizeCandidate, minNodeSize + 1),
        minZoom,
        maxZoom: Math.max(maxZoomCandidate, minZoom + 1),
    };
}

function normalizeFlowCanvas(flowCanvasLike, fallback) {
    const source = isObject(flowCanvasLike) ? flowCanvasLike : {};
    const defaults = {
        ...DEFAULT_CONFIG_V1.content.orgChart.flowCanvas,
        ...(isObject(fallback) ? fallback : {}),
    };

    return {
        edgeType: asEnum(source.edgeType, VALID_FLOW_EDGE_TYPES, defaults.edgeType),
        edgeAnimated: asBoolean(source.edgeAnimated, defaults.edgeAnimated),
        edgeOpacityPercent: clampNumber(source.edgeOpacityPercent, 20, 100, defaults.edgeOpacityPercent),
        edgeStrokeWidth: clampNumber(source.edgeStrokeWidth, 1, 6, defaults.edgeStrokeWidth),
        backgroundVariant: asEnum(source.backgroundVariant, VALID_FLOW_BACKGROUND_VARIANTS, defaults.backgroundVariant),
        backgroundGap: clampNumber(source.backgroundGap, 8, 120, defaults.backgroundGap),
        backgroundSize: clampNumber(source.backgroundSize, 1, 18, defaults.backgroundSize),
        showMiniMap: asBoolean(source.showMiniMap, defaults.showMiniMap),
        miniMapPannable: asBoolean(source.miniMapPannable, defaults.miniMapPannable),
        miniMapZoomable: asBoolean(source.miniMapZoomable, defaults.miniMapZoomable),
        showControls: asBoolean(source.showControls, defaults.showControls),
        showControlZoom: asBoolean(source.showControlZoom, defaults.showControlZoom),
        showControlFitView: asBoolean(source.showControlFitView, defaults.showControlFitView),
        showControlInteractive: asBoolean(source.showControlInteractive, defaults.showControlInteractive),
        controlsOrientation: asEnum(source.controlsOrientation, VALID_FLOW_CONTROL_ORIENTATION, defaults.controlsOrientation),
        viewportMode: asEnum(source.viewportMode, VALID_FLOW_VIEWPORT_MODES, defaults.viewportMode),
        panOnScroll: asBoolean(source.panOnScroll, defaults.panOnScroll),
        zoomOnDoubleClick: asBoolean(source.zoomOnDoubleClick, defaults.zoomOnDoubleClick),
        snapToGrid: asBoolean(source.snapToGrid, defaults.snapToGrid),
        snapGridX: clampNumber(source.snapGridX, 8, 160, defaults.snapGridX),
        snapGridY: clampNumber(source.snapGridY, 8, 160, defaults.snapGridY),
        fitViewPaddingPercent: clampNumber(source.fitViewPaddingPercent, 5, 80, defaults.fitViewPaddingPercent),
        onlyRenderVisibleElements: asBoolean(source.onlyRenderVisibleElements, defaults.onlyRenderVisibleElements),
        nodeVisualStyle: asEnum(source.nodeVisualStyle, VALID_FLOW_NODE_VISUAL_STYLES, defaults.nodeVisualStyle),
        hierarchySizing: asBoolean(source.hierarchySizing, defaults.hierarchySizing),
        rootScalePercent: clampNumber(source.rootScalePercent, 100, 150, defaults.rootScalePercent),
        levelScaleStepPercent: clampNumber(source.levelScaleStepPercent, 0, 20, defaults.levelScaleStepPercent),
        minScalePercent: clampNumber(source.minScalePercent, 70, 100, defaults.minScalePercent),
        showRank: asBoolean(source.showRank, defaults.showRank),
        showRole: asBoolean(source.showRole, defaults.showRole),
        showAvatar: asBoolean(source.showAvatar, defaults.showAvatar),
        autoLayoutDirection: asEnum(
            source.autoLayoutDirection,
            VALID_FLOW_AUTO_LAYOUT_DIRECTIONS,
            defaults.autoLayoutDirection
        ),
    };
}

function normalizeOrgChart(orgChartLike) {
    const source = isObject(orgChartLike) ? orgChartLike : {};
    const defaults = DEFAULT_CONFIG_V1.content.orgChart;
    const legacyLayoutDirectionMap = {
        'classic-tree': 'tree-center',
        'modern-cards': 'tree-center',
        'compact-list': 'step-rtl',
    };
    const legacyCardStyleMap = {
        'theme-solid': 'classic',
        'theme-outline': 'horizontal',
        'theme-glass': 'large-avatar',
        'classic-tree': 'classic',
        'modern-cards': 'horizontal',
        'compact-list': 'compact',
    };
    const resolvedLayoutDirection = source.layoutDirection || legacyLayoutDirectionMap[source.displayMode];
    const resolvedCardStyle = source.cardStyle || legacyCardStyleMap[source.displayMode];

    return {
        enabled: asBoolean(source.enabled, defaults.enabled),
        pageTitle: asString(source.pageTitle, defaults.pageTitle),
        layoutDirection: asEnum(
            resolvedLayoutDirection,
            VALID_ORG_CHART_LAYOUT_DIRECTIONS,
            defaults.layoutDirection
        ),
        cardStyle: asEnum(resolvedCardStyle, VALID_ORG_CHART_CARD_STYLES, defaults.cardStyle),
        lineStyle: asEnum(source.lineStyle, VALID_ORG_CHART_LINE_STYLES, defaults.lineStyle),
        avatarShape: asEnum(source.avatarShape, VALID_ORG_CHART_AVATAR_SHAPES, defaults.avatarShape),
        graph3d: normalizeOrgChart3D(source.graph3d, defaults.graph3d),
        flowCanvas: normalizeFlowCanvas(source.flowCanvas, defaults.flowCanvas),
        nodePositions: normalizeNodePositions(source.nodePositions),
        nodes: normalizeOrgNodes(source.nodes),
    };
}

function normalizeOverlayImage(overlay) {
    const source = isObject(overlay) ? overlay : {};
    const defaults = DEFAULT_CONFIG_V1.content.overlayImage;

    return {
        enabled: asBoolean(source.enabled, defaults.enabled),
        imageUrl: asString(source.imageUrl, defaults.imageUrl),
        width: clampNumber(source.width, 48, 1800, defaults.width),
        height: clampNumber(source.height, 48, 1800, defaults.height),
        opacity: clampNumber(source.opacity, 0, 100, defaults.opacity),
        objectFit: asEnum(source.objectFit, VALID_OVERLAY_OBJECT_FIT, defaults.objectFit),
        borderStyle: asEnum(source.borderStyle, VALID_OVERLAY_BORDER_STYLES, defaults.borderStyle),
        positionMode: asEnum(source.positionMode, VALID_OVERLAY_POSITION_MODES, defaults.positionMode),
        displayArea: asOverlayDisplayArea(source.displayArea, defaults.displayArea),
        anchor: asEnum(source.anchor, VALID_OVERLAY_ANCHORS, defaults.anchor),
        offsetX: clampNumber(source.offsetX, -2400, 2400, defaults.offsetX),
        offsetY: clampNumber(source.offsetY, -2400, 2400, defaults.offsetY),
        zIndex: clampNumber(source.zIndex, 1, 9999, defaults.zIndex),
        blendEffect: asBoolean(source.blendEffect, defaults.blendEffect),
    };
}

function normalizeMessages(messages) {
    const source = Array.isArray(messages) ? messages : [];
    return source
        .filter(isObject)
        .map((item, index) => ({
            id: asId(item.id, String(index + 1)),
            text: asString(item.text, ''),
            signature: asString(item.signature, ''),
        }));
}

function normalizeEventItems(items) {
    const source = Array.isArray(items) ? items : [];
    return source
        .filter(isObject)
        .map((item, index) => {
            const linkLabels = normalizeStringMap(item.linkLabels);
            const subtitleRichText = normalizeSmartTextTokens(item.subtitleRichText, linkLabels);
            const normalized = {
                id: asId(item.id, String(index + 1)),
                date: asString(item.date, ''),
                title: asString(item.title, ''),
                subtitle: asString(item.subtitle, ''),
                linkLabels,
                color: normalizeEventColor(item.color, 'gray'),
            };
            if (subtitleRichText.length) normalized.subtitleRichText = subtitleRichText;
            return normalized;
        });
}

function normalizeEventsBranch(eventsLike) {
    let source = eventsLike;
    if (Array.isArray(source)) {
        source = { items: source };
    }
    if (!isObject(source)) {
        source = {};
    }

    const items = normalizeEventItems(Array.isArray(source.items) ? source.items : source.events);

    return {
        displayCount: clampNumber(source.displayCount, 1, 12, DEFAULT_CONFIG_V1.widgets.data.events.displayCount),
        displayMode: asEnum(source.displayMode, VALID_EVENT_DISPLAY_MODES, DEFAULT_CONFIG_V1.widgets.data.events.displayMode),
        intervalMs: clampNumber(source.intervalMs, 2000, 120000, DEFAULT_CONFIG_V1.widgets.data.events.intervalMs),
        items,
    };
}

function normalizeCountdownItem(item, index, fallbackIdPrefix = 'countdown') {
    const normalizedId = asId(item?.id, `${fallbackIdPrefix}-${index + 1}`);
    return {
        id: normalizedId,
        title: asString(item?.title, ''),
        targetDate: asString(item?.targetDate, ''),
        showDetails: asBoolean(item?.showDetails, false),
        details: asString(item?.details, ''),
    };
}

function normalizeCountdownBranch(countdownLike) {
    const source = isObject(countdownLike) ? countdownLike : {};
    const sourceItems = Array.isArray(source.items)
        ? source.items.filter(isObject)
        : [];

    const fallbackLegacyItem = (source.title || source.targetDate || source.details)
        ? [{
            id: 'countdown-1',
            title: asString(source.title, ''),
            targetDate: asString(source.targetDate, ''),
            showDetails: asBoolean(source.showDetails, false),
            details: asString(source.details, ''),
        }]
        : [];

    const normalizedItems = (sourceItems.length > 0 ? sourceItems : fallbackLegacyItem)
        .map((item, index) => normalizeCountdownItem(item, index));

    const ids = new Set(normalizedItems.map((item) => item.id));
    let activeItemId = asString(source.activeItemId, '');
    if (!activeItemId || !ids.has(activeItemId)) {
        activeItemId = normalizedItems[0]?.id || null;
    }

    const activeItem = normalizedItems.find((item) => item.id === activeItemId) || null;

    return {
        title: activeItem?.title ?? '',
        targetDate: activeItem?.targetDate ?? '',
        showDetails: activeItem?.showDetails ?? false,
        details: activeItem?.details ?? '',
        switchIntervalSeconds: clampNumber(source.switchIntervalSeconds, 3, 30, 8),
        activeItemId,
        items: normalizedItems,
    };
}

function normalizeSimpleItems(items, mapFn) {
    const source = Array.isArray(items) ? items : [];
    return source.filter(isObject).map(mapFn);
}

function normalizePollVoters(votersLike, optionId) {
    const source = Array.isArray(votersLike) ? votersLike : [];

    return source
        .filter((voter) => typeof voter === 'string' || isObject(voter))
        .map((voter, index) => ({
            id: asId(
                typeof voter === 'string' ? '' : voter?.id,
                `${optionId}-voter-${index + 1}`
            ),
            name: asString(
                typeof voter === 'string' ? voter : (voter?.name ?? voter?.displayName),
                ''
            ),
            email: asString(typeof voter === 'string' ? '' : voter?.email, ''),
            loginName: asString(typeof voter === 'string' ? '' : voter?.loginName, ''),
            personalNumber: asString(typeof voter === 'string' ? '' : voter?.personalNumber, ''),
            votedAt: asString(typeof voter === 'string' ? '' : voter?.votedAt, ''),
        }))
        .filter((voter) => (
            voter.name
            || voter.email
            || voter.loginName
            || voter.personalNumber
        ));
}

function normalizePollsBranch(pollsLike) {
    let source = pollsLike;
    if (Array.isArray(source)) {
        source = { items: source };
    }
    if (!isObject(source)) {
        source = {};
    }

    const sourceItems = Array.isArray(source.items) ? source.items : [];
    const activeFromFlag = sourceItems.find((item) => isObject(item) && item.active === true && item.id !== undefined);

    const items = sourceItems
        .filter(isObject)
        .map((item, index) => {
            const id = asId(item.id, String(index + 1));
            return {
                id,
                question: asString(item.question, ''),
                options: normalizeSimpleItems(item.options, (option, optionIndex) => ({
                    id: asId(option.id, `${id}-opt-${optionIndex + 1}`),
                    text: asString(option.text, ''),
                    votes: clampNumber(option.votes, 0, 1000000, 0),
                    voters: normalizePollVoters(option.voters, `${id}-opt-${optionIndex + 1}`),
                })),
            };
        });

    let activePollId = typeof source.activePollId === 'string' ? source.activePollId : null;
    if (!activePollId && activeFromFlag) activePollId = String(activeFromFlag.id);

    const validIds = new Set(items.map((poll) => poll.id));
    if (!activePollId || !validIds.has(activePollId)) activePollId = null;

    return { activePollId, items };
}

function normalizeExternalLinksItems(items) {
    const source = Array.isArray(items) ? items : [];
    return source
        .filter(isObject)
        .map((item, index) => {
            const visual = (() => {
                if (isObject(item.visual)) {
                    if (item.visual.type === 'none') return { type: 'none' };
                    if (item.visual.type === 'icon' && asNonEmptyString(item.visual.icon)) {
                        return { type: 'icon', icon: item.visual.icon };
                    }
                    if (item.visual.type === 'image' && asNonEmptyString(item.visual.imageUrl)) {
                        return { type: 'image', imageUrl: item.visual.imageUrl };
                    }
                }

                const legacyImage = asNonEmptyString(item.iconUrl, asNonEmptyString(item.image, ''));
                if (legacyImage) return { type: 'image', imageUrl: legacyImage };

                const legacyIcon = asNonEmptyString(item.icon, '');
                if (legacyIcon) return { type: 'icon', icon: legacyIcon };

                return { type: 'none' };
            })();

            return {
                id: asId(item.id, String(index + 1)),
                title: asString(item.title, ''),
                url: asString(item.url, ''),
                visual,
                order: clampNumber(item.order, 0, 1000000, index),
            };
        });
}

function normalizeAdminUsers(users) {
    const source = Array.isArray(users) ? users : [];
    return source
        .filter(isObject)
        .map((item, index) => ({
            id: asId(item.id, String(index + 1)),
            name: asString(item.name, ''),
            role: asString(item.role, 'admin'),
        }))
        .filter((item) => item.name.trim().length > 0);
}

function normalizeBorderTargets(value) {
    const source = isObject(value) ? value : {};
    const defaults = DEFAULT_CONFIG_V1.theme.borderTargets;

    return {
        commander: asBoolean(source.commander, defaults.commander),
        widget: asBoolean(source.widget, defaults.widget),
        search: asBoolean(source.search, defaults.search),
        topNav: asBoolean(source.topNav, defaults.topNav),
        sideNav: asBoolean(source.sideNav, defaults.sideNav),
        flipCards: asBoolean(source.flipCards, defaults.flipCards),
        extLinks: asBoolean(source.extLinks, defaults.extLinks),
        hqDash: asBoolean(source.hqDash, defaults.hqDash),
    };
}

function normalizeWidgetDisplaySettings(displaySettings, defaults) {
    const source = isObject(displaySettings) ? displaySettings : {};
    return {
        itemsPerView: clampNumber(source.itemsPerView, 1, 99, defaults.itemsPerView),
        autoScroll: asBoolean(source.autoScroll, defaults.autoScroll),
        intervalMs: clampNumber(source.intervalMs, 1000, 120000, defaults.intervalMs),
    };
}

function normalizeWidgetDisplay(display) {
    const source = isObject(display) ? display : {};
    const defaults = DEFAULT_CONFIG_V1.widgets.display;
    const next = {};

    Object.keys(defaults).forEach((key) => {
        next[key] = normalizeWidgetDisplaySettings(source[key], defaults[key]);
    });

    return next;
}

function resolveWidgetDataBranch(widgets, key) {
    if (!isObject(widgets)) return undefined;
    if (isObject(widgets.data) && Object.prototype.hasOwnProperty.call(widgets.data, key)) {
        return widgets.data[key];
    }
    return widgets[key];
}
export const DEFAULT_CONFIG_V1 = {
    schemaVersion: SCHEMA_VERSION,
    meta: {
        appId: 'siteBuilder',
        migratedFromLegacy: false,
        lastUpdatedAt: null,
        lastUpdatedBy: null,
    },
    theme: {
        primaryColor: '#0891b2',
        displayMode: 'user-toggle',
        borderStyle: 'cyber',
        borderTargets: {
            ...DEFAULT_BORDER_TARGETS,
        },
        backgrounds: {
            tinted: {
                enabled: true,
                strength: 72,
            },
            hero: {
                grayscale: false,
                glassEffect: false,
                glassStrength: 58,
            },
            navbar: {
                glassEffect: true,
                glassStrength: 1,
            },
        },
    },
    layout: {
        navigation: {
            showCategories: false,
            mode: 'sidebar-right',
        },
        hero: {
            widgetHeight: 'full',
            panelsBordered: true,
            commanderPanelBordered: false,
            widgetPanelBordered: true,
        },
        externalLinks: {
            mode: 'cards',
            fixed: false,
            bordered: true,
            showBackground: true,
        },
    },
    navigation: {
        items: [
            {
                id: 'training',
                label: 'הכשרות',
                icon: 'GraduationCap',
                url: '',
                children: [
                    {
                        id: 'training-courses',
                        label: 'לוחות הכשרה',
                        icon: 'CalendarDays',
                        url: '',
                        children: [
                            {
                                id: 'training-courses-trainees',
                                label: 'חניכי הקורס',
                                icon: 'Users',
                                url: '#',
                                children: [],
                            },
                            {
                                id: 'training-courses-gantt',
                                label: 'גאנט הקורס',
                                icon: 'Calendar',
                                url: '#',
                                children: [],
                            },
                            {
                                id: 'training-courses-drills',
                                label: 'אימונים',
                                icon: 'Target',
                                url: '#',
                                children: [],
                            },
                        ],
                    },
                    {
                        id: 'training-materials',
                        label: 'חומרי לימוד',
                        icon: 'BookOpen',
                        url: '',
                        children: [
                            {
                                id: 'training-materials-lessons',
                                label: 'מערכי שיעור',
                                icon: 'FileText',
                                url: '#',
                                children: [],
                            },
                            {
                                id: 'training-materials-tests',
                                label: 'מבחנים וסיכומים',
                                icon: 'ClipboardList',
                                url: '#',
                                children: [],
                            },
                        ],
                    },
                    {
                        id: 'training-staff',
                        label: 'סגל הכשרה',
                        icon: 'Users',
                        url: '',
                        children: [
                            {
                                id: 'training-staff-commanders',
                                label: 'מפקדי קורסים',
                                icon: 'User',
                                url: '#',
                                children: [],
                            },
                            {
                                id: 'training-staff-instructors',
                                label: 'מדריכים',
                                icon: 'Users',
                                url: '#',
                                children: [],
                            },
                        ],
                    },
                ],
            },
            {
                id: 'ops',
                label: 'אג"ם',
                icon: 'ShieldCheck',
                url: '',
                children: [
                    {
                        id: 'ops-orders',
                        label: 'פקודות ועדכונים',
                        icon: 'ClipboardList',
                        url: '',
                        children: [
                            {
                                id: 'ops-orders-daily',
                                label: 'פקודות יומיות',
                                icon: 'FileText',
                                url: '#',
                                children: [],
                            },
                            {
                                id: 'ops-orders-weekly',
                                label: 'הנחיות שבועיות',
                                icon: 'Calendar',
                                url: '#',
                                children: [],
                            },
                        ],
                    },
                    {
                        id: 'ops-readiness',
                        label: 'כשירות מבצעית',
                        icon: 'Target',
                        url: '',
                        children: [
                            {
                                id: 'ops-readiness-trainings',
                                label: 'כשירות צוותים',
                                icon: 'Users',
                                url: '#',
                                children: [],
                            },
                            {
                                id: 'ops-readiness-drills',
                                label: 'תרגולות חודשיות',
                                icon: 'Target',
                                url: '#',
                                children: [],
                            },
                        ],
                    },
                    {
                        id: 'ops-briefings',
                        label: 'תדריכים מבצעיים',
                        icon: 'FileText',
                        url: '',
                        children: [
                            {
                                id: 'ops-briefings-morning',
                                label: 'תדריך בוקר',
                                icon: 'CalendarDays',
                                url: '#',
                                children: [],
                            },
                            {
                                id: 'ops-briefings-special',
                                label: 'תדריכים מיוחדים',
                                icon: 'AlertTriangle',
                                url: '#',
                                children: [],
                            },
                        ],
                    },
                ],
            },
            {
                id: 'hq',
                label: 'מפקדה',
                icon: 'Building2',
                url: '',
                children: [
                    {
                        id: 'hq-hr',
                        label: 'כח אדם',
                        icon: 'Users',
                        url: '',
                        children: [
                            {
                                id: 'hq-hr-leave',
                                label: 'טפסי חופשה',
                                icon: 'FileText',
                                url: '#',
                                children: [],
                            },
                            {
                                id: 'hq-hr-contacts',
                                label: 'אנשי קשר',
                                icon: 'Users',
                                url: '#',
                                children: [],
                            },
                        ],
                    },
                    {
                        id: 'hq-logistics',
                        label: 'לוגיסטיקה',
                        icon: 'Package',
                        url: '',
                        children: [
                            {
                                id: 'hq-logistics-inventory',
                                label: 'מלאי וציוד',
                                icon: 'Package',
                                url: '#',
                                children: [],
                            },
                            {
                                id: 'hq-logistics-transports',
                                label: 'שינוע והסעות',
                                icon: 'Truck',
                                url: '#',
                                children: [],
                            },
                        ],
                    },
                    {
                        id: 'hq-admin',
                        label: 'מנהלה',
                        icon: 'Briefcase',
                        url: '',
                        children: [
                            {
                                id: 'hq-admin-forms',
                                label: 'טפסים מנהלתיים',
                                icon: 'FileText',
                                url: '#',
                                children: [],
                            },
                            {
                                id: 'hq-admin-procedures',
                                label: 'נהלים',
                                icon: 'ClipboardList',
                                url: '#',
                                children: [],
                            },
                        ],
                    },
                ],
            },
            {
                id: 'unit-graph',
                label: 'גרף יחידה',
                icon: 'BarChart',
                url: '',
                children: [
                    {
                        id: 'unit-graph-org',
                        label: 'מבנה ארגוני',
                        icon: 'BarChart',
                        url: '',
                        children: [
                            {
                                id: 'unit-graph-org-command',
                                label: 'דרג פיקודי',
                                icon: 'Users',
                                url: '#',
                                children: [],
                            },
                            {
                                id: 'unit-graph-org-sections',
                                label: 'מדורים וצוותים',
                                icon: 'Folder',
                                url: '#',
                                children: [],
                            },
                        ],
                    },
                    {
                        id: 'unit-graph-kpis',
                        label: 'מדדי ביצוע',
                        icon: 'Target',
                        url: '',
                        children: [
                            {
                                id: 'unit-graph-kpis-training',
                                label: 'מדדי הכשרה',
                                icon: 'GraduationCap',
                                url: '#',
                                children: [],
                            },
                            {
                                id: 'unit-graph-kpis-readiness',
                                label: 'מדדי כשירות',
                                icon: 'ShieldCheck',
                                url: '#',
                                children: [],
                            },
                        ],
                    },
                ],
            },
            {
                id: 'core-files',
                label: 'תיקי יסוד',
                icon: 'Briefcase',
                url: '',
                children: [
                    {
                        id: 'core-files-procedures',
                        label: 'פקודות ונהלים',
                        icon: 'FileText',
                        url: '',
                        children: [
                            {
                                id: 'core-files-procedures-safety',
                                label: 'נהלי בטיחות',
                                icon: 'AlertTriangle',
                                url: '#',
                                children: [],
                            },
                            {
                                id: 'core-files-procedures-routine',
                                label: 'נהלי שגרה',
                                icon: 'ClipboardList',
                                url: '#',
                                children: [],
                            },
                        ],
                    },
                    {
                        id: 'core-files-knowledge',
                        label: 'מאגר ידע',
                        icon: 'BookOpen',
                        url: '',
                        children: [
                            {
                                id: 'core-files-knowledge-lessons',
                                label: 'לקחים',
                                icon: 'FileText',
                                url: '#',
                                children: [],
                            },
                            {
                                id: 'core-files-knowledge-templates',
                                label: 'תבניות',
                                icon: 'Folder',
                                url: '#',
                                children: [],
                            },
                        ],
                    },
                ],
            },
            {
                id: 'safety',
                label: 'בטיחות',
                icon: 'AlertTriangle',
                url: '',
                children: [
                    {
                        id: 'safety-routines',
                        label: 'נהלי בטיחות',
                        icon: 'ShieldCheck',
                        url: '',
                        children: [
                            {
                                id: 'safety-routines-base',
                                label: 'בטיחות שגרה',
                                icon: 'FileText',
                                url: '#',
                                children: [],
                            },
                            {
                                id: 'safety-routines-training',
                                label: 'בטיחות באימון',
                                icon: 'Target',
                                url: '#',
                                children: [],
                            },
                        ],
                    },
                    {
                        id: 'safety-emergency',
                        label: 'חירום וחילוץ',
                        icon: 'AlertTriangle',
                        url: '',
                        children: [
                            {
                                id: 'safety-emergency-contacts',
                                label: 'אנשי קשר לחירום',
                                icon: 'Users',
                                url: '#',
                                children: [],
                            },
                            {
                                id: 'safety-emergency-protocols',
                                label: 'נוהלי פינוי',
                                icon: 'FileText',
                                url: '#',
                                children: [],
                            },
                        ],
                    },
                ],
            },
        ],
    },
    content: {
        hero: {
            siteName: 'מתנ"ה',
            title: '  מתנ"ה  \n בונה האתרים  ',
            subtitle: 'מערכת תבניות לניהול הידע',
            logoUrl: '/images/gift.svg',
            description: 'מרכז הפיתוח המוביל בצה"ל לפיתוח מערכות מבצעיות, טכנולוגיות ופיקודיות.',
            backgroundImageUrls: [
                '/images/לח4.webp',
                '/images/לח3.jpg',
                '/images/לח6.webp',
                '/images/idf-tank_enhanced.png',
                '/images/IDFsoldiers.jpeg',
            ],
        },
        commander: {
            imageUrl: DEFAULT_COMMANDER_IMAGE_PATH,
            imageSource: 'default',
            imageAvatar: '',
            customImageUrl: '',
            imageScale: COMMANDER_IMAGE_SCALE.defaultValue,
            imageOffsetX: COMMANDER_IMAGE_OFFSET_X.defaultValue,
            imageOffsetY: COMMANDER_IMAGE_OFFSET_Y.defaultValue,
            sectionTitle: 'דבר המפקד',
            roleLabel: 'מפקד צוות אלפא ',
            decorativeElement: 'line-diamond-line',
            messages: [
                {
                    id: '1',
                    text: 'בית הספר הוא לב המצוינות המבצעית והטכנולוגית שלנו. נמשיך לפתח דור מפקדים מקצועי, ערכי ויוזם.',
                    signature: 'אל"ם א׳ | מפקד בה״ס צוות אלפא',
                },
                {
                    id: '2',
                    text: 'ההון האנושי הוא הכוח המרכזי שלנו. שמרו על חתירה למצוינות, למידה מתמדת ורוח צוות.',
                    signature: 'אל"ם א׳ | מפקד בה״ס צוות אלפא',
                },
            ],
        },
        overlayImage: {
            enabled: false,
            imageUrl: '',
            width: 240,
            height: 180,
            opacity: 100,
            objectFit: 'contain',
            borderStyle: 'standard',
            positionMode: 'fixed',
            displayArea: 'fixed-site',
            anchor: 'bottom-left',
            offsetX: 28,
            offsetY: -28,
            zIndex: 180,
            blendEffect: true,
        },
        orgChart: {
            enabled: false,
            pageTitle: 'עץ מבנה יחידתי',
            layoutDirection: 'flow-canvas',
            cardStyle: 'classic',
            lineStyle: 'solid',
            avatarShape: 'circle',
            graph3d: {
                initialExpandLevels: 1,
                linkDistance: 180,
                nodeStrength: -220,
                minDistance: 160,
                maxDistance: 12000,
                labelType: 'all',
                layoutType: 'forceDirected3d',
                cameraMode: 'rotate',
                edgeInterpolation: 'curved',
                edgeArrowPosition: 'end',
                edgeLabelPosition: 'natural',
                draggable: false,
                animated: true,
                aggregateEdges: false,
                defaultNodeSize: 9,
                minNodeSize: 6,
                maxNodeSize: 18,
                minZoom: 1,
                maxZoom: 100,
            },
            flowCanvas: {
                edgeType: 'smoothstep',
                edgeAnimated: true,
                edgeOpacityPercent: 88,
                edgeStrokeWidth: 2,
                backgroundVariant: 'dots',
                backgroundGap: 18,
                backgroundSize: 1,
                showMiniMap: true,
                miniMapPannable: true,
                miniMapZoomable: false,
                showControls: true,
                showControlZoom: true,
                showControlFitView: true,
                showControlInteractive: false,
                controlsOrientation: 'vertical',
                viewportMode: 'map',
                panOnScroll: false,
                zoomOnDoubleClick: true,
                snapToGrid: false,
                snapGridX: 20,
                snapGridY: 20,
                fitViewPaddingPercent: 24,
                onlyRenderVisibleElements: false,
                nodeVisualStyle: 'command',
                hierarchySizing: true,
                rootScalePercent: 112,
                levelScaleStepPercent: 6,
                minScalePercent: 84,
                showRank: true,
                showRole: true,
                showAvatar: true,
                autoLayoutDirection: 'center',
            },
            nodePositions: {},
            nodes: [
                {
                    id: 'org-root-hq',
                    name: 'מפקדת בית הספר',
                    rank: 'אל"ם',
                    role: 'מפקדת היחידה',
                    imageUrl: '',
                    children: [
                        {
                            id: 'org-root-hq-training',
                            name: 'מדור הכשרות',
                            rank: 'רס"ן',
                            role: 'הובלת תוכניות הכשרה',
                            imageUrl: '',
                            children: [],
                        },
                        {
                            id: 'org-root-hq-ops',
                            name: 'מדור אג"ם',
                            rank: 'רס"ן',
                            role: 'תכנון ובקרה מבצעית',
                            imageUrl: '',
                            children: [],
                        },
                        {
                            id: 'org-root-hq-logistics',
                            name: 'מדור לוגיסטיקה',
                            rank: 'רס"ן',
                            role: 'ציוד, שינוע ותמיכה',
                            imageUrl: '',
                            children: [],
                        },
                    ],
                },
            ],
        },
    },
    widgets: {
        active: [...DEFAULT_ACTIVE_WIDGETS],
        carousel: {
            rotationIntervalSeconds: 8,
        },
        display: {
            alerts: { itemsPerView: 3, autoScroll: true, intervalMs: 5000 },
            outstanding: { itemsPerView: 1, autoScroll: true, intervalMs: 5000 },
            news: { itemsPerView: 3, autoScroll: true, intervalMs: 5000 },
            phonebook: { itemsPerView: 4, autoScroll: true, intervalMs: 5000 },
            shuttles: { itemsPerView: 3, autoScroll: true, intervalMs: 5000 },
            polls: { itemsPerView: 4, autoScroll: true, intervalMs: 5000 },
            celebrations: { itemsPerView: 1, autoScroll: true, intervalMs: 5000 },
            heritage: { itemsPerView: 1, autoScroll: true, intervalMs: 7000 },
            tips: { itemsPerView: 1, autoScroll: true, intervalMs: 6000 },
        },
        data: {
            events: {
                displayCount: 3,
                displayMode: 'default',
                intervalMs: 6000,
                items: [
                    {
                        id: 'ev-1',
                        date: '2026-03-25',
                        title: 'כנס מפקדים',
                        subtitle: 'אולם מרכזי | 09:00',
                        color: 'red',
                    },
                    {
                        id: 'ev-2',
                        date: '2026-03-28',
                        title: 'יום כשירות צוותים',
                        subtitle: 'רחבת אימונים | 07:30',
                        color: 'gray',
                    },
                    {
                        id: 'ev-3',
                        date: '2026-04-01',
                        title: 'תדריך פתיחת מחזור',
                        subtitle: 'בניין הדרכה | 10:00',
                        color: 'gray',
                    },
                ],
            },
            alerts: {
                items: [
                    {
                        id: 'al-1',
                        title: 'ביקורת כושר רבעונית',
                        text: 'כלל משרתי היחידה נדרשים להשלים מדדי כושר עד יום חמישי.',
                        isUrgent: true,
                    },
                    {
                        id: 'al-2',
                        title: 'עדכון נהלי אבטחה',
                        text: 'החל מהשבוע חובה לשאת תג זיהוי בכל מעבר בין מתחמים.',
                        isUrgent: false,
                    },
                ],
            },
            outstanding: {
                items: [
                    {
                        id: 'out-1',
                        name: 'רס״ל נטע כהן',
                        role: 'מדריכת קורס ליבה',
                        imageUrl: '/images/פורטרט.png',
                        description: 'הובילה תהליך הטמעת תוכנית לימוד חדשה ושיפרה את ציוני המחזור באופן משמעותי.',
                    },
                    {
                        id: 'out-2',
                        name: 'סמ״ר יואב לוי',
                        role: 'מפקד צוות הדרכה',
                        imageUrl: '/images/פורטרט.png',
                        description: 'קידם תרגולות מקצועיות והצטיין בהובלת החניכים למצוינות מבצעית.',
                    },
                ],
            },
            countdown: {
                title: 'פתיחת מחזור אביב',
                targetDate: '2026-05-10T08:00:00+03:00',
                showDetails: true,
                details: 'ספירה רשמית לפתיחת מחזור האביב הקרוב.',
                switchIntervalSeconds: 8,
                activeItemId: 'cd-1',
                items: [
                    {
                        id: 'cd-1',
                        title: 'פתיחת מחזור אביב',
                        targetDate: '2026-05-10T08:00:00+03:00',
                        showDetails: true,
                        details: 'ספירה רשמית לפתיחת מחזור האביב הקרוב.',
                    },
                ],
            },
            news: {
                items: [
                    {
                        id: 'news-1',
                        text: 'החל השבוע: הרחבת מערך הלמידה הדיגיטלית לכלל מסלולי ההכשרה.',
                        isUrgent: false,
                    },
                    {
                        id: 'news-2',
                        text: 'תרגיל יחידתי רחב יתקיים ביום רביעי הקרוב - יש להתעדכן בהנחיות המוקדמות.',
                        isUrgent: true,
                    },
                ],
            },
            phonebook: {
                items: [
                    {
                        id: 'ph-1',
                        name: 'חמ״ל תורן',
                        number: '08-9991000',
                        department: 'אג״ם',
                    },
                    {
                        id: 'ph-2',
                        name: 'קצינת ת״ש',
                        number: '08-9991021',
                        department: 'מפקדה',
                    },
                    {
                        id: 'ph-3',
                        name: 'מדור הדרכה',
                        number: '08-9991044',
                        department: 'הכשרות',
                    },
                ],
            },
            shuttles: {
                items: [
                    {
                        id: 'sh-1',
                        destination: 'תחנה מרכזית באר שבע',
                        departureTime: '07:15',
                        type: 'bus',
                    },
                    {
                        id: 'sh-2',
                        destination: 'רכבת צפון',
                        departureTime: '13:40',
                        type: 'minibus',
                    },
                    {
                        id: 'sh-3',
                        destination: 'מרכז תחבורה דרום',
                        departureTime: '18:00',
                        type: 'bus',
                    },
                ],
            },
            polls: {
                activePollId: 'poll-1',
                items: [
                    {
                        id: 'poll-1',
                        question: 'איזה פורמט תדריך שבועי הכי יעיל עבורכם?',
                        options: [
                            { id: 'poll-1-opt-1', text: 'תדריך פרונטלי קצר', votes: 12 },
                            { id: 'poll-1-opt-2', text: 'סיכום דיגיטלי כתוב', votes: 8 },
                            { id: 'poll-1-opt-3', text: 'וידאו מוקלט', votes: 5 },
                        ],
                    },
                ],
            },
            celebrations: {
                items: [
                    {
                        id: 'cel-1',
                        name: 'סגן עומר ישראלי',
                        type: 'יום הולדת',
                        date: '2026-03-22',
                        description: 'חוגג/ת יום הולדת השבוע - מזל טוב!',
                    },
                    {
                        id: 'cel-2',
                        name: 'מדור תקשוב',
                        type: 'ציון לשבח',
                        date: '2026-03-29',
                        description: 'קיבל ציון לשבח על הובלת פרויקט תשתיות מוצלח.',
                    },
                ],
            },
            heritage: {
                items: [
                    {
                        id: 'her-1',
                        quote: 'מצוינות מבצעית מתחילה במשמעת מקצועית וממשיכה ברוח צוות.',
                        author: 'אל"ם י׳',
                        role: 'מפקד מערך ההכשרה',
                    },
                    {
                        id: 'her-2',
                        quote: 'מי שלומד היום בעומק, מפקד מחר בביטחון.',
                        author: 'רס"ן מ׳',
                        role: 'ראש מדור הדרכה',
                    },
                ],
            },
            tips: {
                items: [
                    {
                        id: 'tip-1',
                        title: 'ניהול משימה יומי',
                        text: 'פתחו כל בוקר בתיעדוף שלוש המשימות הקריטיות והתקדמו לפי סדר חשיבות.',
                    },
                    {
                        id: 'tip-2',
                        title: 'למידה אפקטיבית',
                        text: 'סכמו כל שיעור בשלוש נקודות מפתח - זה מחזק זיכרון ומקצר חזרות.',
                    },
                ],
            },
        },
    },
    externalLinks: {
        items: [
            {
                id: 'ext-1',
                title: 'ענן התומכ"ל',
                url: 'https://portal.army.idf',
                visual: { type: 'icon', icon: 'Globe' },
                order: 0,
            },
            {
                id: 'ext-2',
                title: 'חטיבת ההפעלה',
                url: 'https://mzai.army.idf/sites/Mahir/main/index.html',
                visual: { type: 'icon', icon: 'GraduationCap' },
                order: 1,
            },

        ],
    },
    imageGalleries: {
        schemaVersion: 1,
        items: [],
    },
    access: {
        adminUsers: [
            {
                id: 'admin-1',
                name: 'admin',
                role: 'admin',
            },
        ],
    },
};

export function migrateLegacyToV1(legacyData) {
    const legacy = isObject(legacyData) ? legacyData : {};
    const legacyTheme = isObject(legacy.theme) ? legacy.theme : {};
    const legacyContent = isObject(legacy.content)
        ? legacy.content
        : (isObject(legacy.siteContent) ? legacy.siteContent : {});
    const hasLegacyNav = hasOwn(legacy, 'nav') || hasOwn(legacy, 'navigation');
    const legacyNav = Array.isArray(legacy.nav)
        ? legacy.nav
        : (Array.isArray(legacy.navigation) ? legacy.navigation : []);
    const legacyWidgets = isObject(legacy.widgets) ? legacy.widgets : {};
    const legacyWidgetData = isObject(legacyWidgets.data) ? legacyWidgets.data : {};
    const legacyEvents = legacy.events;
    const hasLegacyExternalLinks = hasOwn(legacy, 'externalLinks') || hasOwn(legacy, 'links');
    const legacyExternalLinks = Array.isArray(legacy.externalLinks)
        ? legacy.externalLinks
        : (Array.isArray(legacy.links) ? legacy.links : []);
    const hasLegacyUsers = hasOwn(legacy, 'users') || hasOwn(legacy, 'adminUsers');
    const legacyUsers = Array.isArray(legacy.users)
        ? legacy.users
        : (Array.isArray(legacy.adminUsers) ? legacy.adminUsers : []);

    const migrated = clone(DEFAULT_CONFIG_V1);
    migrated.meta.migratedFromLegacy = true;

    migrated.theme.primaryColor = asString(legacyTheme.primaryColor, migrated.theme.primaryColor);
    migrated.theme.displayMode = asString(legacyTheme.displayMode, migrated.theme.displayMode);
    migrated.theme.borderStyle = asString(legacyTheme.borderStyle, migrated.theme.borderStyle);
    migrated.theme.backgrounds.tinted.enabled = asBoolean(
        legacyTheme.useTintedBackground,
        migrated.theme.backgrounds.tinted.enabled
    );
    migrated.theme.backgrounds.tinted.strength = clampNumber(
        legacyTheme.tintedBackgroundStrength,
        0,
        100,
        migrated.theme.backgrounds.tinted.strength
    );
    migrated.theme.backgrounds.hero.grayscale = asBoolean(legacyTheme.heroGrayscale, migrated.theme.backgrounds.hero.grayscale);
    migrated.theme.backgrounds.hero.glassEffect = asBoolean(
        legacyTheme.heroGlassEffect,
        asBoolean(legacyTheme.glassEffect, migrated.theme.backgrounds.hero.glassEffect)
    );
    migrated.theme.backgrounds.hero.glassStrength = clampNumber(
        legacyTheme.heroGlassStrength,
        0,
        100,
        migrated.theme.backgrounds.hero.glassStrength
    );
    migrated.theme.backgrounds.navbar.glassEffect = asBoolean(
        legacyTheme.topNavGlassEffect,
        asBoolean(legacyTheme.navbarGlassEffect, migrated.theme.backgrounds.navbar.glassEffect)
    );
    migrated.theme.backgrounds.navbar.glassStrength = clampNumber(
        legacyTheme.topNavGlassStrength,
        0,
        100,
        migrated.theme.backgrounds.navbar.glassStrength
    );

    const borderTargets = isObject(legacy.borderTargets)
        ? legacy.borderTargets
        : (isObject(legacyTheme.borderTargets) ? legacyTheme.borderTargets : {});
    migrated.theme.borderTargets = deepMergeReplaceArrays(migrated.theme.borderTargets, borderTargets);

    migrated.layout.navigation.showCategories = asBoolean(
        legacyTheme.showNavCategories,
        migrated.layout.navigation.showCategories
    );
    migrated.layout.navigation.mode = asString(legacyTheme.regularLinksLayout, migrated.layout.navigation.mode);
    migrated.layout.hero.widgetHeight = asString(legacyTheme.widgetHeight, migrated.layout.hero.widgetHeight);
    migrated.layout.hero.panelsBordered = asBoolean(legacyTheme.heroPanelsBordered, migrated.layout.hero.panelsBordered);
    migrated.layout.hero.commanderPanelBordered = asBoolean(
        legacyTheme.heroPanelsBordered,
        migrated.layout.hero.commanderPanelBordered
    );
    migrated.layout.hero.widgetPanelBordered = asBoolean(
        legacyTheme.heroPanelsBordered,
        migrated.layout.hero.widgetPanelBordered
    );
    migrated.layout.externalLinks.mode = asString(legacyTheme.externalLinksLayout, migrated.layout.externalLinks.mode);
    migrated.layout.externalLinks.fixed = asBoolean(legacyTheme.externalLinksFixed, migrated.layout.externalLinks.fixed);
    migrated.layout.externalLinks.bordered = asBoolean(legacyTheme.externalLinksBordered, migrated.layout.externalLinks.bordered);
    migrated.layout.externalLinks.showBackground = asBoolean(
        legacyTheme.externalLinksShowBackground,
        migrated.layout.externalLinks.showBackground
    );

    const hero = isObject(legacyContent.hero) ? legacyContent.hero : {};
    migrated.content.hero.siteName = asString(hero.siteName, migrated.content.hero.siteName);
    migrated.content.hero.title = asString(hero.title, migrated.content.hero.title);
    migrated.content.hero.subtitle = asString(hero.subtitle, migrated.content.hero.subtitle);
    migrated.content.hero.logoUrl = asString(hero.logoUrl, asString(hero.logo, migrated.content.hero.logoUrl));
    migrated.content.hero.description = asString(hero.description, migrated.content.hero.description);
    migrated.content.hero.backgroundImageUrls = Array.isArray(hero.backgroundImageUrls)
        ? hero.backgroundImageUrls
        : (Array.isArray(hero.backgroundImages) ? hero.backgroundImages : migrated.content.hero.backgroundImageUrls);

    const commander = isObject(legacyContent.commander) ? legacyContent.commander : {};
    const commanderImageSettings = normalizeCommanderImageSettings({
        ...migrated.content.commander,
        ...commander,
        imageUrl: asString(commander.imageUrl, asString(commander.image, migrated.content.commander.imageUrl)),
        imageSource: commander.imageSource,
    });
    migrated.content.commander.imageUrl = commanderImageSettings.imageUrl;
    migrated.content.commander.imageSource = commanderImageSettings.imageSource;
    migrated.content.commander.imageAvatar = commanderImageSettings.imageAvatar;
    migrated.content.commander.customImageUrl = commanderImageSettings.customImageUrl;
    migrated.content.commander.imageScale = commanderImageSettings.imageScale;
    migrated.content.commander.imageOffsetX = commanderImageSettings.imageOffsetX;
    migrated.content.commander.imageOffsetY = commanderImageSettings.imageOffsetY;
    migrated.content.commander.sectionTitle = asString(commander.sectionTitle, migrated.content.commander.sectionTitle);
    migrated.content.commander.roleLabel = asString(commander.roleLabel, migrated.content.commander.roleLabel);
    migrated.content.commander.decorativeElement = asString(
        commander.decorativeElement,
        migrated.content.commander.decorativeElement
    );
    migrated.content.commander.messages = Array.isArray(commander.messages)
        ? commander.messages
        : migrated.content.commander.messages;

    if (isObject(legacyContent.overlayImage)) {
        migrated.content.overlayImage = deepMergeReplaceArrays(migrated.content.overlayImage, legacyContent.overlayImage);
    }
    if (isObject(legacyContent.orgChart) || isObject(legacy.orgChart)) {
        migrated.content.orgChart = deepMergeReplaceArrays(
            migrated.content.orgChart,
            isObject(legacyContent.orgChart) ? legacyContent.orgChart : legacy.orgChart
        );
    }

    if (hasLegacyNav) {
        migrated.navigation.items = normalizeNavigationNodes(legacyNav);
    }

    const legacyActiveWidgets = Array.isArray(legacyWidgets.activeWidgets)
        ? legacyWidgets.activeWidgets
        : legacyWidgets.activeWidget;
    migrated.widgets.active = normalizeActiveWidgets(legacyActiveWidgets);
    if (migrated.widgets.active.length === 0) migrated.widgets.active = [...DEFAULT_ACTIVE_WIDGETS];

    migrated.widgets.carousel.rotationIntervalSeconds = clampNumber(
        legacyWidgets.rotationInterval,
        3,
        30,
        migrated.widgets.carousel.rotationIntervalSeconds
    );

    const widgetSettings = isObject(legacyWidgets.widgetSettings) ? legacyWidgets.widgetSettings : {};
    migrated.widgets.display = deepMergeReplaceArrays(migrated.widgets.display, widgetSettings);

    const eventsSource = legacyEvents !== undefined ? legacyEvents : resolveWidgetDataBranch(legacyWidgets, 'events');
    migrated.widgets.data.events = normalizeEventsBranch(eventsSource);

    const alertsSource = resolveWidgetDataBranch(legacyWidgets, 'alerts');
    const outstandingSource = resolveWidgetDataBranch(legacyWidgets, 'outstanding');
    const countdownSource = resolveWidgetDataBranch(legacyWidgets, 'countdown');
    const newsSource = resolveWidgetDataBranch(legacyWidgets, 'news');
    const phonebookSource = resolveWidgetDataBranch(legacyWidgets, 'phonebook');
    const shuttlesSource = resolveWidgetDataBranch(legacyWidgets, 'shuttles');
    const pollsSource = resolveWidgetDataBranch(legacyWidgets, 'polls');
    const celebrationsSource = resolveWidgetDataBranch(legacyWidgets, 'celebrations');
    const heritageSource = resolveWidgetDataBranch(legacyWidgets, 'heritage');
    const tipsSource = resolveWidgetDataBranch(legacyWidgets, 'tips');

    migrated.widgets.data.alerts.items = Array.isArray(alertsSource?.items) ? alertsSource.items : alertsSource;
    migrated.widgets.data.outstanding.items = Array.isArray(outstandingSource?.items) ? outstandingSource.items : outstandingSource;
    if (isObject(countdownSource)) {
        migrated.widgets.data.countdown = deepMergeReplaceArrays(migrated.widgets.data.countdown, countdownSource);
    }
    migrated.widgets.data.news.items = Array.isArray(newsSource?.items) ? newsSource.items : newsSource;
    migrated.widgets.data.phonebook.items = Array.isArray(phonebookSource?.items) ? phonebookSource.items : phonebookSource;
    migrated.widgets.data.shuttles.items = Array.isArray(shuttlesSource?.items) ? shuttlesSource.items : shuttlesSource;
    migrated.widgets.data.polls = normalizePollsBranch(pollsSource);
    migrated.widgets.data.celebrations.items = Array.isArray(celebrationsSource?.items) ? celebrationsSource.items : celebrationsSource;
    migrated.widgets.data.heritage.items = Array.isArray(heritageSource?.items) ? heritageSource.items : heritageSource;
    migrated.widgets.data.tips.items = Array.isArray(tipsSource?.items) ? tipsSource.items : tipsSource;

    if (isObject(legacyWidgetData.events)) {
        migrated.widgets.data.events = normalizeEventsBranch(legacyWidgetData.events);
    }

    if (hasLegacyExternalLinks) {
        migrated.externalLinks.items = normalizeExternalLinksItems(legacyExternalLinks);
    }
    if (hasLegacyUsers) {
        migrated.access.adminUsers = normalizeAdminUsers(legacyUsers);
    }
    if (hasOwn(legacy, 'imageGalleries') || hasOwn(legacy, 'galleries')) {
        migrated.imageGalleries = normalizeImageGalleryBranch(legacy.imageGalleries || legacy.galleries);
    }

    return validateAndNormalize(migrated);
}
export function validateAndNormalize(config) {
    const input = isObject(config) ? config : {};
    const inputCommander = isObject(input.content?.commander) ? input.content.commander : {};
    const source = deepMergeReplaceArrays(DEFAULT_CONFIG_V1, input);
    const widgetsSource = isObject(source.widgets) ? source.widgets : {};
    const sourceCommander = isObject(source.content?.commander) ? source.content.commander : {};
    const commanderHasLegacyImage = Object.hasOwn(inputCommander, 'imageUrl') || Object.hasOwn(inputCommander, 'image');
    const commanderImageSettings = normalizeCommanderImageSettings({
        ...DEFAULT_CONFIG_V1.content.commander,
        ...sourceCommander,
        ...(commanderHasLegacyImage && !Object.hasOwn(inputCommander, 'imageSource')
            ? {
                imageSource: undefined,
                image: asString(inputCommander.image, asString(inputCommander.imageUrl, '')),
            }
            : {}),
    });

    const normalized = {
        schemaVersion: SCHEMA_VERSION,
        meta: {
            appId: 'siteBuilder',
            migratedFromLegacy: asBoolean(source.meta?.migratedFromLegacy, false),
            lastUpdatedAt: typeof source.meta?.lastUpdatedAt === 'string' ? source.meta.lastUpdatedAt : null,
            lastUpdatedBy: typeof source.meta?.lastUpdatedBy === 'string' ? source.meta.lastUpdatedBy : null,
        },
        theme: {
            primaryColor: HEX_COLOR_RE.test(source.theme?.primaryColor)
                ? source.theme.primaryColor
                : DEFAULT_CONFIG_V1.theme.primaryColor,
            displayMode: asEnum(source.theme?.displayMode, VALID_THEME_DISPLAY_MODES, DEFAULT_CONFIG_V1.theme.displayMode),
            borderStyle: asEnum(source.theme?.borderStyle, VALID_BORDER_STYLES, DEFAULT_CONFIG_V1.theme.borderStyle),
            borderTargets: normalizeBorderTargets(source.theme?.borderTargets),
            backgrounds: {
                tinted: {
                    enabled: asBoolean(source.theme?.backgrounds?.tinted?.enabled, DEFAULT_CONFIG_V1.theme.backgrounds.tinted.enabled),
                    strength: clampNumber(
                        source.theme?.backgrounds?.tinted?.strength,
                        0,
                        100,
                        DEFAULT_CONFIG_V1.theme.backgrounds.tinted.strength
                    ),
                },
                hero: {
                    grayscale: asBoolean(source.theme?.backgrounds?.hero?.grayscale, DEFAULT_CONFIG_V1.theme.backgrounds.hero.grayscale),
                    glassEffect: asBoolean(source.theme?.backgrounds?.hero?.glassEffect, DEFAULT_CONFIG_V1.theme.backgrounds.hero.glassEffect),
                    glassStrength: clampNumber(
                        source.theme?.backgrounds?.hero?.glassStrength,
                        0,
                        100,
                        DEFAULT_CONFIG_V1.theme.backgrounds.hero.glassStrength
                    ),
                },
                navbar: {
                    glassEffect: asBoolean(source.theme?.backgrounds?.navbar?.glassEffect, DEFAULT_CONFIG_V1.theme.backgrounds.navbar.glassEffect),
                    glassStrength: clampNumber(
                        source.theme?.backgrounds?.navbar?.glassStrength,
                        0,
                        100,
                        DEFAULT_CONFIG_V1.theme.backgrounds.navbar.glassStrength
                    ),
                },
            },
        },
        layout: {
            navigation: {
                showCategories: asBoolean(source.layout?.navigation?.showCategories, DEFAULT_CONFIG_V1.layout.navigation.showCategories),
                mode: asEnum(source.layout?.navigation?.mode, VALID_NAV_LAYOUT_MODES, DEFAULT_CONFIG_V1.layout.navigation.mode),
            },
            hero: {
                widgetHeight: asEnum(source.layout?.hero?.widgetHeight, VALID_WIDGET_HEIGHTS, DEFAULT_CONFIG_V1.layout.hero.widgetHeight),
                panelsBordered: asBoolean(source.layout?.hero?.panelsBordered, DEFAULT_CONFIG_V1.layout.hero.panelsBordered),
                commanderPanelBordered: asBoolean(
                    source.layout?.hero?.commanderPanelBordered,
                    DEFAULT_CONFIG_V1.layout.hero.commanderPanelBordered
                ),
                widgetPanelBordered: asBoolean(
                    source.layout?.hero?.widgetPanelBordered,
                    asBoolean(source.layout?.hero?.panelsBordered, DEFAULT_CONFIG_V1.layout.hero.widgetPanelBordered)
                ),
            },
            externalLinks: {
                mode: asEnum(
                    source.layout?.externalLinks?.mode,
                    VALID_EXTERNAL_LINK_LAYOUT_MODES,
                    DEFAULT_CONFIG_V1.layout.externalLinks.mode
                ),
                fixed: asBoolean(source.layout?.externalLinks?.fixed, DEFAULT_CONFIG_V1.layout.externalLinks.fixed),
                bordered: asBoolean(source.layout?.externalLinks?.bordered, DEFAULT_CONFIG_V1.layout.externalLinks.bordered),
                showBackground: asBoolean(
                    source.layout?.externalLinks?.showBackground,
                    DEFAULT_CONFIG_V1.layout.externalLinks.showBackground
                ),
            },
        },
        navigation: {
            items: normalizeNavigationNodes(source.navigation?.items),
        },
        content: {
            hero: {
                siteName: asString(source.content?.hero?.siteName, DEFAULT_CONFIG_V1.content.hero.siteName),
                title: asString(source.content?.hero?.title, DEFAULT_CONFIG_V1.content.hero.title),
                subtitle: asString(source.content?.hero?.subtitle, DEFAULT_CONFIG_V1.content.hero.subtitle),
                logoUrl: asString(source.content?.hero?.logoUrl, DEFAULT_CONFIG_V1.content.hero.logoUrl),
                description: asString(source.content?.hero?.description, DEFAULT_CONFIG_V1.content.hero.description),
                backgroundImageUrls: asStringArray(source.content?.hero?.backgroundImageUrls),
            },
            commander: {
                imageUrl: commanderImageSettings.imageUrl,
                imageSource: commanderImageSettings.imageSource,
                imageAvatar: commanderImageSettings.imageAvatar,
                customImageUrl: commanderImageSettings.customImageUrl,
                imageScale: commanderImageSettings.imageScale,
                imageOffsetX: commanderImageSettings.imageOffsetX,
                imageOffsetY: commanderImageSettings.imageOffsetY,
                sectionTitle: asString(source.content?.commander?.sectionTitle, DEFAULT_CONFIG_V1.content.commander.sectionTitle),
                roleLabel: asString(source.content?.commander?.roleLabel, DEFAULT_CONFIG_V1.content.commander.roleLabel),
                decorativeElement: asEnum(
                    source.content?.commander?.decorativeElement,
                    VALID_DECORATIVE_ELEMENTS,
                    DEFAULT_CONFIG_V1.content.commander.decorativeElement
                ),
                messages: normalizeMessages(source.content?.commander?.messages),
            },
            overlayImage: normalizeOverlayImage(source.content?.overlayImage),
            orgChart: normalizeOrgChart(source.content?.orgChart),
        },
        widgets: {
            active: (() => {
                const active = normalizeActiveWidgets(widgetsSource.active);
                return active.length > 0 ? active : [...DEFAULT_ACTIVE_WIDGETS];
            })(),
            carousel: {
                rotationIntervalSeconds: clampNumber(
                    widgetsSource.carousel?.rotationIntervalSeconds,
                    3,
                    30,
                    DEFAULT_CONFIG_V1.widgets.carousel.rotationIntervalSeconds
                ),
            },
            display: normalizeWidgetDisplay(widgetsSource.display),
            data: {
                events: normalizeEventsBranch(resolveWidgetDataBranch(widgetsSource, 'events')),
                alerts: {
                    items: normalizeNotifications(
                        resolveWidgetDataBranch(widgetsSource, 'alerts')?.items ?? resolveWidgetDataBranch(widgetsSource, 'alerts')
                    ),
                },
                outstanding: {
                    items: normalizeSimpleItems(
                        resolveWidgetDataBranch(widgetsSource, 'outstanding')?.items ?? resolveWidgetDataBranch(widgetsSource, 'outstanding'),
                        (item, index) => ({
                            id: asId(item.id, String(index + 1)),
                            name: asString(item.name, ''),
                            role: asString(item.role, ''),
                            imageUrl: asString(item.imageUrl, asString(item.image, '')),
                            description: asString(item.description, ''),
                        })
                    ),
                },
                countdown: normalizeCountdownBranch(resolveWidgetDataBranch(widgetsSource, 'countdown')),
                news: {
                    items: normalizeSimpleItems(
                        resolveWidgetDataBranch(widgetsSource, 'news')?.items ?? resolveWidgetDataBranch(widgetsSource, 'news'),
                        (item, index) => ({
                            id: asId(item.id, String(index + 1)),
                            text: asString(item.text, ''),
                            isUrgent: asBoolean(item.isUrgent, false),
                        })
                    ),
                },
                phonebook: {
                    items: normalizeSimpleItems(
                        resolveWidgetDataBranch(widgetsSource, 'phonebook')?.items ?? resolveWidgetDataBranch(widgetsSource, 'phonebook'),
                        (item, index) => ({
                            id: asId(item.id, String(index + 1)),
                            name: asString(item.name, ''),
                            number: asString(item.number, ''),
                            department: asString(item.department, ''),
                        })
                    ),
                },
                shuttles: {
                    items: normalizeSimpleItems(
                        resolveWidgetDataBranch(widgetsSource, 'shuttles')?.items ?? resolveWidgetDataBranch(widgetsSource, 'shuttles'),
                        (item, index) => ({
                            id: asId(item.id, String(index + 1)),
                            destination: asString(item.destination, ''),
                            departureTime: asString(item.departureTime, ''),
                            type: asEnum(item.type, VALID_SHUTTLE_TYPES, 'bus'),
                        })
                    ),
                },
                polls: normalizePollsBranch(resolveWidgetDataBranch(widgetsSource, 'polls')),
                celebrations: {
                    items: normalizeSimpleItems(
                        resolveWidgetDataBranch(widgetsSource, 'celebrations')?.items ?? resolveWidgetDataBranch(widgetsSource, 'celebrations'),
                        (item, index) => ({
                            id: asId(item.id, String(index + 1)),
                            name: asString(item.name, ''),
                            type: asString(item.type, ''),
                            date: asString(item.date, ''),
                            description: asString(item.description, ''),
                        })
                    ),
                },
                heritage: {
                    items: normalizeSimpleItems(
                        resolveWidgetDataBranch(widgetsSource, 'heritage')?.items ?? resolveWidgetDataBranch(widgetsSource, 'heritage'),
                        (item, index) => ({
                            id: asId(item.id, String(index + 1)),
                            quote: asString(item.quote, ''),
                            author: asString(item.author, ''),
                            role: asString(item.role, ''),
                        })
                    ),
                },
                tips: {
                    items: normalizeSimpleItems(
                        resolveWidgetDataBranch(widgetsSource, 'tips')?.items ?? resolveWidgetDataBranch(widgetsSource, 'tips'),
                        (item, index) => ({
                            id: asId(item.id, String(index + 1)),
                            title: asString(item.title, ''),
                            text: asString(item.text, ''),
                        })
                    ),
                },
            },
        },
        externalLinks: {
            items: normalizeExternalLinksItems(source.externalLinks?.items),
        },
        imageGalleries: normalizeImageGalleryBranch(source.imageGalleries),
        access: {
            adminUsers: normalizeAdminUsers(source.access?.adminUsers),
        },
    };

    const pollIds = new Set(normalized.widgets.data.polls.items.map((item) => item.id));
    if (!normalized.widgets.data.polls.activePollId || !pollIds.has(normalized.widgets.data.polls.activePollId)) {
        normalized.widgets.data.polls.activePollId = null;
    }

    return normalized;
}
