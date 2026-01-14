/**
 * ================================================================
 * 文献综述视图
 * ================================================================
 *
 * 本模块提供文献综述配置和生成的视图界面
 *
 * 主要职责:
 * 1. 显示综述配置表单（名称、提示词）
 * 2. 以树形结构展示分类下的文献（仅显示有 PDF 的条目）
 * 3. 提供多选功能选择要纳入综述的文献
 * 4. 调用综述服务生成报告
 *
 * @module LiteratureReviewView
 * @author AI-Butler Team
 */

import { BaseView } from "./BaseView";
import { MainWindow } from "./MainWindow";
import { LiteratureReviewService } from "../literatureReviewService";
import { getString } from "../../utils/locale";
import {
  createInput,
  createTextarea,
  createStyledButton,
} from "./ui/components";
import { DEFAULT_LITERATURE_REVIEW_PROMPT } from "../../utils/prompts";

/**
 * PDF 附件节点接口
 */
interface PdfNode {
  id: string;
  attachment: Zotero.Item;
  name: string;
  checked: boolean;
  checkboxElement?: HTMLInputElement;
}

/**
 * 树节点接口
 */
interface TreeNode {
  id: string;
  item: Zotero.Item;
  name: string;
  checked: boolean;
  expanded: boolean;
  pdfNodes: PdfNode[];
  checkboxElement?: HTMLInputElement;
  expandButton?: HTMLElement;
  childrenContainer?: HTMLElement;
}

/**
 * 文献综述视图类
 */
export class LiteratureReviewView extends BaseView {
  private collection: Zotero.Collection | null = null;
  private treeNodes: TreeNode[] = [];
  private selectedPdfCount: number = 0;
  private totalPdfCount: number = 0;

  // UI 元素引用
  private nameInput: HTMLInputElement | null = null;
  private promptTextarea: HTMLTextAreaElement | null = null;
  private treeContainer: HTMLElement | null = null;
  private selectedCountElement: HTMLElement | null = null;
  private generateButton: HTMLButtonElement | null = null;

  /**
   * 构造函数
   */
  constructor() {
    super("literature-review-view");
  }

  /**
   * 设置当前分类
   */
  public async setCollection(collection: Zotero.Collection): Promise<void> {
    this.collection = collection;
    await this.scanCollection();
    this.updateUI();
  }

  /**
   * 渲染视图内容
   */
  protected renderContent(): HTMLElement {
    const container = this.createElement("div", {
      id: "ai-butler-literature-review",
      styles: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        fontFamily: "system-ui, -apple-system, sans-serif",
      },
    });

    // 头部区域
    const header = this.createElement("div", {
      styles: {
        padding: "20px",
        background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
        color: "white",
        flexShrink: "0",
      },
      children: [
        this.createElement("h2", {
          styles: {
            margin: "0 0 8px 0",
            fontSize: "18px",
            fontWeight: "600",
          },
          innerHTML: "📚 AI管家文献综述",
        }),
        this.createElement("p", {
          id: "review-collection-name",
          styles: {
            margin: "0",
            fontSize: "14px",
            opacity: "0.9",
          },
          innerHTML: "请选择一个分类...",
        }),
      ],
    });

    // 配置表单区域
    const formContainer = this.createElement("div", {
      styles: {
        padding: "20px",
        background: "#f8fafc",
        borderBottom: "1px solid #e2e8f0",
        flexShrink: "0",
      },
    });

    // 综述名称输入
    const nameGroup = this.createElement("div", {
      styles: {
        marginBottom: "16px",
      },
    });

    const nameLabel = this.createElement("label", {
      styles: {
        display: "block",
        marginBottom: "6px",
        fontSize: "14px",
        fontWeight: "500",
        color: "#374151",
      },
      textContent: "综述名称",
    });

    const defaultName = `AI管家综述-${new Date().toISOString().slice(0, 10)}`;
    this.nameInput = createInput(
      "review-name-input",
      "text",
      defaultName,
      "请输入综述名称...",
    );
    this.nameInput.style.width = "100%";

    nameGroup.appendChild(nameLabel);
    nameGroup.appendChild(this.nameInput);

    // 提示词输入
    const promptGroup = this.createElement("div", {
      styles: {
        marginBottom: "0",
      },
    });

    const promptLabel = this.createElement("label", {
      styles: {
        display: "block",
        marginBottom: "6px",
        fontSize: "14px",
        fontWeight: "500",
        color: "#374151",
      },
      textContent: "自定义提示词",
    });

    this.promptTextarea = createTextarea(
      "review-prompt-input",
      DEFAULT_LITERATURE_REVIEW_PROMPT,
      6,
      "请输入提示词...",
    );
    this.promptTextarea.style.width = "100%";

    promptGroup.appendChild(promptLabel);
    promptGroup.appendChild(this.promptTextarea);

    formContainer.appendChild(nameGroup);
    formContainer.appendChild(promptGroup);

    // PDF 选择区域标题
    const selectionHeader = this.createElement("div", {
      styles: {
        padding: "16px 20px",
        background: "#fff",
        borderBottom: "1px solid #e2e8f0",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: "0",
      },
    });

    const selectionTitle = this.createElement("h3", {
      styles: {
        margin: "0",
        fontSize: "15px",
        fontWeight: "600",
        color: "#1f2937",
      },
      textContent: "选择要纳入综述的 PDF",
    });

    // 全选/取消按钮
    const selectAllBtn = createStyledButton("全选", "#6366f1", "small");
    selectAllBtn.addEventListener("click", () => this.toggleAllNodes(true));

    const deselectAllBtn = createStyledButton("取消全选", "#94a3b8", "small");
    deselectAllBtn.style.marginLeft = "8px";
    deselectAllBtn.addEventListener("click", () => this.toggleAllNodes(false));

    const btnGroup = this.createElement("div", {
      styles: {
        display: "flex",
        gap: "8px",
      },
      children: [selectAllBtn, deselectAllBtn],
    });

    selectionHeader.appendChild(selectionTitle);
    selectionHeader.appendChild(btnGroup);

    // 树形结构容器
    this.treeContainer = this.createElement("div", {
      id: "review-tree-container",
      styles: {
        flex: "1",
        minHeight: "0",
        overflow: "auto",
        padding: "15px 20px",
        background: "#fff",
      },
    });

    // 底部操作栏
    const footer = this.createElement("div", {
      styles: {
        padding: "16px 20px",
        borderTop: "1px solid #e2e8f0",
        background: "#f8fafc",
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
        color: "#6b7280",
      },
      innerHTML: "已选择: <strong>0</strong> 个 PDF",
    });

    // 按钮容器
    const buttonContainer = this.createElement("div", {
      styles: {
        display: "flex",
        gap: "12px",
      },
    });

    // 返回按钮
    const cancelButton = createStyledButton("返回", "#94a3b8", "medium");
    cancelButton.addEventListener("click", () => {
      MainWindow.getInstance().switchTab("dashboard");
    });

    // 生成按钮
    this.generateButton = createStyledButton(
      "🚀 生成综述",
      "#6366f1",
      "medium",
    );
    this.generateButton.addEventListener("click", () => this.handleGenerate());

    buttonContainer.appendChild(cancelButton);
    buttonContainer.appendChild(this.generateButton);

    footer.appendChild(this.selectedCountElement);
    footer.appendChild(buttonContainer);

    container.appendChild(header);
    container.appendChild(formContainer);
    container.appendChild(selectionHeader);
    container.appendChild(this.treeContainer);
    container.appendChild(footer);

    return container;
  }

  /**
   * 扫描分类下所有文献及其 PDF 附件
   */
  private async scanCollection(): Promise<void> {
    this.treeNodes = [];
    this.totalPdfCount = 0;
    this.selectedPdfCount = 0;

    if (!this.collection) {
      return;
    }

    // 获取分类下的所有条目
    const items = this.collection.getChildItems();

    for (const item of items) {
      // 跳过笔记、附件
      if (item.isNote() || item.isAttachment()) {
        continue;
      }

      // 获取所有 PDF 附件
      const pdfAttachments = await this.getPdfAttachments(item);

      if (pdfAttachments.length > 0) {
        this.totalPdfCount += pdfAttachments.length;

        const pdfNodes: PdfNode[] = pdfAttachments.map((att, idx) => ({
          id: `pdf-${att.id}`,
          attachment: att,
          name: (att.getField("title") as string) || `PDF ${idx + 1}`,
          checked: false,
        }));

        this.treeNodes.push({
          id: `item-${item.id}`,
          item,
          name: item.getField("title") as string,
          checked: false,
          expanded: false,
          pdfNodes,
        });
      }
    }
  }

  /**
   * 获取条目的所有 PDF 附件
   */
  private async getPdfAttachments(item: Zotero.Item): Promise<Zotero.Item[]> {
    const attachmentIDs = item.getAttachments();
    const pdfAttachments: Zotero.Item[] = [];

    for (const attID of attachmentIDs) {
      const att = await Zotero.Items.getAsync(attID);
      if (att && att.isPDFAttachment?.()) {
        pdfAttachments.push(att);
      }
    }

    return pdfAttachments;
  }

  /**
   * 更新 UI
   */
  private updateUI(): void {
    if (!this.collection) {
      return;
    }

    // 更新分类名称
    const nameElement = this.container?.querySelector(
      "#review-collection-name",
    );
    if (nameElement) {
      nameElement.innerHTML = `分类: <strong>${this.collection.name}</strong> (${this.treeNodes.length} 篇文献, ${this.totalPdfCount} 个 PDF)`;
    }

    // 渲染文献列表
    if (this.treeContainer) {
      this.treeContainer.innerHTML = "";

      if (this.treeNodes.length === 0) {
        const emptyMessage = this.createElement("div", {
          styles: {
            textAlign: "center",
            padding: "40px",
            color: "#9ca3af",
            fontSize: "14px",
          },
          innerHTML: "📭<br><br>该分类下没有带 PDF 附件的文献",
        });
        this.treeContainer.appendChild(emptyMessage);
      } else {
        for (const node of this.treeNodes) {
          const nodeElement = this.createTreeNode(node);
          this.treeContainer.appendChild(nodeElement);
        }
      }
    }

    this.updateSelectedCount();
  }

  /**
   * 创建树节点元素
   */
  private createTreeNode(node: TreeNode): HTMLElement {
    const hasMultiplePdfs = node.pdfNodes.length > 1;

    const wrapper = this.createElement("div", {
      styles: {
        marginBottom: "8px",
      },
    });

    const nodeElement = this.createElement("div", {
      styles: {
        display: "flex",
        alignItems: "center",
        padding: "10px 12px",
        background: "#f9fafb",
        borderRadius: hasMultiplePdfs ? "6px 6px 0 0" : "6px",
        border: "1px solid #e5e7eb",
        borderBottom:
          hasMultiplePdfs && node.expanded ? "none" : "1px solid #e5e7eb",
        cursor: "pointer",
        transition: "all 0.2s",
      },
    });

    // 展开按钮（只有多个 PDF 时显示）
    if (hasMultiplePdfs) {
      const expandBtn = this.createElement("span", {
        styles: {
          marginRight: "8px",
          cursor: "pointer",
          fontSize: "12px",
          color: "#6b7280",
          transition: "transform 0.2s",
          display: "inline-block",
        },
        textContent: node.expanded ? "▼" : "▶",
      });
      node.expandButton = expandBtn;

      expandBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleExpand(node);
      });

      nodeElement.appendChild(expandBtn);
    }

    // 复选框
    const checkbox = this.createElement("input", {
      attributes: {
        type: "checkbox",
      },
      styles: {
        marginRight: "12px",
        cursor: "pointer",
        width: "16px",
        height: "16px",
      },
    }) as HTMLInputElement;

    checkbox.checked = node.checked;
    node.checkboxElement = checkbox;

    checkbox.addEventListener("change", (e) => {
      e.stopPropagation();
      this.toggleItemNode(node, checkbox.checked);
    });

    // 图标和名称 - 截取显示，避免溢出
    const pdfInfo = hasMultiplePdfs ? ` (${node.pdfNodes.length} 个 PDF)` : "";
    const maxTitleLength = 60;
    const displayName =
      node.name.length > maxTitleLength
        ? node.name.substring(0, maxTitleLength) + "..."
        : node.name;
    const label = this.createElement("span", {
      styles: {
        flex: "1",
        minWidth: "0",
        fontSize: "14px",
        color: "#374151",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      },
      textContent: `📄 ${displayName}${pdfInfo}`,
    });

    nodeElement.appendChild(checkbox);
    nodeElement.appendChild(label);

    // 悬停效果
    nodeElement.addEventListener("mouseenter", () => {
      nodeElement.style.background = "#f3f4f6";
      nodeElement.style.borderColor = "#6366f1";
    });
    nodeElement.addEventListener("mouseleave", () => {
      nodeElement.style.background = "#f9fafb";
      nodeElement.style.borderColor = "#e5e7eb";
    });

    // 点击整行
    nodeElement.addEventListener("click", (e) => {
      if (e.target === checkbox) return;

      if (hasMultiplePdfs) {
        // 多个 PDF 时，点击展开/收起
        this.toggleExpand(node);
      } else {
        // 单个 PDF 时，点击切换选中
        checkbox.checked = !checkbox.checked;
        this.toggleItemNode(node, checkbox.checked);
      }
    });

    wrapper.appendChild(nodeElement);

    // 子 PDF 列表容器
    if (hasMultiplePdfs) {
      const childrenContainer = this.createElement("div", {
        styles: {
          display: node.expanded ? "block" : "none",
          borderLeft: "1px solid #e5e7eb",
          borderRight: "1px solid #e5e7eb",
          borderBottom: "1px solid #e5e7eb",
          borderRadius: "0 0 6px 6px",
          background: "#fefefe",
        },
      });
      node.childrenContainer = childrenContainer;

      for (const pdfNode of node.pdfNodes) {
        const pdfElement = this.createPdfNode(pdfNode, node);
        childrenContainer.appendChild(pdfElement);
      }

      wrapper.appendChild(childrenContainer);
    }

    return wrapper;
  }

  /**
   * 创建 PDF 子节点元素
   */
  private createPdfNode(pdfNode: PdfNode, parentNode: TreeNode): HTMLElement {
    const pdfElement = this.createElement("div", {
      styles: {
        display: "flex",
        alignItems: "center",
        padding: "8px 12px 8px 36px",
        borderBottom: "1px solid #f3f4f6",
        cursor: "pointer",
        transition: "background 0.2s",
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
        width: "14px",
        height: "14px",
      },
    }) as HTMLInputElement;

    checkbox.checked = pdfNode.checked;
    pdfNode.checkboxElement = checkbox;

    checkbox.addEventListener("change", (e) => {
      e.stopPropagation();
      pdfNode.checked = checkbox.checked;
      this.updateParentCheckState(parentNode);
      this.updateSelectedCount();
    });

    // 名称
    const label = this.createElement("span", {
      styles: {
        flex: "1",
        fontSize: "13px",
        color: "#6b7280",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      },
      textContent: `📎 ${pdfNode.name}`,
    });

    pdfElement.appendChild(checkbox);
    pdfElement.appendChild(label);

    // 悬停效果
    pdfElement.addEventListener("mouseenter", () => {
      pdfElement.style.background = "#f9fafb";
    });
    pdfElement.addEventListener("mouseleave", () => {
      pdfElement.style.background = "transparent";
    });

    // 点击整行切换
    pdfElement.addEventListener("click", (e) => {
      if (e.target !== checkbox) {
        checkbox.checked = !checkbox.checked;
        pdfNode.checked = checkbox.checked;
        this.updateParentCheckState(parentNode);
        this.updateSelectedCount();
      }
    });

    return pdfElement;
  }

  /**
   * 切换展开/收起
   */
  private toggleExpand(node: TreeNode): void {
    node.expanded = !node.expanded;

    if (node.expandButton) {
      node.expandButton.textContent = node.expanded ? "▼" : "▶";
    }

    if (node.childrenContainer) {
      node.childrenContainer.style.display = node.expanded ? "block" : "none";
    }
  }

  /**
   * 切换条目节点选中状态
   */
  private toggleItemNode(node: TreeNode, checked: boolean): void {
    node.checked = checked;

    // 同步所有子 PDF 的选中状态
    for (const pdfNode of node.pdfNodes) {
      pdfNode.checked = checked;
      if (pdfNode.checkboxElement) {
        pdfNode.checkboxElement.checked = checked;
      }
    }

    this.updateSelectedCount();
  }

  /**
   * 更新父节点选中状态
   */
  private updateParentCheckState(node: TreeNode): void {
    const allChecked = node.pdfNodes.every((p) => p.checked);
    const someChecked = node.pdfNodes.some((p) => p.checked);

    node.checked = allChecked;

    if (node.checkboxElement) {
      node.checkboxElement.checked = allChecked;
      node.checkboxElement.indeterminate = someChecked && !allChecked;
    }
  }

  /**
   * 切换所有节点选中状态
   */
  private toggleAllNodes(checked: boolean): void {
    for (const node of this.treeNodes) {
      node.checked = checked;
      if (node.checkboxElement) {
        node.checkboxElement.checked = checked;
        node.checkboxElement.indeterminate = false;
      }

      for (const pdfNode of node.pdfNodes) {
        pdfNode.checked = checked;
        if (pdfNode.checkboxElement) {
          pdfNode.checkboxElement.checked = checked;
        }
      }
    }
    this.updateSelectedCount();
  }

  /**
   * 更新选择计数
   */
  private updateSelectedCount(): void {
    this.selectedPdfCount = 0;
    for (const node of this.treeNodes) {
      for (const pdfNode of node.pdfNodes) {
        if (pdfNode.checked) {
          this.selectedPdfCount++;
        }
      }
    }

    if (this.selectedCountElement) {
      this.selectedCountElement.innerHTML = `已选择: <strong>${this.selectedPdfCount}</strong> 个 PDF`;
    }

    // 更新生成按钮状态
    if (this.generateButton) {
      this.generateButton.disabled = this.selectedPdfCount === 0;
      this.generateButton.style.opacity =
        this.selectedPdfCount === 0 ? "0.5" : "1";
    }
  }

  /**
   * 收集选中的 PDF 附件
   */
  private collectSelectedPdfAttachments(): Zotero.Item[] {
    const attachments: Zotero.Item[] = [];
    for (const node of this.treeNodes) {
      for (const pdfNode of node.pdfNodes) {
        if (pdfNode.checked) {
          attachments.push(pdfNode.attachment);
        }
      }
    }
    return attachments;
  }

  /**
   * 处理生成综述
   */
  private async handleGenerate(): Promise<void> {
    if (!this.collection || !this.nameInput || !this.promptTextarea) {
      return;
    }

    const selectedPdfs = this.collectSelectedPdfAttachments();
    if (selectedPdfs.length === 0) {
      new ztoolkit.ProgressWindow("AI Butler", {
        closeOnClick: true,
        closeTime: 3000,
      })
        .createLine({
          text: "请至少选择一个 PDF",
          type: "error",
        })
        .show();
      return;
    }

    const reviewName =
      this.nameInput.value.trim() ||
      `AI管家综述-${new Date().toISOString().slice(0, 10)}`;
    const prompt =
      this.promptTextarea.value.trim() || DEFAULT_LITERATURE_REVIEW_PROMPT;

    // 禁用生成按钮
    if (this.generateButton) {
      this.generateButton.disabled = true;
      this.generateButton.textContent = "⏳ 正在生成...";
    }

    try {
      // 调用综述服务生成报告
      const reportItem = await LiteratureReviewService.generateReview(
        this.collection,
        selectedPdfs,
        reviewName,
        prompt,
        (message: string, progress: number) => {
          if (this.generateButton) {
            this.generateButton.textContent = `⏳ ${message}`;
          }
        },
      );

      // 生成成功
      new ztoolkit.ProgressWindow("AI Butler", {
        closeOnClick: true,
        closeTime: 5000,
      })
        .createLine({
          text: `✅ 综述已生成: ${reviewName}`,
          type: "success",
        })
        .show();

      // 在 Zotero 中选中新创建的报告条目
      const zoteroPane = Zotero.getActiveZoteroPane();
      await zoteroPane.selectItem(reportItem.id);

      // 返回仪表盘
      MainWindow.getInstance().switchTab("dashboard");
    } catch (error: any) {
      ztoolkit.log("[AI-Butler] 生成综述失败:", error);
      new ztoolkit.ProgressWindow("AI Butler", {
        closeOnClick: true,
        closeTime: 5000,
      })
        .createLine({
          text: `❌ 生成失败: ${error.message || error}`,
          type: "error",
        })
        .show();
    } finally {
      // 恢复生成按钮
      if (this.generateButton) {
        this.generateButton.disabled = false;
        this.generateButton.textContent = "🚀 生成综述";
      }
    }
  }
}
