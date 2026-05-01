/**
 * UI 个性化配置工具
 *
 * 统一管理右键菜单显示项和条目侧边栏功能顺序，避免各个视图重复解析偏好。
 */

import { getPref, setPref } from "../utils/prefs";

export const CONTEXT_MENU_ITEMS = [
  {
    id: "generateSummary",
    label: "召唤 AI 管家进行分析",
    description: "文献右键：加入 AI 总结任务队列",
    scope: "item",
  },
  {
    id: "multiRoundReanalyze",
    label: "多轮对话重新精读",
    description: "文献右键：多轮拼接 / 多轮总结子菜单",
    scope: "item",
  },
  {
    id: "dashboard",
    label: "AI 管家仪表盘",
    description: "文献右键：打开插件仪表盘",
    scope: "item",
  },
  {
    id: "chatWithAI",
    label: "AI 管家-后续追问",
    description: "AI 笔记右键：打开后续追问界面",
    scope: "item",
  },
  {
    id: "imageSummary",
    label: "召唤 AI 管家一图总结",
    description: "文献右键：加入一图总结任务队列",
    scope: "item",
  },
  {
    id: "mindmap",
    label: "AI 管家生成思维导图",
    description: "文献右键：加入思维导图任务队列",
    scope: "item",
  },
  {
    id: "fillTable",
    label: "AI 管家填表",
    description: "文献右键：加入填表任务队列",
    scope: "item",
  },
  {
    id: "literatureReview",
    label: "AI 管家文献综述",
    description: "分类右键：打开文献综述配置",
    scope: "collection",
  },
] as const;

export type ContextMenuItemId = (typeof CONTEXT_MENU_ITEMS)[number]["id"];
export type ContextMenuVisibility = Record<ContextMenuItemId, boolean>;

export const SIDEBAR_MODULES = [
  {
    id: "actionButtons",
    label: "快捷操作按钮",
    description: "完整追问、快速提问入口和刷新按钮",
  },
  {
    id: "note",
    label: "AI 笔记",
    description: "展示 AI 总结笔记、复制 Markdown、切换笔记主题",
  },
  {
    id: "table",
    label: "表格归纳",
    description: "展示和重新生成 AI 填表结果",
  },
  {
    id: "imageSummary",
    label: "一图总结",
    description: "展示一图总结并提供放大、下载、定位文件",
  },
  {
    id: "mindmap",
    label: "思维导图",
    description: "展示和打开 AI 思维导图",
  },
  {
    id: "quickChat",
    label: "快速提问",
    description: "在侧边栏内对当前论文进行临时追问",
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
  chatWithAI: true,
  imageSummary: true,
  mindmap: true,
  fillTable: true,
  literatureReview: true,
};

export const DEFAULT_SIDEBAR_MODULE_VISIBILITY: SidebarModuleVisibility = {
  actionButtons: true,
  note: true,
  table: true,
  imageSummary: true,
  mindmap: true,
  quickChat: true,
};

export const DEFAULT_SIDEBAR_MODULE_ORDER: SidebarModuleId[] = [
  "actionButtons",
  "note",
  "table",
  "imageSummary",
  "mindmap",
  "quickChat",
];

export const DEFAULT_CONTEXT_MENU_ITEM_ORDER: ContextMenuItemId[] = [
  "generateSummary",
  "multiRoundReanalyze",
  "dashboard",
  "chatWithAI",
  "imageSummary",
  "mindmap",
  "fillTable",
  "literatureReview",
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

export function getSidebarModuleVisibility(): SidebarModuleVisibility {
  return parseVisibilityMap(
    getPref("sidebarModuleVisibility"),
    DEFAULT_SIDEBAR_MODULE_VISIBILITY,
  );
}

export function isSidebarModuleEnabled(id: SidebarModuleId): boolean {
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
  setPref("sidebarModuleVisibility", DEFAULT_SIDEBAR_MODULE_VISIBILITY_PREF);
  setPref("sidebarModuleOrder", DEFAULT_SIDEBAR_MODULE_ORDER_PREF);
}
