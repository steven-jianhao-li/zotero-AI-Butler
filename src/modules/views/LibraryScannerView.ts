/**
 * ================================================================
 * 库扫描视图
 * ================================================================
 *
 * 本模块提供一个嵌入式视图,用于扫描整个 Zotero 库,
 * 显示所有未分析的文献,并允许用户通过树形结构选择要分析的条目
 *
 * 主要职责:
 * 1. 扫描所有收藏夹和条目
 * 2. 检测哪些条目缺少 AI 笔记
 * 3. 以树形结构展示扫描结果(支持多级目录)
 * 4. 提供父子联动的复选框选择逻辑
 * 5. 将用户选择的条目批量加入队列
 *
 * @module LibraryScannerView
 * @author AI-Butler Team
 */

import { BaseView } from "./BaseView";
import { isRegularSummaryNote } from "../aiNoteClassifier";
import { ContentExtractor } from "../contentExtractor";
import { TaskQueueManager } from "../taskQueue";
import { MainWindow } from "./MainWindow";

/**
 * 树节点接口
 */
interface TreeNode {
  id: string;
  type: "collection" | "item";
  name: string;
  item?: Zotero.Item;
  collection?: Zotero.Collection;
  children: TreeNode[];
  checked: boolean;
  parentNode?: TreeNode;
  expanded: boolean; // 是否展开
  element?: HTMLElement; // DOM 元素引用
  childrenContainer?: HTMLElement; // 子节点容器引用
  checkboxElement?: HTMLInputElement; // 复选框元素引用
  // 是否已将子节点渲染到 DOM (用于大数据量的懒渲染)
  childrenRendered?: boolean;
}

/**
 * 库扫描视图类
 */
export class LibraryScannerView extends BaseView {
  private treeRoot: TreeNode[] = [];
  private totalUnprocessed: number = 0;
  private selectedCount: number = 0;
  private treeContainer: HTMLElement | null = null;
  private selectedCountElement: HTMLElement | null = null;
  private taskQueueManager: TaskQueueManager;
  private activeScanId: number = 0;

  /**
   * 构造函数
   */
  constructor() {
    super("library-scanner-view");
    this.taskQueueManager = TaskQueueManager.getInstance();
  }

  /**
   * 渲染视图内容
   */
  protected renderContent(): HTMLElement {
    const container = this.createElement("div", {
      id: "ai-butler-scanner-view",
      styles: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        fontFamily: "system-ui, -apple-system, sans-serif",
      },
    });

    // 头部信息区域
    const header = this.createElement("div", {
      styles: {
        padding: "20px",
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        color: "white",
        flexShrink: "0",
      },
      children: [
        this.createElement("h2", {
          styles: {
            margin: "0 0 10px 0",
            fontSize: "18px",
          },
          innerHTML: "📚 库扫描结果",
        }),
        this.createElement("p", {
          id: "scanner-info",
          styles: {
            margin: "0",
            fontSize: "14px",
            opacity: "0.9",
          },
          innerHTML: "正在扫描...",
        }),
      ],
    });

    // 树形结构容器
    this.treeContainer = this.createElement("div", {
      id: "tree-container",
      styles: {
        flex: "1",
        minHeight: "0",
        overflow: "auto",
        padding: "15px",
        background: "#f9f9f9",
      },
    });

    // 底部操作栏
    const footer = this.createElement("div", {
      styles: {
        padding: "15px",
        borderTop: "1px solid #ddd",
        background: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: "0",
      },
    });

    // 选择计数
    this.selectedCountElement = this.createElement("div", {
      styles: {
        fontSize: "14px",
        color: "#666",
      },
      innerHTML: "已选择: <strong>0</strong> 篇",
    });

    // 按钮容器
    const buttonContainer = this.createElement("div", {
      styles: {
        display: "flex",
        gap: "10px",
      },
    });

    // 取消按钮
    const cancelButton = this.createElement("button", {
      styles: {
        padding: "8px 20px",
        border: "1px solid #ddd",
        borderRadius: "4px",
        background: "#fff",
        cursor: "pointer",
        fontSize: "14px",
      },
      textContent: "返回",
    }) as HTMLButtonElement;

    cancelButton.addEventListener("click", () => {
      MainWindow.getInstance().switchTab("dashboard");
    });

    // 确认按钮
    const confirmButton = this.createElement("button", {
      id: "scanner-confirm-btn",
      styles: {
        padding: "8px 20px",
        border: "none",
        borderRadius: "4px",
        background: "#667eea",
        color: "white",
        cursor: "pointer",
        fontSize: "14px",
        fontWeight: "600",
      },
      textContent: "添加到队列",
    }) as HTMLButtonElement;

    confirmButton.addEventListener("click", () => {
      this.handleConfirm();
    });

    buttonContainer.appendChild(cancelButton);
    buttonContainer.appendChild(confirmButton);

    footer.appendChild(this.selectedCountElement);
    footer.appendChild(buttonContainer);

    container.appendChild(header);
    container.appendChild(this.treeContainer);
    container.appendChild(footer);

    return container;
  }

  /**
   * 视图显示时触发
   */
  public async show(): Promise<void> {
    super.show();

    const scanId = ++this.activeScanId;
    this.prepareScanUI();

    try {
      const startedAt = Date.now();
      this.log(`[LibraryScanner] 开始扫描未分析文献 scanId=${scanId}`);

      await this.scanLibrary(scanId);
      if (!this.isCurrentScan(scanId)) return;

      this.log(
        `[LibraryScanner] 扫描完成 scanId=${scanId}, unprocessed=${this.totalUnprocessed}, elapsedMs=${Date.now() - startedAt}`,
      );
      this.updateUI();
    } catch (error) {
      if (!this.isCurrentScan(scanId)) return;
      this.log(`[LibraryScanner] 扫描失败 scanId=${scanId}`, error);
      this.showScanError(error);
    }
  }

  /**
   * 扫描整个库
   */
  private async scanLibrary(scanId: number): Promise<void> {
    this.treeRoot = [];
    this.totalUnprocessed = 0;

    // 获取所有库
    const libraries = Zotero.Libraries.getAll().filter(
      (library) => library.libraryType !== "feed",
    );
    this.log(`[LibraryScanner] 待扫描库数量: ${libraries.length}`);

    for (const library of libraries) {
      if (!this.isCurrentScan(scanId)) return;

      try {
        const libraryStartedAt = Date.now();
        const libraryID = library.libraryID;
        const libraryLabel = this.toSafeDOMText(
          library.name,
          `Library ${libraryID}`,
        );
        this.setInfo(`正在扫描「${libraryLabel}」...`);
        await this.yieldToUI();

        const libraryNode: TreeNode = {
          id: `lib-${libraryID}`,
          type: "collection",
          name: libraryLabel,
          children: [],
          checked: false,
          expanded: false, // 默认收起
        };

        // 扫描库中的所有收藏夹
        const collections = Zotero.Collections.getByLibrary(libraryID);
        const itemIDs = await this.getLibraryTopLevelItemIDs(libraryID);
        this.log(
          `[LibraryScanner] 扫描库: id=${libraryID}, name="${libraryLabel}", collections=${collections.length}, topLevelItemIDs=${itemIDs.length}`,
        );

        const unprocessedItems = await this.collectUnprocessedItems(
          itemIDs,
          libraryLabel,
          scanId,
        );
        if (!this.isCurrentScan(scanId)) return;

        this.totalUnprocessed += unprocessedItems.size;

        for (const collection of collections) {
          // 只处理顶层收藏夹
          if (!collection.parentID) {
            const node = this.buildCollectionNode(collection, unprocessedItems);
            if (node) {
              node.parentNode = libraryNode;
              libraryNode.children.push(node);
            }
          }
        }

        // 扫描库中未归类的条目
        const unfiledItems = this.getUnfiledItems(unprocessedItems);
        if (unfiledItems.length > 0) {
          const unfiledNode: TreeNode = {
            id: `unfiled-${libraryID}`,
            type: "collection",
            name: "未分类文献",
            children: [],
            checked: false,
            expanded: false, // 默认收起
            parentNode: libraryNode,
          };

          for (const item of unfiledItems) {
            const itemNode = this.buildItemNode(item);
            if (itemNode) {
              itemNode.parentNode = unfiledNode;
              unfiledNode.children.push(itemNode);
            }
          }

          if (unfiledNode.children.length > 0) {
            libraryNode.children.push(unfiledNode);
          }
        }

        if (libraryNode.children.length > 0) {
          this.treeRoot.push(libraryNode);
        }

        this.log(
          `[LibraryScanner] 库扫描完成: id=${libraryID}, unprocessed=${unprocessedItems.size}, unfiled=${unfiledItems.length}, elapsedMs=${Date.now() - libraryStartedAt}`,
        );
      } catch (error) {
        this.log(
          `[LibraryScanner] 扫描库失败，已跳过: id=${library.libraryID}, name="${library.name}"`,
          error,
        );
      }
    }
  }

  /**
   * 构建收藏夹节点(递归)
   */
  private buildCollectionNode(
    collection: Zotero.Collection,
    unprocessedItems: Map<number, Zotero.Item>,
    visitedCollections: Set<number> = new Set(),
  ): TreeNode | null {
    if (visitedCollections.has(collection.id)) {
      this.log(
        `[LibraryScanner] 检测到重复收藏夹引用，已跳过: collectionID=${collection.id}, name="${collection.name}"`,
      );
      return null;
    }
    visitedCollections.add(collection.id);

    const node: TreeNode = {
      id: `col-${collection.id}`,
      type: "collection",
      name: this.toSafeDOMText(collection.name, `Collection ${collection.id}`),
      collection,
      children: [],
      checked: false,
      expanded: false, // 默认收起
    };

    // 递归处理子收藏夹
    const childCollections = this.getChildCollections(collection);
    for (const child of childCollections) {
      const childNode = this.buildCollectionNode(
        child,
        unprocessedItems,
        visitedCollections,
      );
      if (childNode) {
        childNode.parentNode = node;
        node.children.push(childNode);
      }
    }

    // 处理收藏夹中的条目
    const itemIDs = this.getCollectionChildItemIDs(collection);
    for (const itemID of itemIDs) {
      const unprocessedItem = unprocessedItems.get(itemID);
      if (!unprocessedItem) continue;

      const itemNode = this.buildItemNode(unprocessedItem);
      if (itemNode) {
        itemNode.parentNode = node;
        node.children.push(itemNode);
      }
    }

    // 如果这个收藏夹没有未处理的子项,返回 null
    if (node.children.length === 0) {
      return null;
    }

    return node;
  }

  /**
   * 构建条目节点
   */
  private buildItemNode(item: Zotero.Item): TreeNode | null {
    // 跳过笔记、附件
    if (!this.shouldScanItem(item)) {
      return null;
    }

    return {
      id: `item-${item.id}`,
      type: "item",
      name: this.getItemTitle(item),
      item,
      children: [],
      checked: false,
      expanded: false, // 条目无子项,但为了一致性也加上
    };
  }

  /**
   * 获取未归类的条目
   */
  private getUnfiledItems(
    unprocessedItems: Map<number, Zotero.Item>,
  ): Zotero.Item[] {
    const items: Zotero.Item[] = [];
    for (const item of unprocessedItems.values()) {
      try {
        const collectionIDs: number[] = (item as any).getCollections?.() || [];
        if (collectionIDs.length === 0) {
          items.push(item);
        }
      } catch (error) {
        this.log(
          `[LibraryScanner] 读取条目分类失败，跳过未分类分组: item=${this.getItemDebugID(item)}`,
          error,
        );
      }
    }

    return items;
  }

  /**
   * 检查条目是否已有 AI 笔记
   */
  private async hasExistingAINote(item: Zotero.Item): Promise<boolean> {
    try {
      const noteIDs: number[] = (item as any).getNotes?.() || [];
      if (noteIDs.length === 0) return false;

      const notes = await Zotero.Items.getAsync(noteIDs);
      for (const n of notes) {
        if (!n) continue;

        const tags: Array<{ tag: string }> = (n as any).getTags?.() || [];
        const noteHtml: string = (n as any).getNote?.() || "";
        if (isRegularSummaryNote(tags, noteHtml)) return true;
      }
      return false;
    } catch (error) {
      this.log(
        `[LibraryScanner] 检查 AI 笔记失败: item=${this.getItemDebugID(item)}, title="${this.getItemTitle(item)}"`,
        error,
      );
      return false;
    }
  }

  private async collectUnprocessedItems(
    itemIDs: number[],
    libraryLabel: string,
    scanId: number,
  ): Promise<Map<number, Zotero.Item>> {
    const result = new Map<number, Zotero.Item>();
    let checkedCount = 0;
    let withAINoteCount = 0;
    let withoutAnalyzableCount = 0;
    let skippedCount = 0;

    for (const itemID of itemIDs) {
      if (!this.isCurrentScan(scanId)) return result;

      checkedCount++;
      if (checkedCount === 1 || checkedCount % 100 === 0) {
        this.setInfo(
          `正在扫描「${libraryLabel}」... ${checkedCount}/${itemIDs.length}`,
        );
        await this.yieldToUI();
      }

      const item = await this.getLoadedItem(itemID);
      if (!item || !this.shouldScanItem(item)) {
        skippedCount++;
        continue;
      }

      const hasNote = await this.hasExistingAINote(item);
      if (hasNote) {
        withAINoteCount++;
        continue;
      }

      const hasAnalyzable =
        await ContentExtractor.hasAnalyzableAttachment(item);
      if (!hasAnalyzable) {
        withoutAnalyzableCount++;
        continue;
      }

      result.set(itemID, item);
    }

    this.log(
      `[LibraryScanner] 条目检查完成: library="${libraryLabel}", checked=${checkedCount}, skipped=${skippedCount}, withAINote=${withAINoteCount}, withoutAnalyzable=${withoutAnalyzableCount}, withoutAINote=${result.size}`,
    );
    return result;
  }

  private shouldScanItem(item: Zotero.Item): boolean {
    try {
      const isRegularItem = (item as any).isRegularItem;
      if (typeof isRegularItem === "function") {
        return Boolean(isRegularItem.call(item)) && this.isTopLevelItem(item);
      }

      return (
        !item.isNote() && !item.isAttachment() && this.isTopLevelItem(item)
      );
    } catch (error) {
      this.log(
        `[LibraryScanner] 条目基础信息不可用，跳过: item=${this.getItemDebugID(item)}`,
        error,
      );
      return false;
    }
  }

  private async getLibraryTopLevelItemIDs(
    libraryID: number,
  ): Promise<number[]> {
    try {
      return await Zotero.Items.getAll(libraryID, true, false, true);
    } catch (error) {
      this.log(
        `[LibraryScanner] 获取库条目 ID 失败，跳过该库条目扫描: libraryID=${libraryID}`,
        error,
      );
      return [];
    }
  }

  private async getLoadedItem(itemID: number): Promise<Zotero.Item | null> {
    let item: Zotero.Item | null = null;

    try {
      item = await Zotero.Items.getAsync(itemID);
    } catch (error) {
      this.log(`[LibraryScanner] 获取条目失败，跳过: itemID=${itemID}`, error);
      return null;
    }

    if (!item) {
      this.log(`[LibraryScanner] 条目不存在，跳过: itemID=${itemID}`);
      return null;
    }

    if (!this.shouldScanItem(item)) {
      return null;
    }

    try {
      await item.loadAllData();
    } catch (error) {
      this.log(
        `[LibraryScanner] 条目完整数据加载失败，跳过: itemID=${itemID}, item=${this.getItemDebugID(item)}`,
        error,
      );
      return null;
    }

    if (!this.shouldScanItem(item)) {
      return null;
    }

    return item;
  }

  private getChildCollections(
    collection: Zotero.Collection,
  ): Zotero.Collection[] {
    try {
      return Zotero.Collections.getByParent(collection.id) || [];
    } catch (error) {
      this.log(
        `[LibraryScanner] 读取子分类失败，跳过: collectionID=${collection.id}, name="${collection.name}"`,
        error,
      );
      return [];
    }
  }

  private getCollectionChildItemIDs(collection: Zotero.Collection): number[] {
    try {
      return collection.getChildItems(true);
    } catch (error) {
      this.log(
        `[LibraryScanner] 读取分类条目 ID 失败，跳过分类条目: collectionID=${collection.id}, name="${collection.name}"`,
        error,
      );
      return [];
    }
  }

  private getItemTitle(item: Zotero.Item): string {
    const fallback = `未命名条目 ${this.getItemDebugID(item)}`;

    try {
      const displayTitle = item.getDisplayTitle?.();
      if (displayTitle?.trim()) {
        return this.toSafeDOMText(displayTitle, fallback);
      }
    } catch {
      // Fall back to the raw title field or item id below.
    }

    try {
      const title = item.getField("title") as string;
      if (title?.trim()) {
        return this.toSafeDOMText(title, fallback);
      }
    } catch (error) {
      this.log(
        `[LibraryScanner] 读取条目标题失败，使用占位标题: item=${this.getItemDebugID(item)}`,
        error,
      );
    }

    return fallback;
  }

  private getItemDebugID(item: Zotero.Item): string {
    const libraryID = this.getSafeItemValue(item, "libraryID") || "?";
    const key = this.getSafeItemValue(item, "key");
    const id = this.getSafeItemValue(item, "id") || "?";
    return key ? `${libraryID}/${key}` : `${libraryID}/#${id}`;
  }

  private getSafeItemValue(
    item: Zotero.Item,
    key: "id" | "key" | "libraryID",
  ): string {
    try {
      const value = item[key];
      return value === undefined || value === null ? "" : String(value);
    } catch {
      return "";
    }
  }

  private isTopLevelItem(item: Zotero.Item): boolean {
    const isTopLevelItem = (item as any).isTopLevelItem;
    if (typeof isTopLevelItem === "function") {
      return Boolean(isTopLevelItem.call(item));
    }

    const parentItemID = (item as any).parentItemID;
    const parentID = (item as any).parentID;
    return !parentItemID && !parentID;
  }

  private toSafeDOMText(value: unknown, fallback = ""): string {
    const raw =
      value === undefined || value === null ? fallback : String(value);
    let safe = "";

    for (let i = 0; i < raw.length; i++) {
      const code = raw.charCodeAt(i);

      if (code >= 0xd800 && code <= 0xdbff) {
        const next = raw.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          safe += raw[i] + raw[i + 1];
          i++;
        } else {
          safe += " ";
        }
        continue;
      }

      if (code >= 0xdc00 && code <= 0xdfff) {
        safe += " ";
        continue;
      }

      if (
        code === 0x9 ||
        code === 0xa ||
        code === 0xd ||
        (code >= 0x20 && code <= 0xd7ff) ||
        (code >= 0xe000 && code <= 0xfffd)
      ) {
        safe += raw[i];
      } else {
        safe += " ";
      }
    }

    return safe.trim() ? safe : fallback;
  }

  private prepareScanUI(): void {
    this.treeRoot = [];
    this.totalUnprocessed = 0;
    this.selectedCount = 0;
    this.setInfo("正在扫描 Zotero 库...");
    if (this.treeContainer) {
      this.treeContainer.innerHTML = "";
    }
    this.updateSelectedCount();
  }

  private showScanError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const errorDetails = this.formatErrorDetails(error);
    this.setInfo(`扫描失败: ${message}`);

    if (this.treeContainer) {
      this.treeContainer.innerHTML = "";
      const copyButton = this.createElement("button", {
        styles: {
          padding: "7px 14px",
          border: "1px solid #b00020",
          borderRadius: "4px",
          backgroundColor: "#fff",
          color: "#b00020",
          cursor: "pointer",
          fontSize: "13px",
          fontWeight: "600",
          alignSelf: "flex-start",
        },
        textContent: "复制错误详情",
      }) as HTMLButtonElement;

      copyButton.addEventListener("click", () => {
        void this.copyErrorDetails(errorDetails, copyButton);
      });

      const errorMessage = this.createElement("div", {
        styles: {
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          padding: "24px",
          color: "#b00020",
          fontSize: "14px",
          lineHeight: "1.6",
          backgroundColor: "#fff",
          border: "1px solid rgba(176, 0, 32, 0.25)",
          borderRadius: "6px",
        },
        children: [
          this.createElement("strong", {
            styles: {
              fontSize: "15px",
            },
            textContent: "扫描过程中出现错误",
          }),
          this.createElement("div", {
            textContent: this.toSafeDOMText(message, "Unknown error"),
          }),
          copyButton,
          this.createElement("pre", {
            styles: {
              margin: "0",
              padding: "12px",
              maxHeight: "360px",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              userSelect: "text",
              backgroundColor: "#fff5f6",
              border: "1px solid rgba(176, 0, 32, 0.18)",
              borderRadius: "4px",
              color: "#4a1018",
              fontSize: "12px",
              lineHeight: "1.5",
            },
            textContent: this.toSafeDOMText(errorDetails),
          }),
        ],
      });
      this.treeContainer.appendChild(errorMessage);
    }

    this.updateSelectedCount();
  }

  private formatErrorDetails(error: unknown): string {
    const lines = [
      "AI-Butler library scanner error",
      `generatedAt: ${new Date().toISOString()}`,
      `view: LibraryScannerView`,
    ];

    if (error instanceof Error) {
      lines.push(`name: ${error.name || "Error"}`);
      lines.push(`message: ${error.message || ""}`);
      if (error.stack) {
        lines.push("stack:");
        lines.push(error.stack);
      }

      const cause = (error as Error & { cause?: unknown }).cause;
      if (cause !== undefined) {
        lines.push("cause:");
        lines.push(this.formatUnknownError(cause));
      }
    } else {
      lines.push(this.formatUnknownError(error));
    }

    return this.toSafeDOMText(lines.join("\n"));
  }

  private formatUnknownError(error: unknown): string {
    if (error instanceof Error) {
      return [error.name, error.message, error.stack]
        .filter(Boolean)
        .join("\n");
    }

    if (typeof error === "string") {
      return error;
    }

    try {
      return JSON.stringify(error, null, 2) || String(error);
    } catch {
      return String(error);
    }
  }

  private async copyErrorDetails(
    text: string,
    button?: HTMLButtonElement,
  ): Promise<void> {
    const doc =
      this.container?.ownerDocument || Zotero.getMainWindow().document;
    const win = doc.defaultView || Zotero.getMainWindow();
    const clipboard = win.navigator?.clipboard;

    try {
      if (clipboard?.writeText) {
        await clipboard.writeText(text);
      } else {
        throw new Error("clipboard api unavailable");
      }
    } catch {
      try {
        const host = doc.body || doc.documentElement;
        if (!host) {
          throw new Error("document host unavailable");
        }

        const textarea = doc.createElement("textarea");
        textarea.value = text;
        Object.assign(textarea.style, {
          position: "fixed",
          left: "-9999px",
          top: "0",
        });
        host.appendChild(textarea);
        textarea.focus();
        textarea.select();
        doc.execCommand("copy");
        textarea.remove();
      } catch {
        new ztoolkit.ProgressWindow("AI Butler", { closeTime: 2200 })
          .createLine({
            text: "复制失败，可手动选择错误文本",
            type: "fail",
          })
          .show();
        return;
      }
    }

    if (button) {
      const previousText = button.textContent || "复制错误详情";
      button.textContent = "已复制";
      button.disabled = true;
      button.style.cursor = "default";
      void Zotero.Promise.delay(1500).then(() => {
        button.textContent = previousText;
        button.disabled = false;
        button.style.cursor = "pointer";
      });
    }

    new ztoolkit.ProgressWindow("AI Butler", { closeTime: 1500 })
      .createLine({ text: "已复制错误详情", type: "success" })
      .show();
  }

  private setInfo(message: string): void {
    const infoElement = this.container?.querySelector("#scanner-info");
    if (infoElement) {
      infoElement.textContent = this.toSafeDOMText(message);
    }
  }

  private isCurrentScan(scanId: number): boolean {
    return scanId === this.activeScanId;
  }

  private async yieldToUI(): Promise<void> {
    await Zotero.Promise.delay(0);
  }

  private log(message: string, error?: unknown): void {
    try {
      if (error === undefined) {
        ztoolkit.log(message);
      } else {
        ztoolkit.log(message, error);
      }
    } catch {
      // Ignore logging failures.
    }

    if (error !== undefined) {
      try {
        Zotero.log(message, "error");
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        );
      } catch {
        // Ignore Zotero error-console logging failures.
      }
    }

    try {
      if (error === undefined) {
        console.log(message);
      } else {
        console.error(message, error);
      }
    } catch {
      // Ignore logging failures.
    }
  }

  /**
   * 更新 UI
   */
  private updateUI(): void {
    // 更新头部信息
    const infoElement = this.container?.querySelector("#scanner-info");
    if (infoElement) {
      if (this.totalUnprocessed === 0) {
        infoElement.innerHTML = "🎉 所有文献都已分析完成!";
      } else {
        infoElement.innerHTML = `发现 <strong>${this.totalUnprocessed}</strong> 篇文献未进行 AI 分析`;
      }
    }

    // 更新树形结构
    if (this.treeContainer) {
      this.treeContainer.innerHTML = "";
      if (this.totalUnprocessed === 0) {
        const emptyMessage = this.createElement("div", {
          styles: {
            textAlign: "center",
            padding: "40px",
            color: "#999",
            fontSize: "16px",
          },
          innerHTML: "🎉<br><br>所有文献都已分析完成!",
        });
        this.treeContainer.appendChild(emptyMessage);
      } else {
        // 创建全选根节点
        const selectAllNode = this.createSelectAllNode();
        this.treeContainer.appendChild(selectAllNode);

        // 渲染树形结构
        this.renderTree(this.treeContainer, this.treeRoot);
      }
    }

    // 更新选择计数
    this.updateSelectedCount();
  }

  /**
   * 创建全选节点
   */
  private createSelectAllNode(): HTMLElement {
    const wrapper = this.createElement("div", {
      styles: {
        marginBottom: "15px",
        paddingBottom: "15px",
        borderBottom: "2px solid #667eea",
      },
    });

    const content = this.createElement("div", {
      styles: {
        display: "flex",
        alignItems: "center",
        padding: "12px 15px",
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        borderRadius: "6px",
        cursor: "pointer",
        transition: "all 0.2s",
      },
    });

    // 复选框
    const checkbox = this.createElement("input", {
      attributes: {
        type: "checkbox",
      },
      styles: {
        marginRight: "12px",
        cursor: "pointer",
        width: "18px",
        height: "18px",
      },
    }) as HTMLInputElement;

    checkbox.addEventListener("change", () => {
      this.toggleAllNodes(checkbox.checked);
      this.updateSelectedCount();
    });

    // 标签
    const label = this.createElement("span", {
      styles: {
        flex: "1",
        fontSize: "16px",
        fontWeight: "600",
        color: "#fff",
      },
      innerHTML: `📚 全选/全不选 (共 ${this.totalUnprocessed} 篇未分析)`,
    });

    content.appendChild(checkbox);
    content.appendChild(label);

    // 悬停效果
    content.addEventListener("mouseenter", () => {
      content.style.transform = "translateY(-2px)";
      content.style.boxShadow = "0 4px 12px rgba(102, 126, 234, 0.4)";
    });
    content.addEventListener("mouseleave", () => {
      content.style.transform = "translateY(0)";
      content.style.boxShadow = "none";
    });

    // 点击内容也触发复选框
    content.addEventListener("click", (e) => {
      if (e.target !== checkbox) {
        checkbox.checked = !checkbox.checked;
        // 直接调用而非依赖 dispatchEvent，确保在 XUL 环境下正常工作
        this.toggleAllNodes(checkbox.checked);
        this.updateSelectedCount();
      }
    });

    wrapper.appendChild(content);
    return wrapper;
  }

  /**
   * 切换所有节点
   */
  private toggleAllNodes(checked: boolean): void {
    // 第一阶段：更新所有节点的数据模型
    for (const node of this.treeRoot) {
      this.updateCheckedStateRecursive(node, checked);
    }

    // 第二阶段：更新 UI（展开节点、渲染子节点、更新复选框）
    for (const node of this.treeRoot) {
      this.updateNodeUIRecursive(node, checked);
    }
  }

  /**
   * 递归更新节点的 checked 状态（仅更新数据模型）
   */
  private updateCheckedStateRecursive(node: TreeNode, checked: boolean): void {
    node.checked = checked;
    for (const child of node.children) {
      this.updateCheckedStateRecursive(child, checked);
    }
  }

  /**
   * 递归更新节点的 UI（复选框状态、展开状态）
   */
  private updateNodeUIRecursive(node: TreeNode, checked: boolean): void {
    // 更新已渲染节点的复选框 UI
    if (node.checkboxElement) {
      node.checkboxElement.checked = checked;
    }

    // 如果选中且是收藏夹，展开节点
    if (checked && node.type === "collection" && node.children.length > 0) {
      node.expanded = true;
      this.updateNodeVisibility(node);
    }

    // 递归处理子节点
    for (const child of node.children) {
      this.updateNodeUIRecursive(child, checked);
    }
  }

  /**
   * 递归切换节点及其所有子节点（用于单个节点的切换）
   */
  private toggleNodeRecursive(node: TreeNode, checked: boolean): void {
    node.checked = checked;

    // 更新复选框 UI
    if (node.checkboxElement) {
      node.checkboxElement.checked = checked;
    }

    // 先递归处理所有子节点的 checked 状态（确保数据模型正确）
    for (const child of node.children) {
      this.toggleNodeRecursive(child, checked);
    }

    // 最后展开节点（此时子节点的 checked 状态已正确设置）
    if (checked && node.type === "collection" && node.children.length > 0) {
      node.expanded = true;
      this.updateNodeVisibility(node);
    }
  }

  /**
   * 渲染树形结构
   */
  private renderTree(
    container: HTMLElement,
    nodes: TreeNode[],
    level: number = 0,
  ): void {
    for (const node of nodes) {
      const nodeElement = this.createTreeNode(node, level);
      container.appendChild(nodeElement);
    }
  }

  /**
   * 创建树节点元素
   */
  private createTreeNode(node: TreeNode, level: number): HTMLElement {
    const nodeWrapper = this.createElement("div", {
      styles: {
        position: "relative",
      },
    });

    // 保存 DOM 引用
    node.element = nodeWrapper;

    const nodeContent = this.createElement("div", {
      styles: {
        display: "flex",
        alignItems: "center",
        padding: "8px 10px",
        paddingLeft: `${level * 24 + 10}px`, // 根据层级缩进
        background: "#fff",
        borderRadius: "4px",
        border: "1px solid #e0e0e0",
        cursor: "pointer",
        transition: "all 0.2s",
        position: "relative",
      },
    });

    // 绘制树形线条
    if (level > 0) {
      const treeLines = this.createElement("div", {
        styles: {
          position: "absolute",
          left: `${(level - 1) * 24 + 10}px`,
          top: "0",
          bottom: "0",
          width: "24px",
          pointerEvents: "none",
        },
      });

      // 横线
      const horizontalLine = this.createElement("div", {
        styles: {
          position: "absolute",
          left: "0",
          top: "50%",
          width: "12px",
          height: "1px",
          background: "#ccc",
        },
      });

      // 竖线
      const verticalLine = this.createElement("div", {
        styles: {
          position: "absolute",
          left: "0",
          top: "0",
          bottom: "50%",
          width: "1px",
          background: "#ccc",
        },
      });

      treeLines.appendChild(horizontalLine);
      treeLines.appendChild(verticalLine);
      nodeContent.appendChild(treeLines);
    }

    // 展开/折叠图标 (仅对有子节点的集合显示)
    let expandIcon: HTMLElement | null = null;
    if (node.type === "collection" && node.children.length > 0) {
      expandIcon = this.createElement("span", {
        styles: {
          marginRight: "8px",
          fontSize: "12px",
          color: "#666",
          cursor: "pointer",
          userSelect: "none",
          width: "16px",
          textAlign: "center",
        },
        textContent: node.expanded ? "▼" : "▶",
      });

      expandIcon.addEventListener("click", (e) => {
        e.stopPropagation();
        node.expanded = !node.expanded;
        expandIcon!.textContent = node.expanded ? "▼" : "▶";
        this.updateNodeVisibility(node);
        if (node.expanded) {
          this.renderChildren(node, level + 1);
        }
      });
    }

    // 复选框
    const checkbox = this.createElement("input", {
      attributes: {
        type: "checkbox",
      },
      styles: {
        marginRight: "10px",
        cursor: "pointer",
      },
    }) as HTMLInputElement;

    checkbox.checked = node.checked;
    node.checkboxElement = checkbox; // 保存引用

    checkbox.addEventListener("change", (e) => {
      e.stopPropagation();
      this.toggleNode(node, checkbox.checked);
      this.updateSelectedCount();
    });

    // 图标和名称
    // 使用 textContent 而非 innerHTML，避免论文标题中的特殊字符（如 <, >, &）导致 XML 解析错误
    const icon = node.type === "collection" ? "📁" : "📄";
    const label = this.createElement("span", {
      styles: {
        flex: "1",
        fontSize: "14px",
      },
      textContent: this.toSafeDOMText(`${icon} ${node.name}`, icon),
    });

    // 子项数量
    if (node.type === "collection" && node.children.length > 0) {
      const count = this.createElement("span", {
        styles: {
          fontSize: "12px",
          color: "#999",
          marginLeft: "10px",
        },
        textContent: `(${node.children.length})`,
      });
      label.appendChild(count);
    }

    if (expandIcon) {
      nodeContent.appendChild(expandIcon);
    }
    nodeContent.appendChild(checkbox);
    nodeContent.appendChild(label);

    // 悬停效果
    nodeContent.addEventListener("mouseenter", () => {
      nodeContent.style.background = "#f5f5f5";
      nodeContent.style.borderColor = "#667eea";
    });
    nodeContent.addEventListener("mouseleave", () => {
      nodeContent.style.background = "#fff";
      nodeContent.style.borderColor = "#e0e0e0";
    });

    // 点击节点行展开/折叠或选中
    nodeContent.addEventListener("click", (e) => {
      // 如果点击的不是复选框或展开图标
      if (e.target !== checkbox && e.target !== expandIcon) {
        // 切换选中状态（对所有节点类型都生效）
        checkbox.checked = !checkbox.checked;
        this.toggleNode(node, checkbox.checked);
        this.updateSelectedCount();

        // 有子节点的集合: 同时切换展开状态
        if (node.type === "collection" && node.children.length > 0) {
          node.expanded = !node.expanded;
          if (expandIcon) {
            expandIcon.textContent = node.expanded ? "▼" : "▶";
          }
          this.updateNodeVisibility(node);
          if (node.expanded) {
            this.renderChildren(node, level + 1);
          }
        }
      }
    });

    nodeWrapper.appendChild(nodeContent);

    // 懒渲染: 初次不生成所有子节点 DOM, 仅创建占位容器, 展开时再渲染
    if (node.children.length > 0) {
      // 当子节点数量超过阈值时，限制高度并添加滚动
      const needsScroll = node.children.length > 20;
      const childrenContainer = this.createElement("div", {
        styles: {
          display: node.expanded ? "block" : "none",
          marginTop: "2px",
          ...(needsScroll && {
            maxHeight: "400px",
            overflowY: "auto",
            border: "1px solid #e0e0e0",
            borderRadius: "4px",
            backgroundColor: "#fafafa",
            padding: "4px",
          }),
        },
      });
      node.childrenContainer = childrenContainer;
      nodeWrapper.appendChild(childrenContainer);
      if (node.expanded) {
        this.renderChildren(node, level + 1);
      }
    }

    return nodeWrapper;
  }

  /**
   * 更新节点子元素的可见性
   */
  private updateNodeVisibility(node: TreeNode): void {
    if (node.childrenContainer) {
      node.childrenContainer.style.display = node.expanded ? "block" : "none";
      if (node.expanded) {
        this.renderChildren(node, this.getNodeDepth(node));
      }
    }
  }

  /**
   * 懒渲染子节点列表
   */
  private renderChildren(node: TreeNode, level: number): void {
    if (!node.childrenContainer || node.childrenRendered) return;
    const frag = Zotero.getMainWindow().document.createDocumentFragment();
    for (const child of node.children) {
      const el = this.createTreeNode(child, level);
      frag.appendChild(el);
    }
    node.childrenContainer.appendChild(frag);
    node.childrenRendered = true;
  }

  /**
   * 计算节点深度 (用于懒渲染时子节点缩进)
   */
  private getNodeDepth(node: TreeNode): number {
    let depth = 0;
    let current = node.parentNode;
    while (current) {
      depth++;
      current = current.parentNode;
    }
    return depth + 1; // 子节点深度 = 父节点深度 + 1
  }

  /**
   * 切换节点选中状态(递归)
   */
  private toggleNode(node: TreeNode, checked: boolean): void {
    node.checked = checked;

    // 更新复选框 UI
    if (node.checkboxElement) {
      node.checkboxElement.checked = checked;
    }

    // 如果被选中且有子节点,展开该节点
    if (checked && node.type === "collection" && node.children.length > 0) {
      node.expanded = true;
      this.updateNodeVisibility(node);
      // 更新展开图标
      const expandIcon = node.element?.querySelector("span") as HTMLElement;
      if (expandIcon && expandIcon.textContent) {
        expandIcon.textContent = "▼";
      }
      // 展开时进行懒渲染
      this.renderChildren(node, this.getNodeDepth(node));
    }

    // 递归处理所有子节点
    for (const child of node.children) {
      this.toggleNode(child, checked);
    }

    // 更新父节点状态
    if (node.parentNode) {
      this.updateParentCheckState(node.parentNode);
    }
  }

  /**
   * 更新父节点的选中状态
   */
  private updateParentCheckState(node: TreeNode): void {
    const allChecked = node.children.every((child) => child.checked);
    const someChecked = node.children.some(
      (child) => child.checked || this.hasCheckedChildren(child),
    );

    node.checked = allChecked || someChecked;

    // 更新复选框 UI
    if (node.checkboxElement) {
      node.checkboxElement.checked = node.checked;
    }

    if (node.parentNode) {
      this.updateParentCheckState(node.parentNode);
    }
  }

  /**
   * 检查节点是否有选中的子节点
   */
  private hasCheckedChildren(node: TreeNode): boolean {
    if (node.checked) return true;
    return node.children.some((child) => this.hasCheckedChildren(child));
  }

  /**
   * 更新选择计数
   */
  private updateSelectedCount(): void {
    this.selectedCount = this.countSelectedItems(this.treeRoot);
    if (this.selectedCountElement) {
      this.selectedCountElement.innerHTML = `已选择: <strong>${this.selectedCount}</strong> 篇`;
    }

    // 更新按钮状态
    const confirmButton = this.container?.querySelector(
      "#scanner-confirm-btn",
    ) as HTMLButtonElement;
    if (confirmButton) {
      confirmButton.disabled = this.selectedCount === 0;
      confirmButton.style.opacity = this.selectedCount === 0 ? "0.5" : "1";
      confirmButton.style.cursor =
        this.selectedCount === 0 ? "not-allowed" : "pointer";
    }
  }

  /**
   * 统计选中的条目数量
   */
  private countSelectedItems(
    nodes: TreeNode[],
    seenItemIDs: Set<number> = new Set(),
  ): number {
    let count = 0;
    for (const node of nodes) {
      if (
        node.type === "item" &&
        node.checked &&
        node.item &&
        !seenItemIDs.has(node.item.id)
      ) {
        seenItemIDs.add(node.item.id);
        count++;
      }
      count += this.countSelectedItems(node.children, seenItemIDs);
    }
    return count;
  }

  /**
   * 处理确认操作
   */
  private handleConfirm(): void {
    const selectedItems = this.collectSelectedItems(this.treeRoot);

    if (selectedItems.length === 0) {
      new ztoolkit.ProgressWindow("AI 管家")
        .createLine({ text: "请先选择要分析的文献", type: "default" })
        .show();
      return;
    }

    // 批量添加到队列
    for (const item of selectedItems) {
      this.taskQueueManager.addTask(item, false);
    }

    new ztoolkit.ProgressWindow("AI 管家")
      .createLine({
        text: `✅ 已将 ${selectedItems.length} 篇文献添加到队列`,
        type: "success",
      })
      .show();

    // 切换到任务队列视图
    MainWindow.getInstance().switchTab("tasks");
  }

  /**
   * 收集所有选中的条目
   */
  private collectSelectedItems(
    nodes: TreeNode[],
    seenItemIDs: Set<number> = new Set(),
  ): Zotero.Item[] {
    const items: Zotero.Item[] = [];
    for (const node of nodes) {
      if (
        node.type === "item" &&
        node.checked &&
        node.item &&
        !seenItemIDs.has(node.item.id)
      ) {
        seenItemIDs.add(node.item.id);
        items.push(node.item);
      }
      items.push(...this.collectSelectedItems(node.children, seenItemIDs));
    }
    return items;
  }
}
