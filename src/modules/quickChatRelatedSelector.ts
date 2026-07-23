import { getString } from "../utils/locale";
import {
  createQuickChatRelatedItemRef,
  getQuickChatRelatedLimit,
  validateQuickChatRelatedSelection,
  type QuickChatRelatedItemRef,
  type QuickChatRelatedMode,
} from "./quickChatRelatedContext";

type QuickChatRelatedDialogResult = {
  refs: QuickChatRelatedItemRef[];
  mode: QuickChatRelatedMode;
};

type QuickChatRelatedDialogNode = {
  id: string;
  type: "collection" | "item";
  name: string;
  ref?: QuickChatRelatedItemRef;
  collectionId?: number;
  children: QuickChatRelatedDialogNode[];
  checked: boolean;
  partial: boolean;
  expanded: boolean;
  focused: boolean;
  parent?: QuickChatRelatedDialogNode;
};

const HTML_NS = "http://www.w3.org/1999/xhtml";

function createDialogElement<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tagName: K,
): HTMLElementTagNameMap[K] {
  return doc.createElementNS(HTML_NS, tagName) as HTMLElementTagNameMap[K];
}

export async function openQuickChatRelatedSelectorDialog(
  ownerDoc: Document,
  currentItemId: number,
  existingRefs: QuickChatRelatedItemRef[],
  mode: QuickChatRelatedMode,
): Promise<QuickChatRelatedDialogResult | null> {
  const existingIds = new Set(existingRefs.map((ref) => ref.itemId));
  const selectedCollectionId = getQuickChatSelectedCollectionId();
  const focusedCollectionIds =
    getQuickChatFocusedCollectionIds(selectedCollectionId);
  const nodes = await buildQuickChatRelatedCollectionTree(
    currentItemId,
    existingIds,
    focusedCollectionIds,
    selectedCollectionId,
  );

  if (nodes.length === 0) {
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 2500,
    })
      .createLine({
        text: getString("itempane-related-dialog-empty"),
        type: "default",
      })
      .show();
    return null;
  }

  return new Promise<QuickChatRelatedDialogResult | null>((resolve) => {
    renderQuickChatRelatedSelectorOverlay(
      getQuickChatOverlayDocument(ownerDoc),
      nodes,
      mode,
      resolve,
    );
  });
}

function getQuickChatOverlayDocument(ownerDoc: Document): Document {
  try {
    const mainDoc = Zotero.getMainWindow?.()?.document;
    if (mainDoc?.body) return mainDoc;
  } catch {
    // fall back to owner document
  }
  return ownerDoc;
}

function getQuickChatSelectedCollectionId(): number | null {
  try {
    const collection = Zotero.getActiveZoteroPane?.().getSelectedCollection?.();
    return typeof collection?.id === "number" ? collection.id : null;
  } catch {
    return null;
  }
}

function getQuickChatFocusedCollectionIds(
  selectedCollectionId: number | null,
): Set<number> {
  const ids = new Set<number>();
  let currentId = selectedCollectionId;
  while (typeof currentId === "number" && !ids.has(currentId)) {
    ids.add(currentId);
    try {
      const collection = Zotero.Collections.get(currentId) as
        | Zotero.Collection
        | false
        | null;
      const parentId = collection ? Number((collection as any).parentID) : 0;
      currentId = Number.isFinite(parentId) && parentId > 0 ? parentId : null;
    } catch {
      break;
    }
  }
  return ids;
}

async function buildQuickChatRelatedCollectionTree(
  currentItemId: number,
  existingIds: Set<number>,
  focusedCollectionIds: Set<number>,
  selectedCollectionId: number | null,
): Promise<QuickChatRelatedDialogNode[]> {
  const roots: QuickChatRelatedDialogNode[] = [];
  const libraries = Zotero.Libraries?.getAll?.() || [];

  for (const library of libraries) {
    if ((library as any).libraryType === "feed") continue;
    const libraryID = Number((library as any).libraryID || 0);
    const libraryNode: QuickChatRelatedDialogNode = {
      id: `library-${libraryID}`,
      type: "collection",
      name: String((library as any).name || `Library ${libraryID}`),
      children: [],
      checked: false,
      partial: false,
      expanded: selectedCollectionId === null,
      focused: false,
    };

    const collections = Zotero.Collections.getByLibrary(libraryID) || [];
    for (const collection of collections) {
      if ((collection as any).parentID) continue;
      const child = await buildQuickChatRelatedCollectionNode(
        collection as Zotero.Collection,
        currentItemId,
        existingIds,
        focusedCollectionIds,
        selectedCollectionId,
      );
      if (child) {
        child.parent = libraryNode;
        libraryNode.children.push(child);
      }
    }

    libraryNode.expanded =
      selectedCollectionId === null ||
      libraryNode.children.some((child) => child.expanded || child.focused);
    updateRelatedDialogNodeState(libraryNode);
    if (libraryNode.children.length > 0) {
      roots.push(libraryNode);
    }
  }

  return roots;
}

async function buildQuickChatRelatedCollectionNode(
  collection: Zotero.Collection,
  currentItemId: number,
  existingIds: Set<number>,
  focusedCollectionIds: Set<number>,
  selectedCollectionId: number | null,
): Promise<QuickChatRelatedDialogNode | null> {
  const isFocused = selectedCollectionId === collection.id;
  const node: QuickChatRelatedDialogNode = {
    id: `collection-${collection.id}`,
    type: "collection",
    name: collection.name,
    collectionId: collection.id,
    children: [],
    checked: false,
    partial: false,
    expanded: focusedCollectionIds.has(collection.id),
    focused: isFocused,
  };

  const childCollections = Zotero.Collections.getByParent(collection.id) || [];
  for (const childCollection of childCollections) {
    const child = await buildQuickChatRelatedCollectionNode(
      childCollection as Zotero.Collection,
      currentItemId,
      existingIds,
      focusedCollectionIds,
      selectedCollectionId,
    );
    if (child) {
      child.parent = node;
      node.children.push(child);
    }
  }

  const items = collection.getChildItems?.() || [];
  for (const item of items) {
    const ref = createQuickChatRelatedItemRef(item, currentItemId);
    if (!ref) continue;
    node.children.push({
      id: `item-${ref.itemId}`,
      type: "item",
      name: ref.title,
      ref,
      children: [],
      checked: existingIds.has(ref.itemId),
      partial: false,
      expanded: false,
      focused: false,
      parent: node,
    });
  }

  node.expanded =
    node.expanded ||
    node.children.some((child) => child.expanded || child.focused);
  updateRelatedDialogNodeState(node);
  return node.children.length > 0 ? node : null;
}

function updateRelatedDialogNodeState(node: QuickChatRelatedDialogNode): void {
  if (node.type === "item") {
    node.partial = false;
    return;
  }
  const selectableChildren = node.children;
  const allChecked =
    selectableChildren.length > 0 &&
    selectableChildren.every((child) => child.checked && !child.partial);
  const anyChecked = selectableChildren.some(
    (child) => child.checked || child.partial,
  );
  node.checked = allChecked;
  node.partial = anyChecked && !allChecked;
}

function renderQuickChatRelatedSelectorOverlay(
  doc: Document,
  nodes: QuickChatRelatedDialogNode[],
  initialMode: QuickChatRelatedMode,
  resolve: (result: QuickChatRelatedDialogResult | null) => void,
): void {
  const body = doc.body || doc.documentElement;
  if (!body) {
    resolve(null);
    return;
  }

  let selectedMode = initialMode;
  let resolved = false;
  const overlay = createDialogElement(doc, "div");
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(15, 23, 42, 0.36);
    backdrop-filter: blur(3px);
    box-sizing: border-box;
  `;

  const dialog = createDialogElement(doc, "div");
  dialog.style.cssText = `
    width: min(920px, calc(100vw - 48px));
    height: min(720px, calc(100vh - 48px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, 0.28);
    border-radius: 16px;
    background: Canvas;
    background: color-mix(in srgb, canvas 96%, white 4%);
    color: canvastext;
    box-shadow: 0 24px 70px rgba(15, 23, 42, 0.35);
    font-family: system-ui, -apple-system, sans-serif;
  `;
  overlay.appendChild(dialog);

  const finish = (result: QuickChatRelatedDialogResult | null): void => {
    if (resolved) return;
    resolved = true;
    try {
      doc.defaultView?.removeEventListener("keydown", onKeyDown, true);
      overlay.remove();
    } catch {
      // ignore cleanup failures
    }
    resolve(result);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      finish(null);
    }
  };
  doc.defaultView?.addEventListener("keydown", onKeyDown, true);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) finish(null);
  });

  const header = createDialogElement(doc, "div");
  header.style.cssText = `
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 18px 20px 14px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.2);
    background: linear-gradient(135deg, rgba(89, 192, 188, 0.16), rgba(102, 126, 234, 0.1));
  `;
  const titleBox = createDialogElement(doc, "div");
  titleBox.style.cssText = "min-width: 0;";
  const title = createDialogElement(doc, "h2");
  title.textContent = getString("itempane-related-dialog-heading");
  title.style.cssText =
    "margin: 0 0 6px 0; font-size: 18px; line-height: 1.25;";
  const help = createDialogElement(doc, "div");
  help.textContent = getString("itempane-related-dialog-help");
  help.style.cssText = "font-size: 12px; opacity: 0.78; line-height: 1.45;";
  titleBox.appendChild(title);
  titleBox.appendChild(help);

  const closeBtn = createDialogElement(doc, "button");
  closeBtn.textContent = "×";
  closeBtn.title = getString("dialog-button-cancel");
  closeBtn.style.cssText = `
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.16);
    color: inherit;
    cursor: pointer;
    font-size: 20px;
    line-height: 1;
  `;
  closeBtn.addEventListener("click", () => finish(null));
  header.appendChild(titleBox);
  header.appendChild(closeBtn);
  dialog.appendChild(header);

  const modeBar = createDialogElement(doc, "div");
  modeBar.style.cssText = `
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 20px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.16);
    background: rgba(148, 163, 184, 0.06);
  `;
  const modeLabel = createDialogElement(doc, "span");
  modeLabel.textContent = getString("itempane-related-dialog-material-label");
  modeLabel.style.cssText = "font-size: 12px; font-weight: 650; opacity: 0.82;";
  modeBar.appendChild(modeLabel);

  const modeGroup = createDialogElement(doc, "div");
  modeGroup.style.cssText = `
    display: inline-flex;
    padding: 2px;
    border: 1px solid rgba(89, 192, 188, 0.35);
    border-radius: 999px;
    background: rgba(89, 192, 188, 0.08);
  `;
  const modeButtons: Record<QuickChatRelatedMode, HTMLButtonElement> = {
    summary: createDialogElement(doc, "button"),
    fullText: createDialogElement(doc, "button"),
  };
  modeButtons.summary.textContent = getString("itempane-related-mode-summary");
  modeButtons.fullText.textContent = getString(
    "itempane-related-mode-fulltext",
  );
  for (const [nextMode, button] of Object.entries(modeButtons) as Array<
    [QuickChatRelatedMode, HTMLButtonElement]
  >) {
    button.style.cssText = `
      padding: 5px 12px;
      border: none;
      border-radius: 999px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
    `;
    button.addEventListener("click", () => {
      selectedMode = nextMode;
      renderModeButtons();
      updateFooter();
    });
    modeGroup.appendChild(button);
  }
  modeBar.appendChild(modeGroup);
  dialog.appendChild(modeBar);

  const searchBar = createDialogElement(doc, "div");
  searchBar.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.14);
    background: color-mix(in srgb, canvas 94%, rgba(89, 192, 188, 0.12));
  `;
  const searchInput = createDialogElement(doc, "input");
  searchInput.type = "search";
  searchInput.placeholder = getString(
    "itempane-related-dialog-search-placeholder",
  );
  searchInput.style.cssText = `
    flex: 1;
    min-width: 0;
    padding: 7px 10px;
    border: 1px solid rgba(148, 163, 184, 0.32);
    border-radius: 999px;
    background: Canvas;
    color: canvastext;
    outline: none;
    font-size: 12px;
  `;
  const clearSearchBtn = createDialogElement(doc, "button");
  clearSearchBtn.textContent = "×";
  clearSearchBtn.title = getString("itempane-related-dialog-search-clear");
  clearSearchBtn.style.cssText = `
    width: 26px;
    height: 26px;
    border: 1px solid rgba(148, 163, 184, 0.28);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
  `;
  clearSearchBtn.addEventListener("click", () => {
    searchInput.value = "";
    rerender();
    searchInput.focus();
  });
  searchInput.addEventListener("input", () => {
    rerender();
  });
  searchBar.appendChild(searchInput);
  searchBar.appendChild(clearSearchBtn);
  dialog.appendChild(searchBar);

  const treeContainer = createDialogElement(doc, "div");
  treeContainer.style.cssText = `
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 14px 18px 18px;
  `;
  dialog.appendChild(treeContainer);

  const footer = createDialogElement(doc, "div");
  footer.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 13px 18px;
    border-top: 1px solid rgba(148, 163, 184, 0.2);
    background: rgba(148, 163, 184, 0.06);
  `;
  const selectedCountLabel = createDialogElement(doc, "span");
  selectedCountLabel.style.cssText = "font-size: 12px; opacity: 0.82;";
  footer.appendChild(selectedCountLabel);

  const buttons = createDialogElement(doc, "div");
  buttons.style.cssText = "display: flex; gap: 8px;";
  const cancelBtn = createDialogElement(doc, "button");
  cancelBtn.textContent = getString("dialog-button-cancel");
  cancelBtn.style.cssText = `
    padding: 7px 16px;
    border: 1px solid rgba(148, 163, 184, 0.38);
    border-radius: 8px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  `;
  cancelBtn.addEventListener("click", () => finish(null));
  const confirmBtn = createDialogElement(doc, "button");
  confirmBtn.textContent = getString("itempane-related-dialog-confirm");
  confirmBtn.style.cssText = `
    padding: 7px 18px;
    border: none;
    border-radius: 8px;
    background: #59c0bc;
    color: white;
    cursor: pointer;
    font-weight: 650;
  `;
  confirmBtn.addEventListener("click", () => {
    const refs = collectRelatedDialogSelectedRefs(nodes);
    const validation = validateQuickChatRelatedSelection(refs, selectedMode);
    if (!validation.ok) return;
    finish({ refs, mode: selectedMode });
  });
  buttons.appendChild(cancelBtn);
  buttons.appendChild(confirmBtn);
  footer.appendChild(buttons);
  dialog.appendChild(footer);

  const renderModeButtons = (): void => {
    for (const [buttonMode, button] of Object.entries(modeButtons) as Array<
      [QuickChatRelatedMode, HTMLButtonElement]
    >) {
      const active = selectedMode === buttonMode;
      button.style.background = active ? "#59c0bc" : "transparent";
      button.style.color = active ? "#fff" : "inherit";
      button.style.boxShadow = active
        ? "0 2px 8px rgba(89, 192, 188, 0.28)"
        : "none";
    }
  };

  const updateFooter = (): void => {
    const refs = collectRelatedDialogSelectedRefs(nodes);
    const limit = getQuickChatRelatedLimit(selectedMode);
    const tooMany = refs.length > limit.maxItems;
    selectedCountLabel.textContent = getString(
      "itempane-related-dialog-selected-count",
      { args: { count: refs.length } },
    );
    selectedCountLabel.style.color = tooMany ? "#f44336" : "inherit";
    if (tooMany) {
      selectedCountLabel.textContent += ` · ${getString(
        "itempane-related-limit-items",
        {
          args: {
            mode:
              selectedMode === "summary"
                ? getString("itempane-related-mode-summary")
                : getString("itempane-related-mode-fulltext"),
            max: limit.maxItems,
          },
        },
      )}`;
    }
    confirmBtn.disabled = tooMany;
    confirmBtn.style.opacity = tooMany ? "0.45" : "1";
    confirmBtn.style.cursor = tooMany ? "not-allowed" : "pointer";
  };

  let didScrollToFocusedCollection = false;
  const rerender = (): void => {
    const filterText = searchInput.value;
    treeContainer.innerHTML = "";
    const fragment = doc.createDocumentFragment();
    renderQuickChatRelatedDialogTree(
      doc,
      fragment,
      nodes,
      0,
      filterText,
      () => {
        rerender();
        updateFooter();
      },
    );
    treeContainer.appendChild(fragment);
    updateFooter();
    if (
      !didScrollToFocusedCollection &&
      !normalizeRelatedDialogFilter(filterText)
    ) {
      didScrollToFocusedCollection = true;
      const focused = treeContainer.querySelector(
        '[data-ai-butler-related-focused="true"]',
      ) as HTMLElement | null;
      focused?.scrollIntoView?.({ block: "center" });
    }
  };

  body.appendChild(overlay);
  renderModeButtons();
  rerender();
  confirmBtn.focus();
}

function renderQuickChatRelatedDialogTree(
  doc: Document,
  container: Node & ParentNode,
  nodes: QuickChatRelatedDialogNode[],
  level: number,
  filterText: string,
  onChange: () => void,
): void {
  const normalizedFilter = normalizeRelatedDialogFilter(filterText);
  for (const node of nodes) {
    if (!isRelatedDialogNodeVisible(node, normalizedFilter)) continue;

    const row = createDialogElement(doc, "div");
    row.dataset.aiButlerRelatedFocused = node.focused ? "true" : "false";
    row.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 5px ${level * 18}px;
      padding: 7px 9px;
      border: 1px solid ${node.focused ? "rgba(89, 192, 188, 0.7)" : "rgba(148, 163, 184, 0.18)"};
      border-radius: 9px;
      background: ${node.focused ? "rgba(89, 192, 188, 0.12)" : "rgba(148, 163, 184, 0.08)"};
      box-sizing: border-box;
    `;

    const hasChildren = node.children.length > 0;
    const hasVisibleChildren = node.children.some((child) =>
      isRelatedDialogNodeVisible(child, normalizedFilter),
    );
    const isExpanded =
      node.expanded || (normalizedFilter.length > 0 && hasVisibleChildren);
    const expandBtn = createDialogElement(doc, "button");
    expandBtn.textContent = hasChildren ? (isExpanded ? "▼" : "▶") : "";
    expandBtn.style.cssText = `
      width: 18px;
      border: none;
      background: transparent;
      color: inherit;
      cursor: ${hasChildren ? "pointer" : "default"};
      padding: 0;
      font-size: 11px;
      opacity: ${hasChildren ? "0.75" : "0.25"};
    `;
    expandBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!hasChildren) return;
      node.expanded = !node.expanded;
      onChange();
    });
    row.appendChild(expandBtn);

    const checkbox = createDialogElement(doc, "input");
    checkbox.type = "checkbox";
    checkbox.checked = node.checked;
    checkbox.indeterminate = node.partial;
    checkbox.addEventListener("change", () => {
      setRelatedDialogNodeChecked(node, checkbox.checked);
      updateRelatedDialogParents(node.parent);
      onChange();
    });
    row.appendChild(checkbox);

    const label = createDialogElement(doc, "span");
    label.textContent = `${node.type === "collection" ? "📁" : "📄"} ${node.name}`;
    label.style.cssText = `
      min-width: 0;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      font-weight: ${node.focused ? "650" : "500"};
      cursor: ${hasChildren ? "pointer" : "default"};
    `;
    label.addEventListener("click", () => {
      if (!hasChildren) return;
      node.expanded = !node.expanded;
      onChange();
    });
    row.appendChild(label);

    if (node.type === "collection") {
      const count = createDialogElement(doc, "span");
      count.textContent = String(countRelatedDialogLeafItems(node));
      count.style.cssText = `
        flex-shrink: 0;
        min-width: 22px;
        padding: 1px 6px;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.16);
        color: rgba(100, 116, 139, 0.95);
        font-size: 11px;
        text-align: center;
      `;
      row.appendChild(count);
    }

    container.appendChild(row);

    if (hasChildren && isExpanded) {
      renderQuickChatRelatedDialogTree(
        doc,
        container,
        node.children,
        level + 1,
        filterText,
        onChange,
      );
    }
  }
}

function normalizeRelatedDialogFilter(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function isRelatedDialogNodeVisible(
  node: QuickChatRelatedDialogNode,
  normalizedFilter: string,
): boolean {
  if (!normalizedFilter) return true;
  if (node.name.toLocaleLowerCase().includes(normalizedFilter)) {
    return true;
  }
  return node.children.some((child) =>
    isRelatedDialogNodeVisible(child, normalizedFilter),
  );
}

function setRelatedDialogNodeChecked(
  node: QuickChatRelatedDialogNode,
  checked: boolean,
): void {
  node.checked = checked;
  node.partial = false;
  for (const child of node.children) {
    setRelatedDialogNodeChecked(child, checked);
  }
  updateRelatedDialogNodeState(node);
}

function updateRelatedDialogParents(
  node: QuickChatRelatedDialogNode | undefined,
): void {
  if (!node) return;
  updateRelatedDialogNodeState(node);
  updateRelatedDialogParents(node.parent);
}

function collectRelatedDialogSelectedRefs(
  nodes: QuickChatRelatedDialogNode[],
  seen: Set<number> = new Set(),
): QuickChatRelatedItemRef[] {
  const refs: QuickChatRelatedItemRef[] = [];
  for (const node of nodes) {
    if (
      node.type === "item" &&
      node.checked &&
      node.ref &&
      !seen.has(node.ref.itemId)
    ) {
      seen.add(node.ref.itemId);
      refs.push(node.ref);
    }
    refs.push(...collectRelatedDialogSelectedRefs(node.children, seen));
  }
  return refs;
}

function countRelatedDialogLeafItems(node: QuickChatRelatedDialogNode): number {
  if (node.type === "item") return 1;
  return node.children.reduce(
    (sum, child) => sum + countRelatedDialogLeafItems(child),
    0,
  );
}
