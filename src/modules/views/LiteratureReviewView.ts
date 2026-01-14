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
  createSelect,
} from "./ui/components";
import { DEFAULT_LITERATURE_REVIEW_PROMPT } from "../../utils/prompts";

/**
 * 提示词预设接口
 */
interface PromptPreset {
  id: string;
  name: string;
  prompt: string;
}

/** 预设存储的 Pref 键名 */
const PRESETS_PREF_KEY = "extensions.zotero.ai-butler.literatureReviewPresets";
const CURRENT_PRESET_PREF_KEY =
  "extensions.zotero.ai-butler.literatureReviewCurrentPreset";

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

  // 预设管理
  private presets: PromptPreset[] = [];
  private currentPresetId: string = "default";
  private presetSelect: HTMLElement | null = null;
  private presetControlsContainer: HTMLElement | null = null;

  /**
   * 构造函数
   */
  constructor() {
    super("literature-review-view");
    this.loadPresets();
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
        height: "100%", // Match parent container height
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

    // 提示词预设区域
    const promptGroup = this.createElement("div", {
      styles: {
        marginBottom: "0",
      },
    });

    // 提示词标签与预设控制区
    const promptHeader = this.createElement("div", {
      styles: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "8px",
      },
    });

    const promptLabel = this.createElement("label", {
      styles: {
        fontSize: "14px",
        fontWeight: "500",
        color: "#374151",
      },
      textContent: "自定义提示词",
    });

    // 预设控制栏
    const presetControls = this.createElement("div", {
      styles: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
      },
    });

    // 预设下拉选择
    this.presetSelect = createSelect(
      "preset-select",
      this.getPresetOptions(),
      this.currentPresetId,
      (newValue: string) => {
        this.handlePresetChange(newValue);
      },
    );
    this.presetSelect.style.minWidth = "120px";
    this.presetSelect.style.fontSize = "12px";

    // 新增按钮
    const newBtn = this.createSmallButton("➕", "新建预设");
    newBtn.addEventListener("click", () => this.handleNewPreset());

    // 保存按钮
    const saveBtn = this.createSmallButton("💾", "保存到当前预设");
    saveBtn.addEventListener("click", () => this.handleSavePreset());

    // 重命名按钮
    const renameBtn = this.createSmallButton("✏️", "重命名当前预设");
    renameBtn.addEventListener("click", () => this.handleRenamePreset());

    // 删除按钮
    const deleteBtn = this.createSmallButton("🗑️", "删除当前预设");
    deleteBtn.addEventListener("click", () => this.handleDeletePreset());

    // 保存控件容器引用，便于后续更新
    this.presetControlsContainer = presetControls;

    if (this.presetSelect) {
      presetControls.appendChild(this.presetSelect);
    }
    presetControls.appendChild(newBtn);
    presetControls.appendChild(saveBtn);
    presetControls.appendChild(renameBtn);
    presetControls.appendChild(deleteBtn);

    promptHeader.appendChild(promptLabel);
    promptHeader.appendChild(presetControls);

    // 提示词文本框
    this.promptTextarea = createTextarea(
      "review-prompt-input",
      this.getCurrentPresetPrompt(),
      6,
      "请输入提示词...",
    );
    this.promptTextarea.style.width = "100%";

    promptGroup.appendChild(promptHeader);
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

    // 树形结构容器包装 (用于内滚动布局)
    const treeWrapper = this.createElement("div", {
      styles: {
        flex: "1",
        minHeight: "0",
        position: "relative",
        background: "#fff",
      },
    });

    // 实际树形结构容器 (绝对定位填满包装器)
    this.treeContainer = this.createElement("div", {
      id: "review-tree-container",
      styles: {
        position: "absolute",
        top: "0",
        left: "0",
        right: "0",
        bottom: "0",
        overflowY: "auto",
        padding: "15px 20px",
      },
    });

    treeWrapper.appendChild(this.treeContainer);

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
        zIndex: "10",
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
    container.appendChild(treeWrapper); // Append wrapper instead of treeContainer
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

  // ==================== 预设管理方法 ====================

  /**
   * 加载预设
   */
  private loadPresets(): void {
    try {
      const savedPresets = Zotero.Prefs.get(PRESETS_PREF_KEY, true) as string;
      if (savedPresets) {
        this.presets = JSON.parse(savedPresets);
      }
    } catch (e) {
      ztoolkit.log("[AI-Butler] 加载预设失败:", e);
    }

    // 确保有默认预设
    if (!this.presets.find((p) => p.id === "default")) {
      this.presets.unshift({
        id: "default",
        name: "默认",
        prompt: DEFAULT_LITERATURE_REVIEW_PROMPT,
      });
    }

    // 加载上次选择的预设
    const savedCurrentId = Zotero.Prefs.get(
      CURRENT_PRESET_PREF_KEY,
      true,
    ) as string;
    if (savedCurrentId && this.presets.find((p) => p.id === savedCurrentId)) {
      this.currentPresetId = savedCurrentId;
    } else {
      this.currentPresetId = "default";
    }
  }

  /**
   * 保存预设到偏好设置
   */
  private savePresets(): void {
    try {
      Zotero.Prefs.set(PRESETS_PREF_KEY, JSON.stringify(this.presets), true);
      Zotero.Prefs.set(CURRENT_PRESET_PREF_KEY, this.currentPresetId, true);
    } catch (e) {
      ztoolkit.log("[AI-Butler] 保存预设失败:", e);
    }
  }

  /**
   * 获取预设下拉选项
   */
  private getPresetOptions(): Array<{ value: string; label: string }> {
    return this.presets.map((p) => ({
      value: p.id,
      label: p.name,
    }));
  }

  /**
   * 获取当前预设的提示词
   */
  private getCurrentPresetPrompt(): string {
    const preset = this.presets.find((p) => p.id === this.currentPresetId);
    return preset?.prompt || DEFAULT_LITERATURE_REVIEW_PROMPT;
  }

  /**
   * 更新预设下拉选项（重新创建选择器）
   */
  private updatePresetSelect(): void {
    if (!this.presetControlsContainer || !this.presetSelect) return;

    // 移除旧的选择器
    this.presetSelect.remove();

    // 创建新的选择器
    this.presetSelect = createSelect(
      "preset-select",
      this.getPresetOptions(),
      this.currentPresetId,
      (newValue: string) => {
        this.handlePresetChange(newValue);
      },
    );
    this.presetSelect.style.minWidth = "120px";
    this.presetSelect.style.fontSize = "12px";

    // 插入到容器的第一个位置
    this.presetControlsContainer.insertBefore(
      this.presetSelect,
      this.presetControlsContainer.firstChild,
    );
  }

  /**
   * 处理预设切换
   */
  private handlePresetChange(presetId: string): void {
    this.currentPresetId = presetId;
    this.savePresets();

    // 更新文本框内容
    if (this.promptTextarea) {
      this.promptTextarea.value = this.getCurrentPresetPrompt();
    }
  }

  /**
   * 创建小型按钮
   */
  private createSmallButton(text: string, title: string): HTMLElement {
    const btn = this.createElement("button", {
      attributes: { type: "button", title },
      styles: {
        padding: "4px 8px",
        fontSize: "12px",
        background: "#f3f4f6",
        border: "1px solid #d1d5db",
        borderRadius: "4px",
        cursor: "pointer",
        transition: "all 0.2s",
      },
      textContent: text,
    });

    btn.addEventListener("mouseenter", () => {
      btn.style.background = "#e5e7eb";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "#f3f4f6";
    });

    return btn;
  }

  /**
   * 处理新建预设
   */
  private handleNewPreset(): void {
    // 生成唯一 ID
    let counter = 1;
    while (this.presets.find((p) => p.id === `untitled-${counter}`)) {
      counter++;
    }

    const newPreset: PromptPreset = {
      id: `untitled-${counter}`,
      name: `未命名-${counter}`,
      prompt: DEFAULT_LITERATURE_REVIEW_PROMPT,
    };

    this.presets.push(newPreset);
    this.currentPresetId = newPreset.id;
    this.savePresets();
    this.updatePresetSelect();

    // 更新文本框
    if (this.promptTextarea) {
      this.promptTextarea.value = newPreset.prompt;
    }
  }

  /**
   * 处理保存预设
   */
  private handleSavePreset(): void {
    const preset = this.presets.find((p) => p.id === this.currentPresetId);
    if (!preset) return;

    if (this.promptTextarea) {
      preset.prompt = this.promptTextarea.value;
    }

    this.savePresets();

    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 2000,
    })
      .createLine({
        text: `✅ 预设 "${preset.name}" 已保存`,
        type: "success",
      })
      .show();
  }

  /**
   * 处理重命名预设
   */
  private handleRenamePreset(): void {
    const preset = this.presets.find((p) => p.id === this.currentPresetId);
    if (!preset) return;

    // 默认预设不允许重命名
    if (preset.id === "default") {
      new ztoolkit.ProgressWindow("AI Butler", {
        closeOnClick: true,
        closeTime: 2000,
      })
        .createLine({
          text: "❌ 默认预设不能重命名",
          type: "error",
        })
        .show();
      return;
    }

    // 显示内联重命名对话框
    this.showRenameDialog(preset);
  }

  /**
   * 显示内联重命名对话框
   */
  private showRenameDialog(preset: PromptPreset): void {
    if (!this.container) return;

    // 创建遮罩层
    const overlay = this.createElement("div", {
      styles: {
        position: "absolute",
        top: "0",
        left: "0",
        right: "0",
        bottom: "0",
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: "9999",
      },
    });

    // 创建对话框
    const dialog = this.createElement("div", {
      styles: {
        background: "#fff",
        borderRadius: "8px",
        padding: "24px",
        minWidth: "300px",
        maxWidth: "400px",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
      },
    });

    // 标题
    const title = this.createElement("h3", {
      styles: {
        margin: "0 0 16px 0",
        fontSize: "16px",
        color: "#1f2937",
      },
      textContent: "重命名预设",
    });

    // 输入框
    const input = createInput(
      "rename-preset",
      "text",
      preset.name,
      "请输入新名称...",
    );
    input.style.marginBottom = "20px";

    // 自动聚焦并选中文本
    setTimeout(() => {
      input.focus();
      input.select();
    }, 100);

    // 按钮容器
    const buttons = this.createElement("div", {
      styles: {
        display: "flex",
        gap: "12px",
        justifyContent: "flex-end",
      },
    });

    // 取消按钮
    const cancelBtn = createStyledButton("取消", "#94a3b8", "small");
    cancelBtn.addEventListener("click", () => {
      overlay.remove();
    });

    // 确认按钮
    const confirmBtn = createStyledButton("确认", "#6366f1", "small");
    const doRename = () => {
      const newName = input.value.trim();
      if (newName) {
        preset.name = newName;
        this.savePresets();
        this.updatePresetSelect();
        overlay.remove();

        new ztoolkit.ProgressWindow("AI Butler", {
          closeOnClick: true,
          closeTime: 2000,
        })
          .createLine({
            text: `✅ 预设已重命名为 "${newName}"`,
            type: "success",
          })
          .show();
      }
    };

    confirmBtn.addEventListener("click", doRename);

    // 回车确认
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        doRename();
      } else if (e.key === "Escape") {
        overlay.remove();
      }
    });

    buttons.appendChild(cancelBtn);
    buttons.appendChild(confirmBtn);

    dialog.appendChild(title);
    dialog.appendChild(input);
    dialog.appendChild(buttons);
    overlay.appendChild(dialog);

    // 点击遮罩关闭
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });

    this.container.appendChild(overlay);
  }

  /**
   * 处理删除预设
   */
  private handleDeletePreset(): void {
    const preset = this.presets.find((p) => p.id === this.currentPresetId);
    if (!preset) return;

    // 默认预设不允许删除
    if (preset.id === "default") {
      new ztoolkit.ProgressWindow("AI Butler", {
        closeOnClick: true,
        closeTime: 2000,
      })
        .createLine({
          text: "❌ 默认预设不能删除",
          type: "error",
        })
        .show();
      return;
    }

    // 显示内联确认对话框
    this.showDeleteConfirmDialog(preset);
  }

  /**
   * 显示内联删除确认对话框
   */
  private showDeleteConfirmDialog(preset: PromptPreset): void {
    if (!this.container) return;

    // 创建遮罩层
    const overlay = this.createElement("div", {
      styles: {
        position: "absolute",
        top: "0",
        left: "0",
        right: "0",
        bottom: "0",
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: "9999",
      },
    });

    // 创建确认对话框
    const dialog = this.createElement("div", {
      styles: {
        background: "#fff",
        borderRadius: "8px",
        padding: "24px",
        maxWidth: "320px",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
        textAlign: "center",
      },
    });

    // 标题
    const title = this.createElement("h3", {
      styles: {
        margin: "0 0 12px 0",
        fontSize: "16px",
        color: "#1f2937",
      },
      textContent: "确认删除",
    });

    // 消息
    const message = this.createElement("p", {
      styles: {
        margin: "0 0 20px 0",
        fontSize: "14px",
        color: "#6b7280",
      },
      textContent: `确定要删除预设 "${preset.name}" 吗？`,
    });

    // 按钮容器
    const buttons = this.createElement("div", {
      styles: {
        display: "flex",
        gap: "12px",
        justifyContent: "center",
      },
    });

    // 取消按钮
    const cancelBtn = createStyledButton("取消", "#94a3b8", "small");
    cancelBtn.addEventListener("click", () => {
      overlay.remove();
    });

    // 确认按钮
    const confirmBtn = createStyledButton("删除", "#ef4444", "small");
    confirmBtn.addEventListener("click", () => {
      // 执行删除
      this.presets = this.presets.filter((p) => p.id !== preset.id);
      this.currentPresetId = "default";
      this.savePresets();
      this.updatePresetSelect();

      // 更新文本框
      if (this.promptTextarea) {
        this.promptTextarea.value = this.getCurrentPresetPrompt();
      }

      overlay.remove();

      new ztoolkit.ProgressWindow("AI Butler", {
        closeOnClick: true,
        closeTime: 2000,
      })
        .createLine({
          text: `✅ 预设 "${preset.name}" 已删除`,
          type: "success",
        })
        .show();
    });

    buttons.appendChild(cancelBtn);
    buttons.appendChild(confirmBtn);

    dialog.appendChild(title);
    dialog.appendChild(message);
    dialog.appendChild(buttons);
    overlay.appendChild(dialog);

    // 点击遮罩关闭
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });

    this.container.appendChild(overlay);
  }
}
