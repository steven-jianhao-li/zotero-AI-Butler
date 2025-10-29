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
    await super.show();
    await this.scanLibrary();
    this.updateUI();
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
      // 跳过订阅库(只读)
      if (library.libraryType === "feed") {
        continue;
      }

      const libraryNode: TreeNode = {
        id: `lib-${library.libraryID}`,
        type: "collection",
        name: library.name,
        children: [],
        checked: false,
        expanded: false, // 默认收起
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
          expanded: false, // 默认收起
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
   * 构建收藏夹节点(递归)
   */
  private async buildCollectionNode(
    collection: Zotero.Collection,
  ): Promise<TreeNode | null> {
    const node: TreeNode = {
      id: `col-${collection.id}`,
      type: "collection",
      name: collection.name,
      collection,
      children: [],
      checked: false,
      expanded: false, // 默认收起
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

    // 如果这个收藏夹没有未处理的子项,返回 null
    if (node.children.length === 0) {
      return null;
    }

    return node;
  }

  /**
   * 构建条目节点
   */
  private async buildItemNode(item: Zotero.Item): Promise<TreeNode | null> {
    // 跳过笔记、附件
    if (item.isNote() || item.isAttachment()) {
      return null;
    }

    // 检查是否已有 AI 笔记
    const hasNote = await this.hasExistingAINote(item);
    if (hasNote) {
      return null;
    }

    this.totalUnprocessed++;

    return {
      id: `item-${item.id}`,
      type: "item",
      name: item.getField("title") as string,
      item,
      children: [],
      checked: false,
      expanded: false, // 条目无子项,但为了一致性也加上
    };
  }

  /**
   * 获取未归类的条目
   */
  private async getUnfiledItems(libraryID: number): Promise<Zotero.Item[]> {
    const search = new Zotero.Search();
    (search as any).libraryID = libraryID;
    search.addCondition("unfiled", "true");
    search.addCondition("itemType", "isNot", "attachment");
    search.addCondition("itemType", "isNot", "note");

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
        checkbox.dispatchEvent(new Event("change"));
      }
    });

    wrapper.appendChild(content);
    return wrapper;
  }

  /**
   * 切换所有节点
   */
  private toggleAllNodes(checked: boolean): void {
    for (const node of this.treeRoot) {
      this.toggleNodeRecursive(node, checked);
    }
  }

  /**
   * 递归切换节点及其所有子节点
   */
  private toggleNodeRecursive(node: TreeNode, checked: boolean): void {
    node.checked = checked;

    // 更新复选框 UI
    if (node.checkboxElement) {
      node.checkboxElement.checked = checked;
    }

    // 如果被选中,展开节点
    if (checked && node.type === "collection" && node.children.length > 0) {
      node.expanded = true;
      this.updateNodeVisibility(node);
    }

    // 递归处理子节点
    for (const child of node.children) {
      this.toggleNodeRecursive(child, checked);
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
    const icon = node.type === "collection" ? "📁" : "📄";
    const label = this.createElement("span", {
      styles: {
        flex: "1",
        fontSize: "14px",
      },
      innerHTML: `${icon} ${node.name}`,
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
        // 有子节点的集合: 切换展开状态
        if (node.type === "collection" && node.children.length > 0) {
          node.expanded = !node.expanded;
          if (expandIcon) {
            expandIcon.textContent = node.expanded ? "▼" : "▶";
          }
          this.updateNodeVisibility(node);
        } else {
          // 叶子节点: 切换选中状态
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event("change"));
        }
      }
    });

    nodeWrapper.appendChild(nodeContent);

    // 递归渲染子节点
    if (node.children.length > 0) {
      const childrenContainer = this.createElement("div", {
        styles: {
          display: node.expanded ? "block" : "none", // 根据展开状态显示/隐藏
          marginTop: "2px",
        },
      });

      node.childrenContainer = childrenContainer; // 保存引用

      this.renderTree(childrenContainer, node.children, level + 1);
      nodeWrapper.appendChild(childrenContainer);
    }

    return nodeWrapper;
  }

  /**
   * 更新节点子元素的可见性
   */
  private updateNodeVisibility(node: TreeNode): void {
    if (node.childrenContainer) {
      node.childrenContainer.style.display = node.expanded ? "block" : "none";
    }
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
}
