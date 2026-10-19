import { prepareDocument } from "./document";
import { isLegacyHost } from "./host";
import { getString } from "../utils/locale";

type Disposer = () => void;
type SidebarRenderer = (
  body: HTMLElement,
  item: Zotero.Item | undefined,
) => void;
type ToolbarFactory = (doc: Document, reader: any) => HTMLElement;
type LegacyColumn = {
  dataKey: string;
  label: string;
  dataProvider: (item: Zotero.Item) => string;
  renderCell: (...args: any[]) => HTMLElement;
  [key: string]: any;
};

const windows = new Map<Window, Disposer[]>();
const columns = new Map<string, LegacyColumn>();
const columnViews = new Map<any, Disposer>();
const columnItems = new Map<Zotero.Item, Disposer>();
const readerButtons = new Map<Document, Disposer>();
let restoreReaderOpen: Disposer | undefined;
let sidebarRenderer: SidebarRenderer | undefined;
let disposeSidebar: ((body: HTMLElement) => void) | undefined;
let toolbarFactory: ToolbarFactory | undefined;

export function registerLegacyWindow(win: Window): void {
  if (!isLegacyHost() || windows.has(win)) return;
  prepareDocument(win.document);
  const disposers: Disposer[] = [];
  windows.set(win, disposers);
  if (sidebarRenderer) insertSidebar(win, disposers);
  if (columns.size) attachColumns(win);
}

export function unregisterLegacyWindow(win: Window): void {
  const disposers = windows.get(win);
  if (!disposers) return;
  for (const dispose of disposers.reverse()) dispose();
  windows.delete(win);
  const view = (win as any).ZoteroPane?.itemsView;
  columnViews.get(view)?.();
  columnViews.delete(view);
  for (const node of win.document.querySelectorAll(
    "[data-ai-butler-context-menu], #ai-butler-library-toolbar-btn",
  ))
    node.remove();
}

export function registerLegacySidebar(
  render: SidebarRenderer,
  dispose: (body: HTMLElement) => void,
): void {
  sidebarRenderer = render;
  disposeSidebar = dispose;
  for (const [win, disposers] of windows) insertSidebar(win, disposers);
}

function insertSidebar(win: Window, disposers: Disposer[]): void {
  const doc = win.document;
  const tabs = doc.getElementById("zotero-editpane-tabs");
  const panels = doc.getElementById("zotero-view-item");
  const view = (win as any).ZoteroPane.itemsView;
  if (!tabs || !panels || doc.getElementById("ai-butler-legacy-tab")) return;
  const tab = doc.createXULElement("tab");
  tab.id = "ai-butler-legacy-tab";
  tab.setAttribute("label", getString("aibutler-itempane-ai-section-header"));
  const panel = doc.createXULElement("tabpanel");
  panel.id = "ai-butler-legacy-panel";
  panel.setAttribute("flex", "1");
  const frame = doc.createXULElement("iframe") as any;
  frame.id = "ai-butler-legacy-frame";
  frame.setAttribute("flex", "1");
  frame.setAttribute("src", "about:blank");
  panel.appendChild(frame);
  tabs.appendChild(tab);
  panels.appendChild(panel);
  const render = () => {
    const body = frame.contentDocument?.body;
    const selected = (win as any).ZoteroPane.getSelectedItems();
    if (!body || !sidebarRenderer) return;
    prepareDocument(body.ownerDocument);
    sidebarRenderer(body, selected.length === 1 ? selected[0] : undefined);
  };
  frame.addEventListener("load", render);
  tabs.addEventListener("select", render);
  view.onSelect.addListener(render);
  disposers.push(() => {
    const body = frame.contentDocument?.body;
    if (body) disposeSidebar?.(body);
    view.onSelect.removeListener(render);
    frame.removeEventListener("load", render);
    tabs.removeEventListener("select", render);
    if (
      (doc.getElementById("zotero-view-tabbox") as any).selectedIndex ===
      tabs.children.length - 1
    ) {
      (doc.getElementById("zotero-view-tabbox") as any).selectedIndex = 0;
    }
    tab.remove();
    panel.remove();
  });
}

export function registerLegacyReaderToolbar(factory: ToolbarFactory): void {
  toolbarFactory = factory;
  const api = Zotero.Reader as any;
  const originalOpen = api.open;
  const open = async function (this: any, ...args: any[]) {
    const reader = await originalOpen.apply(this, args);
    // Legacy chrome-window events precede reader registration; the completed operation owns readiness.
    try {
      if (reader) await reader._initPromise;
      insertReaderButtons();
    } catch (error) {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    return reader;
  };
  api.open = open;
  restoreReaderOpen = () => {
    if (api.open === open) api.open = originalOpen;
  };
  insertReaderButtons();
}

function insertReaderButtons(): void {
  if (!toolbarFactory) return;
  for (const reader of (Zotero.Reader as any)._readers || []) {
    const doc = reader._iframeWindow?.document;
    const toolbar = doc?.querySelector("#toolbarViewerRight, .toolbar");
    if (!toolbar || toolbar.querySelector(".ai-butler-toolbar-container"))
      continue;
    const button = toolbarFactory(doc, reader);
    toolbar.appendChild(button);
    const dispose = () => {
      button.remove();
      doc.defaultView.removeEventListener("unload", dispose);
      readerButtons.delete(doc);
    };
    doc.defaultView.addEventListener("unload", dispose, { once: true });
    readerButtons.set(doc, dispose);
  }
}

function supplyColumnFields(item: Zotero.Item): void {
  // Legacy rendering and sorting both resolve custom column keys through the item instance.
  if (columnItems.has(item)) return;
  const original = item.getField;
  const descriptor = Object.getOwnPropertyDescriptor(item, "getField");
  const getField = function (this: Zotero.Item, field: string, ...args: any[]) {
    const column = columns.get(field);
    return column
      ? column.dataProvider(this)
      : original.call(this, field as any, ...args);
  };
  item.getField = getField as Zotero.Item["getField"];
  columnItems.set(item, () => {
    if (item.getField !== getField) return;
    if (descriptor) Object.defineProperty(item, "getField", descriptor);
    else delete (item as any).getField;
  });
}

function attachColumns(win: Window): void {
  const view = (win as any).ZoteroPane.itemsView;
  if (columnViews.has(view)) return;
  const originalColumns = view.getColumns;
  const originalCell = view._renderCell;
  const originalRow = view.getRow;
  let active = true;
  // Zotero 6 explicitly exposes getColumns as its extension point; avoid patching the class prototype.
  const getColumns = function (this: any) {
    const existing = originalColumns.call(this);
    return active
      ? existing.concat(
          [...columns.values()].filter(
            (column) =>
              !existing.some(
                (current: any) => current.dataKey === column.dataKey,
              ),
          ),
        )
      : existing;
  };
  const renderCell = function (
    this: any,
    index: number,
    data: string,
    column: LegacyColumn,
    ...extra: any[]
  ) {
    const registered = active && columns.get(column.dataKey);
    if (!registered)
      return originalCell.call(this, index, data, column, ...extra);
    return registered.renderCell(
      index,
      registered.dataProvider(this.getRow(index).ref),
      column,
      false,
      this._ownerDocument,
    );
  };
  view.getColumns = getColumns;
  view._renderCell = renderCell;
  const getRow = function (this: any, index: number) {
    const row = originalRow.call(this, index);
    if (active && row) supplyColumnFields(row.ref);
    return row;
  };
  view.getRow = getRow;
  columnViews.set(view, () => {
    active = false;
    if (columns.has(view._sortedColumn?.dataKey)) view._sortedColumn = null;
    if (view.getColumns === getColumns) view.getColumns = originalColumns;
    if (view._renderCell === renderCell) view._renderCell = originalCell;
    if (view.getRow === getRow) view.getRow = originalRow;
    view._columnsId = null;
    view._rowCache = {};
    view.forceUpdate();
  });
}

export const legacyItemColumns = {
  registerColumn(column: LegacyColumn): string {
    columns.set(column.dataKey, {
      ...column,
      zoteroPersist: new Set(column.zoteroPersist),
    });
    for (const win of windows.keys()) attachColumns(win);
    this.refreshColumns();
    return column.dataKey;
  },
  unregisterColumn(key: string): void {
    for (const view of columnViews.keys()) {
      if (view._sortedColumn?.dataKey === key) view._sortedColumn = null;
    }
    columns.delete(key);
    if (!columns.size) {
      for (const dispose of columnViews.values()) dispose();
      columnViews.clear();
      for (const dispose of columnItems.values()) dispose();
      columnItems.clear();
    } else this.refreshColumns();
  },
  refreshColumns(): void {
    for (const view of columnViews.keys()) {
      view._columnsId = null;
      view._rowCache = {};
      view.forceUpdate();
      view.tree?.invalidate();
    }
  },
};

export function unregisterLegacyUi(): void {
  for (const win of windows.keys()) unregisterLegacyWindow(win);
  restoreReaderOpen?.();
  restoreReaderOpen = undefined;
  for (const dispose of readerButtons.values()) dispose();
  readerButtons.clear();
  columns.clear();
  for (const dispose of columnItems.values()) dispose();
  columnItems.clear();
  sidebarRenderer = undefined;
  disposeSidebar = undefined;
  toolbarFactory = undefined;
}
