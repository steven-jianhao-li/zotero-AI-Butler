/**
 * ================================================================
 * 库扫描对话框
 * ================================================================
 * 
 * 本模块提供一个交互式对话框，用于扫描整个 Zotero 库，
 * 显示所有未分析的文献，并允许用户通过树形结构选择要分析的条目
 * 
 * 主要职责:
 * 1. 扫描所有收藏夹和条目
 * 2. 检测哪些条目缺少 AI 笔记
 * 3. 以树形结构展示扫描结果（支持多级目录）
 * 4. 提供父子联动的复选框选择逻辑
 * 5. 将用户选择的条目批量加入队列
 * 
 * @module libraryScannerDialog
 * @author AI-Butler Team
 */

import { TaskQueueManager } from "./taskQueue";

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
}

/**
 * 库扫描对话框类
 */
export class LibraryScannerDialog {
  private dialog: any = null;
  private treeRoot: TreeNode[] = [];
  private totalUnprocessed: number = 0;
  private selectedCount: number = 0;

  /**
   * 打开扫描对话框
   */
  public static async open(): Promise<void> {
    const scanner = new LibraryScannerDialog();
    await scanner.show();
  }

  /**
   * 显示对话框
   */
  private async show(): Promise<void> {
    // 先扫描库
    await this.scanLibrary();

    if (this.totalUnprocessed === 0) {
      // 没有未处理的条目
      new ztoolkit.ProgressWindow("AI 管家", {
        closeTime: 3000,
      })
        .createLine({
          text: "🎉 所有文献都已分析完成！",
          type: "success",
        })
        .show();
      return;
    }

    // 使用简单的 HTML 对话框而不是 ztoolkit.Dialog
    const doc = Zotero.getMainWindow().document;
    const dialogWin = doc.defaultView?.openDialog(
      "chrome://zotero/content/standalone/standalone.xhtml",
      "",
      "chrome,centerscreen,resizable=yes,width=700,height=600",
      null
    );

    if (!dialogWin) {
      ztoolkit.log("[LibraryScanner] Failed to open dialog");
      return;
    }

    // 等待窗口加载完成
    await new Promise<void>((resolve) => {
      if (dialogWin.document.readyState === "complete") {
        resolve();
      } else {
        dialogWin.addEventListener("load", () => resolve(), { once: true });
      }
    });

    // 渲染对话框内容
    this.renderDialog(dialogWin);
  }

  /**
   * 扫描整个库
   */
  private async scanLibrary(): Promise<void> {
    this.treeRoot = [];
    this.totalUnprocessed = 0;

    // 获取所有库
    const libraries = Zotero.Libraries.getAll();

    for (const library of libraries) {
      // 跳过订阅库（只读）
      if (library.libraryType === "feed") {
        continue;
      }

      const libraryNode: TreeNode = {
        id: `lib-${library.libraryID}`,
        type: "collection",
        name: library.name,
        children: [],
        checked: false,
      };

      // 扫描库中的所有收藏夹
      const collections = Zotero.Collections.getByLibrary(library.libraryID);
      for (const collection of collections) {
        // 只处理顶层收藏夹
        if (!collection.parentID) {
          const node = await this.buildCollectionNode(collection);
          if (node) {
            node.parentNode = libraryNode;
            libraryNode.children.push(node);
          }
        }
      }

      // 扫描库中未归类的条目
      const unfiledItems = await this.getUnfiledItems(library.libraryID);
      if (unfiledItems.length > 0) {
        const unfiledNode: TreeNode = {
          id: `unfiled-${library.libraryID}`,
          type: "collection",
          name: "未分类文献",
          children: [],
          checked: false,
          parentNode: libraryNode,
        };

        for (const item of unfiledItems) {
          const itemNode = await this.buildItemNode(item);
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
    }
  }

  /**
   * 构建收藏夹节点（递归）
   */
  private async buildCollectionNode(
    collection: Zotero.Collection
  ): Promise<TreeNode | null> {
    const node: TreeNode = {
      id: `col-${collection.id}`,
      type: "collection",
      name: collection.name,
      collection,
      children: [],
      checked: false,
    };

    // 递归处理子收藏夹
    const childCollections = Zotero.Collections.getByParent(collection.id);
    for (const child of childCollections) {
      const childNode = await this.buildCollectionNode(child);
      if (childNode) {
        childNode.parentNode = node;
        node.children.push(childNode);
      }
    }

    // 处理收藏夹中的条目
    const items = collection.getChildItems();
    for (const item of items) {
      const itemNode = await this.buildItemNode(item);
      if (itemNode) {
        itemNode.parentNode = node;
        node.children.push(itemNode);
      }
    }

    // 如果收藏夹没有未处理的条目，不显示
    return node.children.length > 0 ? node : null;
  }

  /**
   * 构建条目节点
   */
  private async buildItemNode(item: Zotero.Item): Promise<TreeNode | null> {
    // 只处理常规条目
    if (
      item.isNote() ||
      item.isAttachment() ||
      item.parentID ||
      !item.getField("title")
    ) {
      return null;
    }

    // 检查是否已有 AI 笔记
    const hasAINote = await this.hasExistingAINote(item);
    if (hasAINote) {
      return null;
    }

    // 计数
    this.totalUnprocessed++;

    const title = item.getField("title") as string;
    return {
      id: `item-${item.id}`,
      type: "item",
      name: title,
      item,
      children: [],
      checked: false,
    };
  }

  /**
   * 获取未归类的条目
   */
  private async getUnfiledItems(libraryID: number): Promise<Zotero.Item[]> {
    const search = new Zotero.Search();
    (search as any).libraryID = libraryID;
    search.addCondition("noChildren", "true");
    search.addCondition("collectionID", "isNot", "any");

    const ids = await search.search();
    const items: Zotero.Item[] = [];

    for (const id of ids) {
      const item = await Zotero.Items.getAsync(id);
      if (item && !item.isNote() && !item.isAttachment() && !item.parentID) {
        items.push(item);
      }
    }

    return items;
  }

  /**
   * 检查条目是否已有 AI 笔记
   */
  private async hasExistingAINote(item: Zotero.Item): Promise<boolean> {
    try {
      const noteIDs = (item as any).getNotes?.() || [];
      for (const nid of noteIDs) {
        const n = await Zotero.Items.getAsync(nid);
        if (!n) continue;

        const tags: Array<{ tag: string }> = (n as any).getTags?.() || [];
        if (tags.some((t) => t.tag === "AI-Generated")) return true;

        const noteHtml: string = (n as any).getNote?.() || "";
        if (/<h2>\s*AI 管家\s*-/.test(noteHtml)) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * 渲染对话框内容
   */
  private renderDialog(win: Window): void {
    const doc = win.document;
    
    // 设置窗口标题
    if (doc.title) {
      doc.title = "扫描未分析文献 - AI 管家";
    }

    // 创建根容器
    const root = doc.createElement("div");
    root.id = "scanner-dialog-root";
    root.style.cssText = `
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      font-family: system-ui, -apple-system, sans-serif;
    `;

    // 清空 body 并添加根容器
    const body = doc.body;
    if (!body) {
      ztoolkit.log("[LibraryScanner] No body element found");
      return;
    }
    body.innerHTML = "";
    body.style.cssText = "margin: 0; padding: 0; overflow: hidden;";
    body.appendChild(root);

    // 头部信息
    const header = doc.createElement("div");
    header.style.cssText = `
      padding: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 8px 8px 0 0;
    `;
    header.innerHTML = `
      <h2 style="margin: 0 0 10px 0; font-size: 18px;">📚 库扫描结果</h2>
      <p style="margin: 0; font-size: 14px; opacity: 0.9;">
        发现 <strong>${this.totalUnprocessed}</strong> 篇文献未进行 AI 分析
      </p>
    `;
    root.appendChild(header);

    // 树形结构容器
    const treeContainer = doc.createElement("div");
    treeContainer.id = "tree-container";
    treeContainer.style.cssText = `
      flex: 1;
      overflow: auto;
      padding: 15px;
      background: #f9f9f9;
    `;
    root.appendChild(treeContainer);

    // 渲染树
    this.renderTree(doc, treeContainer, this.treeRoot);

    // 底部操作栏
    const footer = doc.createElement("div");
    footer.style.cssText = `
      padding: 15px;
      background: white;
      border-top: 1px solid #ddd;
      display: flex;
      justify-content: space-between;
      align-items: center;
    `;

    const selectedLabel = doc.createElement("span");
    selectedLabel.id = "selected-count";
    selectedLabel.textContent = `已选择: 0 篇`;
    selectedLabel.style.color = "#666";
    footer.appendChild(selectedLabel);

    const buttonGroup = doc.createElement("div");
    buttonGroup.style.display = "flex";
    buttonGroup.style.gap = "10px";

    const cancelBtn = doc.createElement("button");
    cancelBtn.textContent = "取消";
    cancelBtn.style.cssText = `
      padding: 8px 20px;
      border: 1px solid #ddd;
      background: white;
      border-radius: 4px;
      cursor: pointer;
    `;
    cancelBtn.addEventListener("click", () => {
      win.close();
    });

    const confirmBtn = doc.createElement("button");
    confirmBtn.textContent = "确认并加入队列";
    confirmBtn.id = "confirm-btn";
    confirmBtn.style.cssText = `
      padding: 8px 20px;
      border: none;
      background: #59c0bc;
      color: white;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 600;
    `;
    confirmBtn.addEventListener("click", () => {
      this.handleConfirm(win);
    });

    buttonGroup.appendChild(cancelBtn);
    buttonGroup.appendChild(confirmBtn);
    footer.appendChild(buttonGroup);
    root.appendChild(footer);
  }

  /**
   * 渲染树形结构
   */
  private renderTree(
    doc: Document,
    container: HTMLElement,
    nodes: TreeNode[],
    level: number = 0
  ): void {
    for (const node of nodes) {
      const nodeEl = doc.createElement("div");
      nodeEl.style.marginLeft = `${level * 20}px`;
      nodeEl.style.marginBottom = "5px";

      const label = doc.createElement("label");
      label.style.cssText = `
        display: flex;
        align-items: center;
        padding: 8px;
        background: white;
        border-radius: 4px;
        cursor: pointer;
        transition: background 0.2s;
      `;
      label.addEventListener("mouseenter", () => {
        label.style.background = "#f0f0f0";
      });
      label.addEventListener("mouseleave", () => {
        label.style.background = "white";
      });

      const checkbox = doc.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = node.checked;
      checkbox.style.marginRight = "8px";
      checkbox.addEventListener("change", () => {
        this.handleCheckboxChange(node, checkbox.checked, doc);
      });

      const icon = node.type === "collection" ? "📁" : "📄";
      const text = doc.createElement("span");
      text.textContent = `${icon} ${node.name}`;
      text.style.fontSize = "14px";

      label.appendChild(checkbox);
      label.appendChild(text);
      nodeEl.appendChild(label);
      container.appendChild(nodeEl);

      // 递归渲染子节点
      if (node.children.length > 0) {
        this.renderTree(doc, container, node.children, level + 1);
      }
    }
  }

  /**
   * 处理复选框变化
   */
  private handleCheckboxChange(
    node: TreeNode,
    checked: boolean,
    doc: Document
  ): void {
    // 更新当前节点
    node.checked = checked;

    // 递归更新子节点
    this.updateChildrenChecked(node, checked);

    // 更新父节点
    this.updateParentChecked(node);

    // 重新计算选中数量
    this.updateSelectedCount(doc);
  }

  /**
   * 递归更新子节点选中状态
   */
  private updateChildrenChecked(node: TreeNode, checked: boolean): void {
    for (const child of node.children) {
      child.checked = checked;
      this.updateChildrenChecked(child, checked);
    }
  }

  /**
   * 更新父节点选中状态
   */
  private updateParentChecked(node: TreeNode): void {
    if (!node.parentNode) return;

    const parent = node.parentNode;
    const allChecked = parent.children.every((child) => child.checked);
    const anyChecked = parent.children.some((child) => child.checked);

    parent.checked = allChecked;

    // 递归更新祖先节点
    this.updateParentChecked(parent);
  }

  /**
   * 更新选中数量显示
   */
  private updateSelectedCount(doc: Document): void {
    this.selectedCount = this.countSelectedItems(this.treeRoot);

    const label = doc.getElementById("selected-count");
    if (label) {
      label.textContent = `已选择: ${this.selectedCount} 篇`;
    }

    // 更新确认按钮状态
    const btn = doc.getElementById("confirm-btn") as HTMLButtonElement;
    if (btn) {
      btn.disabled = this.selectedCount === 0;
      btn.style.opacity = this.selectedCount === 0 ? "0.5" : "1";
      btn.style.cursor = this.selectedCount === 0 ? "not-allowed" : "pointer";
    }

    // 重新渲染以更新复选框状态
    const container = doc.getElementById("tree-container");
    if (container) {
      container.innerHTML = "";
      this.renderTree(doc, container as HTMLElement, this.treeRoot);
    }
  }

  /**
   * 统计选中的条目数量
   */
  private countSelectedItems(nodes: TreeNode[]): number {
    let count = 0;
    for (const node of nodes) {
      if (node.type === "item" && node.checked) {
        count++;
      }
      count += this.countSelectedItems(node.children);
    }
    return count;
  }

  /**
   * 收集选中的条目
   */
  private collectSelectedItems(nodes: TreeNode[]): Zotero.Item[] {
    const items: Zotero.Item[] = [];
    for (const node of nodes) {
      if (node.type === "item" && node.checked && node.item) {
        items.push(node.item);
      }
      items.push(...this.collectSelectedItems(node.children));
    }
    return items;
  }

  /**
   * 处理确认操作
   */
  private async handleConfirm(win: Window): Promise<void> {
    const selectedItems = this.collectSelectedItems(this.treeRoot);

    if (selectedItems.length === 0) {
      return;
    }

    try {
      // 加入任务队列
      const manager = TaskQueueManager.getInstance();
      await manager.addTasks(selectedItems, false);

      // 关闭对话框
      win.close();

      // 显示成功提示
      new ztoolkit.ProgressWindow("AI 管家", {
        closeTime: 3000,
      })
        .createLine({
          text: `✅ 已将 ${selectedItems.length} 篇文献加入分析队列`,
          type: "success",
        })
        .show();
    } catch (error: any) {
      ztoolkit.log("[LibraryScanner] 加入队列失败:", error);
      new ztoolkit.ProgressWindow("AI 管家", {
        closeTime: 3000,
      })
        .createLine({
          text: `❌ 加入队列失败: ${error.message}`,
          type: "error",
        })
        .show();
    }
  }
}
