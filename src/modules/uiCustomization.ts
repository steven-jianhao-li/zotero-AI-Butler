/**
 * UI 个性化配置工具
 *
 * 统一管理右键菜单显示项和条目侧边栏功能顺序，避免各个视图重复解析偏好。
 */

import { getPref, setPref } from "../utils/prefs";

export const CONTEXT_MENU_ITEMS = [
  {
    id: "generateSummary",
    labelKey: "settings-ui-context-menu-generateSummary-label",
    descriptionKey: "settings-ui-context-menu-generateSummary-description",
    scope: "item",
  },
  {
    id: "multiRoundReanalyze",
    labelKey: "settings-ui-context-menu-multiRoundReanalyze-label",
    descriptionKey: "settings-ui-context-menu-multiRoundReanalyze-description",
    scope: "item",
  },
  {
    id: "dashboard",
    labelKey: "settings-ui-context-menu-dashboard-label",
    descriptionKey: "settings-ui-context-menu-dashboard-description",
    scope: "item",
  },
  {
    id: "imageSummary",
    labelKey: "settings-ui-context-menu-imageSummary-label",
    descriptionKey: "settings-ui-context-menu-imageSummary-description",
    scope: "item",
  },
  {
    id: "mindmap",
    labelKey: "settings-ui-context-menu-mindmap-label",
    descriptionKey: "settings-ui-context-menu-mindmap-description",
    scope: "item",
  },
  {
    id: "chatWithAI",
    labelKey: "settings-ui-context-menu-chatWithAI-label",
    descriptionKey: "settings-ui-context-menu-chatWithAI-description",
    scope: "item",
  },
  {
    id: "literatureReview",
    labelKey: "settings-ui-context-menu-literatureReview-label",
    descriptionKey: "settings-ui-context-menu-literatureReview-description",
    scope: "collection",
  },
  {
    id: "clearCollectionAiNotes",
    labelKey: "settings-ui-context-menu-clearCollectionAiNotes-label",
    descriptionKey:
      "settings-ui-context-menu-clearCollectionAiNotes-description",
    scope: "collection",
  },
  {
    id: "exportCollectionNotes",
    labelKey: "settings-ui-context-menu-exportCollectionNotes-label",
    descriptionKey:
      "settings-ui-context-menu-exportCollectionNotes-description",
    scope: "collection",
  },
] as const;

export type ContextMenuItemId = (typeof CONTEXT_MENU_ITEMS)[number]["id"];
export type ContextMenuVisibility = Record<ContextMenuItemId, boolean>;
export const DEFAULT_CONTEXT_MENU_COLLAPSED = false;

export const SIDEBAR_MODULES = [
  {
    id: "actionButtons",
    labelKey: "settings-ui-sidebar-module-actionButtons-label",
    descriptionKey: "settings-ui-sidebar-module-actionButtons-description",
  },
  {
    id: "note",
    labelKey: "settings-ui-sidebar-module-note-label",
    descriptionKey: "settings-ui-sidebar-module-note-description",
  },
  {
    id: "deepRead",
    labelKey: "settings-ui-sidebar-module-deepRead-label",
    descriptionKey: "settings-ui-sidebar-module-deepRead-description",
  },
  {
    id: "table",
    labelKey: "settings-ui-sidebar-module-table-label",
    descriptionKey: "settings-ui-sidebar-module-table-description",
  },
  {
    id: "imageSummary",
    labelKey: "settings-ui-sidebar-module-imageSummary-label",
    descriptionKey: "settings-ui-sidebar-module-imageSummary-description",
  },
  {
    id: "mindmap",
    labelKey: "settings-ui-sidebar-module-mindmap-label",
    descriptionKey: "settings-ui-sidebar-module-mindmap-description",
  },
  {
    id: "quickChat",
    labelKey: "settings-ui-sidebar-module-quickChat-label",
    descriptionKey: "settings-ui-sidebar-module-quickChat-description",
  },
] as const;

export type SidebarModuleId = (typeof SIDEBAR_MODULES)[number]["id"];
export type SidebarModuleVisibility = Record<SidebarModuleId, boolean>;

const CONTEXT_MENU_ITEM_IDS = CONTEXT_MENU_ITEMS.map((item) => item.id);
const SIDEBAR_MODULE_IDS = SIDEBAR_MODULES.map((module) => module.id);

export const DEFAULT_CONTEXT_MENU_ITEM_VISIBILITY: ContextMenuVisibility = {
  generateSummary: true,
  multiRoundReanalyze: true,
  dashboard: true,
  imageSummary: true,
  mindmap: true,
  chatWithAI: true,
  literatureReview: true,
  clearCollectionAiNotes: true,
  exportCollectionNotes: true,
};

export const DEFAULT_SIDEBAR_MODULE_VISIBILITY: SidebarModuleVisibility = {
  actionButtons: true,
  note: true,
  deepRead: true,
  table: true,
  imageSummary: true,
  mindmap: true,
  quickChat: true,
};

export const DEFAULT_SIDEBAR_MODULE_ORDER: SidebarModuleId[] = [
  "actionButtons",
  "note",
  "deepRead",
  "table",
  "imageSummary",
  "mindmap",
  "quickChat",
];

export const DEFAULT_CONTEXT_MENU_ITEM_ORDER: ContextMenuItemId[] = [
  "generateSummary",
  "multiRoundReanalyze",
  "dashboard",
  "imageSummary",
  "mindmap",
  "chatWithAI",
  "literatureReview",
  "clearCollectionAiNotes",
  "exportCollectionNotes",
];

export const DEFAULT_CONTEXT_MENU_ITEM_VISIBILITY_PREF = JSON.stringify(
  DEFAULT_CONTEXT_MENU_ITEM_VISIBILITY,
);
export const DEFAULT_CONTEXT_MENU_ITEM_ORDER_PREF = JSON.stringify(
  DEFAULT_CONTEXT_MENU_ITEM_ORDER,
);
export const DEFAULT_SIDEBAR_MODULE_VISIBILITY_PREF = JSON.stringify(
  DEFAULT_SIDEBAR_MODULE_VISIBILITY,
);
export const DEFAULT_SIDEBAR_MODULE_ORDER_PREF = JSON.stringify(
  DEFAULT_SIDEBAR_MODULE_ORDER,
);

function parseJson(raw: string | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch (error) {
    ztoolkit.log("[AI-Butler] UI 个性化配置解析失败:", error);
    return undefined;
  }
}

function normalizeVisibilityMap<T extends string>(
  source: Partial<Record<T, boolean>> | undefined,
  defaults: Record<T, boolean>,
): Record<T, boolean> {
  const result = { ...defaults };
  if (!source) return result;

  for (const key of Object.keys(defaults) as T[]) {
    if (typeof source[key] === "boolean") {
      result[key] = source[key];
    }
  }
  return result;
}

function parseVisibilityMap<T extends string>(
  raw: string | undefined,
  defaults: Record<T, boolean>,
): Record<T, boolean> {
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...defaults };
  }
  return normalizeVisibilityMap(
    parsed as Partial<Record<T, boolean>>,
    defaults,
  );
}

function normalizeOrder<T extends string>(
  source: readonly T[] | undefined,
  defaults: readonly T[],
  allowedIds: readonly T[],
): T[] {
  const allowed = new Set<T>(allowedIds);
  const result: T[] = [];

  if (source) {
    for (const id of source) {
      if (allowed.has(id) && !result.includes(id)) {
        result.push(id);
      }
    }
  }

  for (const id of defaults) {
    if (!result.includes(id)) {
      result.push(id);
    }
  }
  return result;
}

function parseOrder<T extends string>(
  raw: string | undefined,
  defaults: readonly T[],
  allowedIds: readonly T[],
): T[] {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) {
    return [...defaults];
  }

  const source: T[] = [];
  for (const item of parsed) {
    if (typeof item === "string") {
      source.push(item as T);
    }
  }
  return normalizeOrder(source, defaults, allowedIds);
}

export function getContextMenuItemVisibility(): ContextMenuVisibility {
  return parseVisibilityMap(
    getPref("contextMenuItemVisibility"),
    DEFAULT_CONTEXT_MENU_ITEM_VISIBILITY,
  );
}

export function isContextMenuItemEnabled(id: ContextMenuItemId): boolean {
  return getContextMenuItemVisibility()[id];
}

export function isTableFeatureEnabled(): boolean {
  return getPref("enableTableFeature") !== false;
}

export function setContextMenuItemVisibility(
  visibility: Partial<ContextMenuVisibility>,
): void {
  const normalized = normalizeVisibilityMap(
    visibility,
    DEFAULT_CONTEXT_MENU_ITEM_VISIBILITY,
  );
  setPref("contextMenuItemVisibility", JSON.stringify(normalized));
}

export function getContextMenuItemOrder(): ContextMenuItemId[] {
  return parseOrder(
    getPref("contextMenuItemOrder"),
    DEFAULT_CONTEXT_MENU_ITEM_ORDER,
    CONTEXT_MENU_ITEM_IDS,
  );
}

export function setContextMenuItemOrder(
  order: readonly ContextMenuItemId[],
): void {
  const normalized = normalizeOrder(
    order,
    DEFAULT_CONTEXT_MENU_ITEM_ORDER,
    CONTEXT_MENU_ITEM_IDS,
  );
  setPref("contextMenuItemOrder", JSON.stringify(normalized));
}

export function isContextMenuCollapsed(): boolean {
  return getPref("contextMenuCollapsed") === true;
}

export function setContextMenuCollapsed(collapsed: boolean): void {
  setPref("contextMenuCollapsed", collapsed);
}

export function getSidebarModuleVisibility(): SidebarModuleVisibility {
  return parseVisibilityMap(
    getPref("sidebarModuleVisibility"),
    DEFAULT_SIDEBAR_MODULE_VISIBILITY,
  );
}

export function isSidebarModuleEnabled(id: SidebarModuleId): boolean {
  if (id === "table" && !isTableFeatureEnabled()) return false;
  return getSidebarModuleVisibility()[id];
}

export function setSidebarModuleVisibility(
  visibility: Partial<SidebarModuleVisibility>,
): void {
  const normalized = normalizeVisibilityMap(
    visibility,
    DEFAULT_SIDEBAR_MODULE_VISIBILITY,
  );
  setPref("sidebarModuleVisibility", JSON.stringify(normalized));
}

export function getSidebarModuleOrder(): SidebarModuleId[] {
  return parseOrder(
    getPref("sidebarModuleOrder"),
    DEFAULT_SIDEBAR_MODULE_ORDER,
    SIDEBAR_MODULE_IDS,
  );
}

export function setSidebarModuleOrder(order: readonly SidebarModuleId[]): void {
  const normalized = normalizeOrder(
    order,
    DEFAULT_SIDEBAR_MODULE_ORDER,
    SIDEBAR_MODULE_IDS,
  );
  setPref("sidebarModuleOrder", JSON.stringify(normalized));
}

export function resetUICustomizationPrefs(): void {
  setPref(
    "contextMenuItemVisibility",
    DEFAULT_CONTEXT_MENU_ITEM_VISIBILITY_PREF,
  );
  setPref("contextMenuItemOrder", DEFAULT_CONTEXT_MENU_ITEM_ORDER_PREF);
  setPref("contextMenuCollapsed", DEFAULT_CONTEXT_MENU_COLLAPSED);
  setPref("sidebarModuleVisibility", DEFAULT_SIDEBAR_MODULE_VISIBILITY_PREF);
  setPref("sidebarModuleOrder", DEFAULT_SIDEBAR_MODULE_ORDER_PREF);
}
