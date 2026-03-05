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
import {
  createInput,
  createTextarea,
  createStyledButton,
  createSelect,
} from "./ui/components";
import {
  DEFAULT_TABLE_REVIEW_PROMPT,
  DEFAULT_TABLE_TEMPLATE,
} from "../../utils/prompts";
import { getPref, setPref } from "../../utils/prefs";

/**
 * 提示词预设接口
 */
interface PromptPreset {
  id: string;
  name: string;
  prompt: string;
}

const REVIEW_PRESETS_PREF_KEY =
  "extensions.zotero.ai-butler.literatureReviewReviewPromptPresets";
const REVIEW_CURRENT_PRESET_PREF_KEY =
  "extensions.zotero.ai-butler.literatureReviewReviewPromptCurrentPreset";
const TABLE_PRESETS_PREF_KEY =
  "extensions.zotero.ai-butler.literatureReviewTablePromptPresets";
const TABLE_CURRENT_PRESET_PREF_KEY =
  "extensions.zotero.ai-butler.literatureReviewTablePromptCurrentPreset";
const TARGETED_PROMPT_PREF_KEY =
  "extensions.zotero.ai-butler.literatureReviewTargetedPrompt";
const TARGETED_APPEND_TABLE_ENTRIES_PREF_KEY =
  "extensions.zotero.ai-butler.literatureReviewTargetedAppendTableEntries";
const TARGETED_NEW_TABLE_ENTRIES_PREF_KEY =
  "extensions.zotero.ai-butler.literatureReviewTargetedNewTableEntries";
const TARGETED_SELECTED_TABLE_ENTRIES_PREF_KEY =
  "extensions.zotero.ai-butler.literatureReviewTargetedSelectedTableEntries";
const MAX_PRESETS = 5;
const DEFAULT_TARGETED_QUESTION_PROMPT = `请仅基于给定的结构化表格回答以下问题。

问题：
${"${question}"}

要求：
1. 仅依据表格中的信息作答，不要引入外部信息
2. 如果证据不足，请明确说明“不足以判断”
3. 对引用的结论使用[num]标注来源`;

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
  private reviewPromptTextarea: HTMLTextAreaElement | null = null;
  private tablePromptTextarea: HTMLTextAreaElement | null = null;
  private targetedPromptTextarea: HTMLTextAreaElement | null = null;
  private targetedAppendTableEntriesCheckbox: HTMLInputElement | null = null;
  private targetedNewEntriesTextarea: HTMLTextAreaElement | null = null;
  private targetedTableEntriesContainer: HTMLElement | null = null;
  private targetedTableEntryCheckboxes: Map<string, HTMLInputElement> =
    new Map();
  private firstCollectionTableEntries: string[] = [];
  private reviewPresetNameInput: HTMLInputElement | null = null;
  private tablePresetNameInput: HTMLInputElement | null = null;
  private reviewPresetSelect: HTMLElement | null = null;
  private tablePresetSelect: HTMLElement | null = null;
  private reviewPresetControlsContainer: HTMLElement | null = null;
  private tablePresetControlsContainer: HTMLElement | null = null;
  private treeContainer: HTMLElement | null = null;
  private selectedCountElement: HTMLElement | null = null;
  private generateButton: HTMLButtonElement | null = null;
  private fillTableButton: HTMLButtonElement | null = null;
  private askQuestionButton: HTMLButtonElement | null = null;

  // 预设管理
  private reviewPresets: PromptPreset[] = [];
  private tablePresets: PromptPreset[] = [];
  private currentReviewPresetId: string = "preset-1";
  private currentTablePresetId: string = "preset-1";

  /**
   * 构造函数
   */
  constructor() {
    super("literature-review-view");
    this.loadPromptPresets();
  }

  /**
   * 设置当前分类
   */
  public async setCollection(collection: Zotero.Collection): Promise<void> {
    this.collection = collection;
    await this.scanCollection();
    await this.loadFirstCollectionTableEntries();
    this.updateUI();
    this.refreshTargetedTableEntryOptions();
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
        backgroundColor: "var(--ai-bg)",
      },
    });

    // 头部区域
    const header = this.createElement("div", {
      styles: {
        padding: "20px",
        background:
          "linear-gradient(135deg, var(--ai-review-header-start) 0%, var(--ai-review-header-end) 100%)",
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
        background: "var(--ai-review-panel-bg)",
        borderBottom: "1px solid var(--ai-review-panel-border)",
        flexShrink: "0",
        maxHeight: "42%",
        overflowY: "auto",
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
        color: "var(--ai-text)",
      },
      textContent: "综述名称",
    });

    const defaultName = `综述 ${new Date().toISOString().slice(2, 10)}`;
    this.nameInput = createInput(
      "review-name-input",
      "text",
      defaultName,
      "请输入综述名称...",
    );
    this.nameInput.style.width = "100%";

    nameGroup.appendChild(nameLabel);
    nameGroup.appendChild(this.nameInput);

    // 综述提示词 + 预设
    const reviewPromptGroup = this.createElement("div", {
      styles: { marginBottom: "16px" },
    });
    const reviewPromptLabel = this.createElement("label", {
      styles: {
        display: "block",
        marginBottom: "6px",
        fontSize: "14px",
        fontWeight: "500",
        color: "var(--ai-text)",
      },
      textContent: "综述提示词",
    });
    const reviewPresetControls = this.createElement("div", {
      styles: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        marginBottom: "8px",
      },
    });
    this.reviewPresetControlsContainer = reviewPresetControls;
    this.reviewPresetSelect = createSelect(
      "review-preset-select",
      this.getPresetOptions(this.reviewPresets),
      this.currentReviewPresetId,
      (newValue: string) => this.handleReviewPresetChange(newValue),
    );
    this.reviewPresetSelect.style.minWidth = "140px";
    this.reviewPresetNameInput = createInput(
      "review-preset-name",
      "text",
      this.getCurrentReviewPreset().name,
      "预设名称",
    );
    this.reviewPresetNameInput.style.width = "180px";
    this.reviewPresetNameInput.addEventListener("change", () => {
      this.handleReviewPresetRename();
    });
    const saveReviewPresetBtn = createStyledButton(
      "保存预设",
      "#4caf50",
      "small",
    );
    saveReviewPresetBtn.addEventListener("click", () =>
      this.handleSaveReviewPreset(),
    );
    reviewPresetControls.appendChild(this.reviewPresetSelect);
    reviewPresetControls.appendChild(this.reviewPresetNameInput);
    reviewPresetControls.appendChild(saveReviewPresetBtn);
    this.reviewPromptTextarea = createTextarea(
      "review-prompt-input",
      this.getCurrentReviewPreset().prompt,
      5,
      "请输入综述提示词...",
    );
    reviewPromptGroup.appendChild(reviewPromptLabel);
    reviewPromptGroup.appendChild(reviewPresetControls);
    reviewPromptGroup.appendChild(this.reviewPromptTextarea);

    // 表格提示词 + 预设
    const tablePromptGroup = this.createElement("div", {
      styles: { marginBottom: "16px" },
    });
    const tablePromptLabel = this.createElement("label", {
      styles: {
        display: "block",
        marginBottom: "6px",
        fontSize: "14px",
        fontWeight: "500",
        color: "var(--ai-text)",
      },
      textContent: "表格模板提示词",
    });
    const tablePresetControls = this.createElement("div", {
      styles: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        marginBottom: "8px",
      },
    });
    this.tablePresetControlsContainer = tablePresetControls;
    this.tablePresetSelect = createSelect(
      "table-preset-select",
      this.getPresetOptions(this.tablePresets),
      this.currentTablePresetId,
      (newValue: string) => this.handleTablePresetChange(newValue),
    );
    this.tablePresetSelect.style.minWidth = "140px";
    this.tablePresetNameInput = createInput(
      "table-preset-name",
      "text",
      this.getCurrentTablePreset().name,
      "预设名称",
    );
    this.tablePresetNameInput.style.width = "180px";
    this.tablePresetNameInput.addEventListener("change", () => {
      this.handleTablePresetRename();
    });
    const saveTablePresetBtn = createStyledButton(
      "保存预设",
      "#4caf50",
      "small",
    );
    saveTablePresetBtn.addEventListener("click", () =>
      this.handleSaveTablePreset(),
    );
    tablePresetControls.appendChild(this.tablePresetSelect);
    tablePresetControls.appendChild(this.tablePresetNameInput);
    tablePresetControls.appendChild(saveTablePresetBtn);
    this.tablePromptTextarea = createTextarea(
      "table-prompt-input",
      this.getCurrentTablePreset().prompt,
      5,
      "请输入表格模板提示词...",
    );
    this.tablePromptTextarea.addEventListener("input", () =>
      this.refreshTargetedTableEntryOptions(),
    );
    tablePromptGroup.appendChild(tablePromptLabel);
    tablePromptGroup.appendChild(tablePresetControls);
    tablePromptGroup.appendChild(this.tablePromptTextarea);

    // 针对性提问输入框（独立于综述）
    const targetedPromptGroup = this.createElement("div", {
      styles: { marginBottom: "0" },
    });
    const targetedLabel = this.createElement("label", {
      styles: {
        display: "block",
        marginBottom: "6px",
        fontSize: "14px",
        fontWeight: "500",
        color: "var(--ai-text)",
      },
      textContent: "针对性提问提示词",
    });
    this.targetedPromptTextarea = createTextarea(
      "targeted-prompt-input",
      (
        (Zotero.Prefs.get(TARGETED_PROMPT_PREF_KEY, true) as string) || ""
      ).trim() || DEFAULT_TARGETED_QUESTION_PROMPT,
      4,
      "例如：仅比较“研究方法”这一维度，给出差异点与适用场景",
    );
    targetedPromptGroup.appendChild(targetedLabel);
    targetedPromptGroup.appendChild(this.targetedPromptTextarea);

    const appendOptionsRow = this.createElement("div", {
      styles: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        marginTop: "10px",
      },
    });
    this.targetedAppendTableEntriesCheckbox = this.createElement("input", {
      attributes: {
        type: "checkbox",
      },
      styles: {
        width: "16px",
        height: "16px",
        cursor: "pointer",
      },
    }) as HTMLInputElement;
    this.targetedAppendTableEntriesCheckbox.checked =
      (Zotero.Prefs.get(
        TARGETED_APPEND_TABLE_ENTRIES_PREF_KEY,
        true,
      ) as boolean) || false;
    this.targetedAppendTableEntriesCheckbox.addEventListener("change", () => {
      const checked = this.targetedAppendTableEntriesCheckbox?.checked || false;
      Zotero.Prefs.set(TARGETED_APPEND_TABLE_ENTRIES_PREF_KEY, checked, true);
      this.updateTargetedAppendEntryInputState();
      this.refreshTargetedTableEntryOptions();
    });
    const appendOptionsLabel = this.createElement("label", {
      styles: {
        fontSize: "13px",
        color: "var(--ai-text)",
        cursor: "pointer",
      },
      textContent: "追加新条目",
    });
    appendOptionsRow.appendChild(this.targetedAppendTableEntriesCheckbox);
    appendOptionsRow.appendChild(appendOptionsLabel);
    targetedPromptGroup.appendChild(appendOptionsRow);

    this.targetedNewEntriesTextarea = createTextarea(
      "targeted-new-table-entries-input",
      (Zotero.Prefs.get(TARGETED_NEW_TABLE_ENTRIES_PREF_KEY, true) as string) ||
        "",
      2,
      "输入要追加的条目，多个请用逗号或换行分隔",
    );
    this.targetedNewEntriesTextarea.style.marginTop = "8px";
    this.targetedNewEntriesTextarea.style.fontSize = "13px";
    this.targetedNewEntriesTextarea.addEventListener("input", () => {
      this.refreshTargetedTableEntryOptions();
    });
    this.targetedNewEntriesTextarea.addEventListener("change", () => {
      Zotero.Prefs.set(
        TARGETED_NEW_TABLE_ENTRIES_PREF_KEY,
        this.targetedNewEntriesTextarea?.value || "",
        true,
      );
    });
    targetedPromptGroup.appendChild(this.targetedNewEntriesTextarea);

    const tableEntriesBox = this.createElement("div", {
      styles: {
        marginTop: "10px",
        padding: "10px",
        border: "1px solid var(--ai-border)",
        borderRadius: "6px",
        background: "var(--ai-surface)",
      },
    });
    const tableEntriesHeader = this.createElement("div", {
      styles: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        marginBottom: "8px",
      },
    });
    const tableEntriesTitle = this.createElement("span", {
      styles: {
        fontSize: "13px",
        fontWeight: "600",
        color: "var(--ai-text)",
      },
      textContent: "针对性提问使用的表格条目",
    });
    const tableEntriesActions = this.createElement("div", {
      styles: {
        display: "flex",
        gap: "6px",
      },
    });
    const selectAllEntriesBtn = createStyledButton("全选", "#64748b", "small");
    selectAllEntriesBtn.addEventListener("click", () =>
      this.setAllTargetedTableEntriesChecked(true),
    );
    const clearEntriesBtn = createStyledButton("清空", "#94a3b8", "small");
    clearEntriesBtn.addEventListener("click", () =>
      this.setAllTargetedTableEntriesChecked(false),
    );
    tableEntriesActions.appendChild(selectAllEntriesBtn);
    tableEntriesActions.appendChild(clearEntriesBtn);
    tableEntriesHeader.appendChild(tableEntriesTitle);
    tableEntriesHeader.appendChild(tableEntriesActions);
    tableEntriesBox.appendChild(tableEntriesHeader);

    this.targetedTableEntriesContainer = this.createElement("div", {
      styles: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
        gap: "6px",
        maxHeight: "140px",
        overflowY: "auto",
        padding: "2px",
      },
    });
    tableEntriesBox.appendChild(this.targetedTableEntriesContainer);
    targetedPromptGroup.appendChild(tableEntriesBox);

    this.updateTargetedAppendEntryInputState();
    this.refreshTargetedTableEntryOptions();

    formContainer.appendChild(nameGroup);
    formContainer.appendChild(reviewPromptGroup);
    formContainer.appendChild(tablePromptGroup);
    formContainer.appendChild(targetedPromptGroup);

    // PDF 选择区域标题
    const selectionHeader = this.createElement("div", {
      styles: {
        padding: "16px 20px",
        background: "var(--ai-surface)",
        borderBottom: "1px solid var(--ai-review-panel-border)",
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
        color: "var(--ai-text)",
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
        minHeight: "220px",
        position: "relative",
        background: "var(--ai-surface)",
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
        borderTop: "1px solid var(--ai-review-panel-border)",
        background: "var(--ai-review-panel-bg)",
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
        color: "var(--ai-text-muted)",
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

    // 填表按钮
    this.fillTableButton = createStyledButton("📋 填表", "#4caf50", "medium");
    this.fillTableButton.addEventListener("click", () =>
      this.handleFillTables(),
    );

    // 针对性提问按钮（与综述独立）
    this.askQuestionButton = createStyledButton(
      "🎯 针对性提问",
      "#0ea5e9",
      "medium",
    );
    this.askQuestionButton.addEventListener("click", () =>
      this.handleAskFromTables(),
    );

    // 生成按钮
    this.generateButton = createStyledButton(
      "🚀 生成综述",
      "#6366f1",
      "medium",
    );
    this.generateButton.addEventListener("click", () => this.handleGenerate());

    buttonContainer.appendChild(cancelButton);
    buttonContainer.appendChild(this.fillTableButton);
    buttonContainer.appendChild(this.askQuestionButton);
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

    // 获取分类及其子分类下的所有条目
    const items = await this.collectItemsFromCollectionTree(this.collection);

    for (const item of items) {
      // 跳过笔记、附件
      if (item.isNote() || item.isAttachment()) {
        continue;
      }
      // 仅纳入期刊文章类型
      if (!this.isJournalArticleItem(item)) {
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

  private isJournalArticleItem(item: Zotero.Item): boolean {
    const itemType = item.itemType || (item as any).getType?.() || "";
    return itemType === "journalArticle";
  }

  /**
   * 递归收集当前分类及子分类中的文献条目
   */
  private async collectItemsFromCollectionTree(
    root: Zotero.Collection,
  ): Promise<Zotero.Item[]> {
    const result: Zotero.Item[] = [];
    const seen = new Set<number>();
    const queue: Zotero.Collection[] = [root];

    while (queue.length > 0) {
      const current = queue.shift()!;

      // 当前分类条目
      for (const item of current.getChildItems()) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          result.push(item);
        }
      }

      // 子分类入队
      const children = Zotero.Collections.getByParent(current.id) || [];
      for (const child of children) {
        queue.push(child as Zotero.Collection);
      }
    }

    return result;
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
            color: "var(--ai-text-muted)",
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
        background: "var(--ai-review-node-bg)",
        borderRadius: hasMultiplePdfs ? "6px 6px 0 0" : "6px",
        border: "1px solid var(--ai-border)",
        borderBottom:
          hasMultiplePdfs && node.expanded
            ? "none"
            : "1px solid var(--ai-border)",
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
          color: "var(--ai-text-muted)",
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
        color: "var(--ai-text)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      },
      textContent: `📄 ${displayName}${pdfInfo}`,
    });

    nodeElement.appendChild(checkbox);
    nodeElement.appendChild(label);

    // 状态标识
    const tags: Array<{ tag: string }> = (node.item as any).getTags?.() || [];
    const hasReviewed = tags.some((t) => t.tag === "AI-Reviewed");
    const hasTable = tags.some((t) => t.tag === "AI-Table");

    // 检查子笔记中是否有 AI-Table 标签
    const noteIDs: number[] = (node.item as any).getNotes?.() || [];
    const hasTableNote = hasTable;
    if (!hasTableNote && noteIDs.length > 0) {
      // 异步检查，但先标记可能有的
      void (async () => {
        for (const nid of noteIDs) {
          try {
            const n = await Zotero.Items.getAsync(nid);
            if (!n) continue;
            const noteTags: Array<{ tag: string }> =
              (n as any).getTags?.() || [];
            if (noteTags.some((t) => t.tag === "AI-Table")) {
              // 动态添加标识
              const tableBadge = this.createElement("span", {
                className: "ai-pill ai-pill--success",
                styles: {
                  marginLeft: "6px",
                  padding: "1px 6px",
                  borderRadius: "3px",
                  fontSize: "10px",
                  flexShrink: "0",
                },
                textContent: "📊 已填表",
              });
              nodeElement.insertBefore(tableBadge, label.nextSibling);
              break;
            }
          } catch {
            // skip
          }
        }
      })();
    }

    if (hasReviewed) {
      const reviewedBadge = this.createElement("span", {
        className: "ai-pill ai-pill--info",
        styles: {
          marginLeft: "6px",
          padding: "1px 6px",
          borderRadius: "3px",
          fontSize: "10px",
          flexShrink: "0",
        },
        textContent: "✅ 已综述",
      });
      nodeElement.appendChild(reviewedBadge);
    }

    // 悬停效果
    nodeElement.addEventListener("mouseenter", () => {
      nodeElement.style.background = "var(--ai-review-node-hover)";
      nodeElement.style.borderColor = "var(--ai-accent)";
    });
    nodeElement.addEventListener("mouseleave", () => {
      nodeElement.style.background = "var(--ai-review-node-bg)";
      nodeElement.style.borderColor = "var(--ai-border)";
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
          borderLeft: "1px solid var(--ai-border)",
          borderRight: "1px solid var(--ai-border)",
          borderBottom: "1px solid var(--ai-border)",
          borderRadius: "0 0 6px 6px",
          background: "var(--ai-review-children-bg)",
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
        borderBottom: "1px solid var(--ai-border)",
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
        color: "var(--ai-text-muted)",
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
      pdfElement.style.background = "var(--ai-hover)";
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
    if (this.askQuestionButton) {
      this.askQuestionButton.disabled = this.selectedPdfCount === 0;
      this.askQuestionButton.style.opacity =
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

  private normalizeTableEntryName(entry: string): string {
    return entry.trim().replace(/\s+/g, " ").toLowerCase();
  }

  private parseMarkdownTableCells(line: string): string[] {
    const content = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    return content.split("|").map((cell) => cell.trim());
  }

  private isMarkdownSeparatorRow(cells: string[]): boolean {
    return (
      cells.length > 0 &&
      cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")))
    );
  }

  private parseTableTemplateEntries(template: string): string[] {
    const entries: string[] = [];
    const seen = new Set<string>();

    for (const line of template.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("|")) continue;

      const cells = this.parseMarkdownTableCells(trimmed);
      if (cells.length < 2 || this.isMarkdownSeparatorRow(cells)) continue;

      const first = cells[0].trim();
      const normalizedFirst = this.normalizeTableEntryName(first);
      if (!normalizedFirst) continue;
      if (
        normalizedFirst === "维度" ||
        normalizedFirst === "dimension" ||
        normalizedFirst === "field"
      ) {
        continue;
      }

      if (seen.has(normalizedFirst)) continue;
      seen.add(normalizedFirst);
      entries.push(first);
    }

    return entries;
  }

  private buildTableTemplateFromEntries(entries: string[]): string {
    if (entries.length === 0) {
      return DEFAULT_TABLE_TEMPLATE;
    }
    const rows = entries.map((entry) => `| ${entry} | |`);
    return ["| 维度 | 内容 |", "|------|------|", ...rows].join("\n");
  }

  private mergeUniqueEntries(groups: string[][]): string[] {
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const group of groups) {
      for (const entry of group) {
        const value = entry.trim();
        if (!value) continue;
        const normalized = this.normalizeTableEntryName(value);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        merged.push(value);
      }
    }
    return merged;
  }

  private async loadFirstCollectionTableEntries(): Promise<void> {
    this.firstCollectionTableEntries = [];
    for (const node of this.treeNodes) {
      try {
        const tableContent = await LiteratureReviewService.findTableNote(
          node.item,
        );
        if (!tableContent) continue;
        const entries = this.parseTableTemplateEntries(tableContent);
        if (entries.length > 0) {
          this.firstCollectionTableEntries = entries;
          return;
        }
      } catch {
        // ignore invalid table note
      }
    }
  }

  private getSavedTargetedSelectedEntries(): Set<string> | null {
    const raw =
      (Zotero.Prefs.get(
        TARGETED_SELECTED_TABLE_ENTRIES_PREF_KEY,
        true,
      ) as string) || "";
    if (!raw.trim()) return null;

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) return null;
      const normalized = parsed
        .filter((item) => typeof item === "string")
        .map((item) => this.normalizeTableEntryName(item))
        .filter(Boolean);
      return normalized.length > 0 ? new Set(normalized) : null;
    } catch {
      return null;
    }
  }

  private refreshTargetedTableEntryOptions(): void {
    if (!this.targetedTableEntriesContainer) return;

    const template =
      this.tablePromptTextarea?.value.trim() ||
      this.getCurrentTablePreset().prompt ||
      DEFAULT_TABLE_TEMPLATE;
    const templateEntries = this.parseTableTemplateEntries(template);
    const baseEntries =
      this.firstCollectionTableEntries.length > 0
        ? this.firstCollectionTableEntries
        : templateEntries;
    const currentAppendingEntries = this.targetedAppendTableEntriesCheckbox
      ?.checked
      ? this.parseExtraTargetedTableEntries(
          this.targetedNewEntriesTextarea?.value || "",
        )
      : [];
    const entries = this.mergeUniqueEntries([
      baseEntries,
      currentAppendingEntries,
    ]);
    const previousStates = new Map<string, boolean>();
    this.targetedTableEntryCheckboxes.forEach((checkbox, entry) => {
      previousStates.set(entry, checkbox.checked);
    });
    const savedSelected =
      previousStates.size === 0 ? this.getSavedTargetedSelectedEntries() : null;

    this.targetedTableEntriesContainer.innerHTML = "";
    this.targetedTableEntryCheckboxes.clear();

    if (entries.length === 0) {
      this.targetedTableEntriesContainer.appendChild(
        this.createElement("div", {
          styles: {
            fontSize: "12px",
            color: "var(--ai-text-muted)",
          },
          textContent: "当前表格模板未解析到可选条目",
        }),
      );
      return;
    }

    for (const entry of entries) {
      const label = this.createElement("label", {
        styles: {
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "4px 6px",
          borderRadius: "4px",
          fontSize: "12px",
          color: "var(--ai-text)",
          background: "var(--ai-review-node-bg)",
          border: "1px solid var(--ai-border)",
          cursor: "pointer",
        },
      });

      const checkbox = this.createElement("input", {
        attributes: {
          type: "checkbox",
        },
        styles: {
          width: "14px",
          height: "14px",
          cursor: "pointer",
          flexShrink: "0",
        },
      }) as HTMLInputElement;
      const isCheckedFromPrev = previousStates.get(entry);
      if (typeof isCheckedFromPrev === "boolean") {
        checkbox.checked = isCheckedFromPrev;
      } else if (savedSelected) {
        checkbox.checked = savedSelected.has(
          this.normalizeTableEntryName(entry),
        );
      } else {
        checkbox.checked = true;
      }

      const text = this.createElement("span", {
        styles: {
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: "0",
        },
        textContent: entry,
      });

      label.appendChild(checkbox);
      label.appendChild(text);
      this.targetedTableEntriesContainer.appendChild(label);
      this.targetedTableEntryCheckboxes.set(entry, checkbox);
    }

    const hasSelected = Array.from(
      this.targetedTableEntryCheckboxes.values(),
    ).some((checkbox) => checkbox.checked);
    if (!hasSelected) {
      this.setAllTargetedTableEntriesChecked(true);
    }
  }

  private setAllTargetedTableEntriesChecked(checked: boolean): void {
    this.targetedTableEntryCheckboxes.forEach((checkbox) => {
      checkbox.checked = checked;
    });
  }

  private collectSelectedTargetedTableEntries(): string[] {
    const selected: string[] = [];
    this.targetedTableEntryCheckboxes.forEach((checkbox, entry) => {
      if (checkbox.checked) {
        selected.push(entry);
      }
    });
    return selected;
  }

  private parseExtraTargetedTableEntries(raw: string): string[] {
    const result: string[] = [];
    const seen = new Set<string>();

    for (const part of raw.split(/[\n,，;；]+/)) {
      const value = part.trim();
      if (!value) continue;
      const normalized = this.normalizeTableEntryName(value);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      result.push(value);
    }

    return result;
  }

  private appendTableEntriesToTemplate(
    template: string,
    extraEntries: string[],
  ): string {
    if (extraEntries.length === 0) return template;

    const existingEntries = new Set(
      this.parseTableTemplateEntries(template).map((entry) =>
        this.normalizeTableEntryName(entry),
      ),
    );
    const toAppend = extraEntries.filter(
      (entry) => !existingEntries.has(this.normalizeTableEntryName(entry)),
    );
    if (toAppend.length === 0) return template;

    const lines = template.split("\n");
    let insertIndex = lines.length;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim().startsWith("|")) {
        insertIndex = i + 1;
        break;
      }
    }

    let columnCount = 2;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("|")) continue;
      const cells = this.parseMarkdownTableCells(trimmed);
      if (cells.length >= 2 && !this.isMarkdownSeparatorRow(cells)) {
        columnCount = Math.max(2, cells.length);
        break;
      }
    }

    const tailCells = Array.from(
      { length: Math.max(columnCount - 1, 1) },
      () => "",
    );
    const appendedRows = toAppend.map(
      (entry) => `| ${entry} | ${tailCells.join(" | ")} |`,
    );
    lines.splice(insertIndex, 0, ...appendedRows);
    return lines.join("\n");
  }

  private updateTargetedAppendEntryInputState(): void {
    if (!this.targetedNewEntriesTextarea) return;
    const enabled = this.targetedAppendTableEntriesCheckbox?.checked || false;
    this.targetedNewEntriesTextarea.disabled = !enabled;
    this.targetedNewEntriesTextarea.style.opacity = enabled ? "1" : "0.55";
  }

  /**
   * 处理生成综述
   */
  private async handleGenerate(): Promise<void> {
    if (
      !this.collection ||
      !this.nameInput ||
      !this.reviewPromptTextarea ||
      !this.tablePromptTextarea
    ) {
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
      `综述 ${new Date().toISOString().slice(2, 10)}`;
    const reviewPrompt =
      this.reviewPromptTextarea.value.trim() ||
      (getPref("tableReviewPrompt" as any) as string) ||
      DEFAULT_TABLE_REVIEW_PROMPT;
    const tableTemplate =
      this.tablePromptTextarea.value.trim() ||
      (getPref("tableTemplate" as any) as string) ||
      DEFAULT_TABLE_TEMPLATE;

    try {
      setPref("tableReviewPrompt" as any, reviewPrompt as any);
      setPref("tableTemplate" as any, tableTemplate as any);

      // 通过任务队列入队
      const { TaskQueueManager } = await import("../taskQueue");
      const manager = TaskQueueManager.getInstance();
      await manager.addReviewTask(
        this.collection,
        selectedPdfs,
        reviewName,
        reviewPrompt,
        tableTemplate,
      );

      new ztoolkit.ProgressWindow("AI Butler", {
        closeOnClick: true,
        closeTime: 3000,
      })
        .createLine({
          text: `✅ 综述任务已加入队列: ${reviewName}`,
          type: "success",
        })
        .show();

      // 跳转到任务队列界面
      MainWindow.getInstance().switchTab("tasks");
    } catch (error: any) {
      ztoolkit.log("[AI-Butler] 添加综述任务失败:", error);
      new ztoolkit.ProgressWindow("AI Butler", {
        closeOnClick: true,
        closeTime: 5000,
      })
        .createLine({
          text: `❌ 添加失败: ${error.message || error}`,
          type: "error",
        })
        .show();
    }
  }

  /**
   * 基于表格进行针对性提问（独立于综述）
   */
  private async handleAskFromTables(): Promise<void> {
    if (
      !this.collection ||
      !this.tablePromptTextarea ||
      !this.targetedPromptTextarea
    ) {
      return;
    }

    const selectedPdfs = this.collectSelectedPdfAttachments();
    if (selectedPdfs.length === 0) {
      new ztoolkit.ProgressWindow("AI Butler", {
        closeOnClick: true,
        closeTime: 3000,
      })
        .createLine({ text: "请至少选择一个 PDF", type: "error" })
        .show();
      return;
    }

    const tableTemplate =
      this.tablePromptTextarea.value.trim() ||
      (getPref("tableTemplate" as any) as string) ||
      DEFAULT_TABLE_TEMPLATE;
    const configuredTemplateEntries =
      this.parseTableTemplateEntries(tableTemplate);
    const baseEntriesForAsk =
      this.firstCollectionTableEntries.length > 0
        ? this.firstCollectionTableEntries
        : configuredTemplateEntries;
    const baseTemplateForAsk =
      this.firstCollectionTableEntries.length > 0
        ? this.buildTableTemplateFromEntries(baseEntriesForAsk)
        : tableTemplate;
    const selectedTableEntries = this.collectSelectedTargetedTableEntries();
    if (selectedTableEntries.length === 0) {
      new ztoolkit.ProgressWindow("AI Butler", {
        closeOnClick: true,
        closeTime: 3000,
      })
        .createLine({ text: "请至少勾选一个表格条目", type: "error" })
        .show();
      return;
    }
    const appendExtraEntries =
      this.targetedAppendTableEntriesCheckbox?.checked || false;
    const extraEntriesRaw = this.targetedNewEntriesTextarea?.value.trim() || "";
    const extraEntries = appendExtraEntries
      ? this.parseExtraTargetedTableEntries(extraEntriesRaw)
      : [];
    if (appendExtraEntries && extraEntries.length === 0) {
      new ztoolkit.ProgressWindow("AI Butler", {
        closeOnClick: true,
        closeTime: 3000,
      })
        .createLine({
          text: "已勾选追加新条目，请填写至少一个新表格条目",
          type: "error",
        })
        .show();
      return;
    }
    const targetedTemplate = appendExtraEntries
      ? this.appendTableEntriesToTemplate(baseTemplateForAsk, extraEntries)
      : baseTemplateForAsk;
    const effectiveSelectedEntries = appendExtraEntries
      ? Array.from(new Set([...selectedTableEntries, ...extraEntries]))
      : selectedTableEntries;
    const targetedPromptRaw =
      this.targetedPromptTextarea.value.trim() ||
      DEFAULT_TARGETED_QUESTION_PROMPT;
    const targetedPrompt = targetedPromptRaw.replace(
      /\$\{question\}/g,
      "请围绕我在提示词中的问题作答",
    );

    try {
      setPref("tableTemplate" as any, tableTemplate as any);
      Zotero.Prefs.set(TARGETED_PROMPT_PREF_KEY, targetedPromptRaw, true);
      Zotero.Prefs.set(
        TARGETED_APPEND_TABLE_ENTRIES_PREF_KEY,
        appendExtraEntries,
        true,
      );
      Zotero.Prefs.set(
        TARGETED_NEW_TABLE_ENTRIES_PREF_KEY,
        extraEntriesRaw,
        true,
      );
      Zotero.Prefs.set(
        TARGETED_SELECTED_TABLE_ENTRIES_PREF_KEY,
        JSON.stringify(selectedTableEntries),
        true,
      );

      const noteTitle = `针对性提问 ${new Date().toISOString().slice(2, 10)}`;
      const { TaskQueueManager } = await import("../taskQueue");
      const manager = TaskQueueManager.getInstance();
      await manager.addTargetedQuestionTask(
        this.collection,
        selectedPdfs,
        noteTitle,
        targetedPrompt,
        targetedTemplate,
        {
          selectedTableEntries: effectiveSelectedEntries,
          appendedTableEntries: appendExtraEntries ? extraEntries : [],
        },
      );

      new ztoolkit.ProgressWindow("AI Butler", {
        closeOnClick: true,
        closeTime: 3500,
      })
        .createLine({
          text: `✅ 针对性提问任务已加入队列: ${noteTitle}`,
          type: "success",
        })
        .show();

      MainWindow.getInstance().switchTab("tasks");
    } catch (error: any) {
      ztoolkit.log("[AI-Butler] 添加针对性提问任务失败:", error);
      new ztoolkit.ProgressWindow("AI Butler", {
        closeOnClick: true,
        closeTime: 5000,
      })
        .createLine({
          text: `❌ 添加失败: ${error.message || error}`,
          type: "error",
        })
        .show();
    }
  }

  /**
   * 处理逐篇填表
   */
  private async handleFillTables(): Promise<void> {
    if (!this.collection) return;

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

    try {
      const { TaskQueueManager } = await import("../taskQueue");
      const manager = TaskQueueManager.getInstance();

      // 为每个选中的 PDF 的父条目创建填表任务
      const addedItems = new Set<number>();
      let count = 0;
      for (const pdfAtt of selectedPdfs) {
        const parentID = pdfAtt.parentID;
        if (parentID && !addedItems.has(parentID)) {
          addedItems.add(parentID);
          const parentItem = await Zotero.Items.getAsync(parentID);
          if (parentItem) {
            await manager.addTableFillTask(parentItem);
            count++;
          }
        }
      }

      new ztoolkit.ProgressWindow("AI Butler", {
        closeOnClick: true,
        closeTime: 3000,
      })
        .createLine({
          text: `✅ 已添加 ${count} 个填表任务到队列`,
          type: "success",
        })
        .show();

      // 跳转到任务队列界面
      MainWindow.getInstance().switchTab("tasks");
    } catch (error: any) {
      ztoolkit.log("[AI-Butler] 添加填表任务失败:", error);
      new ztoolkit.ProgressWindow("AI Butler", {
        closeOnClick: true,
        closeTime: 5000,
      })
        .createLine({
          text: `❌ 添加失败: ${error.message || error}`,
          type: "error",
        })
        .show();
    }
  }

  // ==================== 预设管理方法 ====================

  private makeDefaultPresets(
    prefix: string,
    defaultPrompt: string,
  ): PromptPreset[] {
    const presets: PromptPreset[] = [];
    for (let i = 1; i <= MAX_PRESETS; i++) {
      presets.push({
        id: `preset-${i}`,
        name: `${prefix}${i}`,
        prompt: defaultPrompt,
      });
    }
    return presets;
  }

  private normalizePresets(
    raw: unknown,
    prefix: string,
    defaultPrompt: string,
    normalizePrompt?: (prompt: string) => string,
  ): PromptPreset[] {
    const defaults = this.makeDefaultPresets(prefix, defaultPrompt);
    if (!Array.isArray(raw)) return defaults;

    for (let i = 0; i < MAX_PRESETS; i++) {
      const current = raw[i] as any;
      if (!current || typeof current !== "object") continue;
      if (typeof current.name === "string" && current.name.trim()) {
        defaults[i].name = current.name.trim();
      }
      if (typeof current.prompt === "string" && current.prompt.trim()) {
        const normalized = normalizePrompt
          ? normalizePrompt(current.prompt)
          : current.prompt;
        defaults[i].prompt = normalized;
      }
    }
    return defaults;
  }

  private loadPromptPresets(): void {
    const sharedReviewPrompt =
      (getPref("tableReviewPrompt" as any) as string) ||
      DEFAULT_TABLE_REVIEW_PROMPT;
    const sharedTablePrompt =
      (getPref("tableTemplate" as any) as string) || DEFAULT_TABLE_TEMPLATE;
    const normalizeTableTemplatePrompt = (prompt: string): string => {
      // 兼容旧版本：如果预设里仍是“填表提示词”，自动纠正为模板文本
      if (
        prompt.includes("${tableTemplate}") ||
        prompt.includes("只输出填好的表格") ||
        prompt.includes("填写每个维度")
      ) {
        return sharedTablePrompt;
      }
      return prompt;
    };

    try {
      const savedReview = Zotero.Prefs.get(REVIEW_PRESETS_PREF_KEY, true) as
        | string
        | undefined;
      this.reviewPresets = this.normalizePresets(
        savedReview ? JSON.parse(savedReview) : null,
        "综述预设",
        sharedReviewPrompt,
      );
    } catch {
      this.reviewPresets = this.makeDefaultPresets(
        "综述预设",
        sharedReviewPrompt,
      );
    }

    try {
      const savedTable = Zotero.Prefs.get(TABLE_PRESETS_PREF_KEY, true) as
        | string
        | undefined;
      this.tablePresets = this.normalizePresets(
        savedTable ? JSON.parse(savedTable) : null,
        "表格预设",
        sharedTablePrompt,
        normalizeTableTemplatePrompt,
      );
    } catch {
      this.tablePresets = this.makeDefaultPresets(
        "表格预设",
        sharedTablePrompt,
      );
    }

    const savedReviewPreset = Zotero.Prefs.get(
      REVIEW_CURRENT_PRESET_PREF_KEY,
      true,
    ) as string;
    const savedTablePreset = Zotero.Prefs.get(
      TABLE_CURRENT_PRESET_PREF_KEY,
      true,
    ) as string;
    this.currentReviewPresetId = this.reviewPresets.some(
      (p) => p.id === savedReviewPreset,
    )
      ? savedReviewPreset
      : "preset-1";
    this.currentTablePresetId = this.tablePresets.some(
      (p) => p.id === savedTablePreset,
    )
      ? savedTablePreset
      : "preset-1";
  }

  private savePromptPresets(): void {
    try {
      Zotero.Prefs.set(
        REVIEW_PRESETS_PREF_KEY,
        JSON.stringify(this.reviewPresets),
        true,
      );
      Zotero.Prefs.set(
        TABLE_PRESETS_PREF_KEY,
        JSON.stringify(this.tablePresets),
        true,
      );
      Zotero.Prefs.set(
        REVIEW_CURRENT_PRESET_PREF_KEY,
        this.currentReviewPresetId,
        true,
      );
      Zotero.Prefs.set(
        TABLE_CURRENT_PRESET_PREF_KEY,
        this.currentTablePresetId,
        true,
      );
    } catch (e) {
      ztoolkit.log("[AI-Butler] 保存预设失败:", e);
    }
  }

  private getPresetOptions(
    presets: PromptPreset[],
  ): Array<{ value: string; label: string }> {
    return presets.map((p) => ({ value: p.id, label: p.name }));
  }

  private getCurrentReviewPreset(): PromptPreset {
    return (
      this.reviewPresets.find((p) => p.id === this.currentReviewPresetId) ||
      this.reviewPresets[0]
    );
  }

  private getCurrentTablePreset(): PromptPreset {
    return (
      this.tablePresets.find((p) => p.id === this.currentTablePresetId) ||
      this.tablePresets[0]
    );
  }

  private handleReviewPresetChange(presetId: string): void {
    this.currentReviewPresetId = presetId;
    this.savePromptPresets();
    const current = this.getCurrentReviewPreset();
    if (this.reviewPromptTextarea) {
      this.reviewPromptTextarea.value = current.prompt;
    }
    if (this.reviewPresetNameInput) {
      this.reviewPresetNameInput.value = current.name;
    }
  }

  private handleTablePresetChange(presetId: string): void {
    this.currentTablePresetId = presetId;
    this.savePromptPresets();
    const current = this.getCurrentTablePreset();
    if (this.tablePromptTextarea) {
      this.tablePromptTextarea.value = current.prompt;
    }
    if (this.tablePresetNameInput) {
      this.tablePresetNameInput.value = current.name;
    }
    this.refreshTargetedTableEntryOptions();
  }

  private handleSaveReviewPreset(): void {
    const current = this.getCurrentReviewPreset();
    if (this.reviewPromptTextarea) {
      current.prompt = this.reviewPromptTextarea.value.trim() || current.prompt;
    }
    if (this.reviewPresetNameInput) {
      current.name = this.reviewPresetNameInput.value.trim() || current.name;
    }
    this.updateReviewPresetSelect();
    this.savePromptPresets();
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 2000,
    })
      .createLine({ text: `✅ 已保存 ${current.name}`, type: "success" })
      .show();
  }

  private handleSaveTablePreset(): void {
    const current = this.getCurrentTablePreset();
    if (this.tablePromptTextarea) {
      current.prompt = this.tablePromptTextarea.value.trim() || current.prompt;
    }
    if (this.tablePresetNameInput) {
      current.name = this.tablePresetNameInput.value.trim() || current.name;
    }
    this.updateTablePresetSelect();
    this.savePromptPresets();
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 2000,
    })
      .createLine({ text: `✅ 已保存 ${current.name}`, type: "success" })
      .show();
  }

  private handleReviewPresetRename(): void {
    const current = this.getCurrentReviewPreset();
    if (this.reviewPresetNameInput) {
      const newName = this.reviewPresetNameInput.value.trim();
      if (newName) current.name = newName;
    }
    this.updateReviewPresetSelect();
    this.savePromptPresets();
  }

  private handleTablePresetRename(): void {
    const current = this.getCurrentTablePreset();
    if (this.tablePresetNameInput) {
      const newName = this.tablePresetNameInput.value.trim();
      if (newName) current.name = newName;
    }
    this.updateTablePresetSelect();
    this.savePromptPresets();
  }

  private updateReviewPresetSelect(): void {
    if (!this.reviewPresetControlsContainer || !this.reviewPresetSelect) return;
    this.reviewPresetSelect.remove();
    this.reviewPresetSelect = createSelect(
      "review-preset-select",
      this.getPresetOptions(this.reviewPresets),
      this.currentReviewPresetId,
      (newValue: string) => this.handleReviewPresetChange(newValue),
    );
    this.reviewPresetSelect.style.minWidth = "140px";
    this.reviewPresetControlsContainer.insertBefore(
      this.reviewPresetSelect,
      this.reviewPresetControlsContainer.firstChild,
    );
  }

  private updateTablePresetSelect(): void {
    if (!this.tablePresetControlsContainer || !this.tablePresetSelect) return;
    this.tablePresetSelect.remove();
    this.tablePresetSelect = createSelect(
      "table-preset-select",
      this.getPresetOptions(this.tablePresets),
      this.currentTablePresetId,
      (newValue: string) => this.handleTablePresetChange(newValue),
    );
    this.tablePresetSelect.style.minWidth = "140px";
    this.tablePresetControlsContainer.insertBefore(
      this.tablePresetSelect,
      this.tablePresetControlsContainer.firstChild,
    );
  }
}
