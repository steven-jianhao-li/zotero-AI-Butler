/**
 * ================================================================
 * 文献综述服务
 * ================================================================
 *
 * 本模块提供文献综述生成的核心服务
 *
 * 主要职责:
 * 1. 创建报告条目
 * 2. 将选中的 PDF 作为附件添加到报告
 * 3. 逐篇文献按表格模板填表（并行，可复用已有表格）
 * 4. 汇总表格内容生成文献综述
 * 5. 生成 AI 笔记并关联到报告条目
 *
 * @module literatureReviewService
 * @author AI-Butler Team
 */

import { PDFExtractor } from "./pdfExtractor";
import { NoteGenerator } from "./noteGenerator";
import LLMService from "./llmService";
import {
  LLMNoteMetadataService,
  type LLMNoteMetadata,
} from "./llmNoteMetadata";
import { getPref } from "../utils/prefs";
import { marked } from "marked";
import {
  DEFAULT_TABLE_TEMPLATE,
  DEFAULT_TABLE_FILL_PROMPT,
  DEFAULT_TABLE_REVIEW_PROMPT,
} from "../utils/prompts";

/** 表格笔记管理策略类型 */
type TableStrategy = "skip" | "overwrite";

/** AI-Table 标签名，用于标识文献填表笔记 */
const TABLE_NOTE_TAG = "AI-Table";

/**
 * PDF 文件信息（带文件路径）
 */
interface PdfFileData {
  title: string;
  filePath: string;
  content: string;
  isBase64: boolean;
}

interface TargetedAnswerOptions {
  selectedTableEntries?: string[];
  appendedTableEntries?: string[];
}

/**
 * 文献综述服务类
 */
export class LiteratureReviewService {
  private static lastTableMetadataByItemId = new Map<number, LLMNoteMetadata>();

  /**
   * 生成文献综述（表格驱动的两阶段流程）
   *
   * 流程:
   * 1. 创建报告条目
   * 2. 添加 PDF 附件到报告
   * 3. 逐篇填表（并行，复用已有表格）
   * 4. 汇总所有表格 → 调用 LLM 生成综述
   * 5. 创建综述笔记
   *
   * @param collection 目标分类
   * @param pdfAttachments 选中的 PDF 附件
   * @param reviewName 综述名称
   * @param prompt 用户自定义综述提示词（可选，默认使用 tableReviewPrompt）
   * @param progressCallback 进度回调
   * @returns 创建的报告条目
   */
  static async generateReview(
    collection: Zotero.Collection,
    pdfAttachments: Zotero.Item[],
    reviewName: string,
    prompt: string,
    tableTemplateOverride?: string,
    progressCallback?: (message: string, progress: number) => void,
  ): Promise<Zotero.Item> {
    // 1. 逐篇填表阶段
    const tableTemplate =
      tableTemplateOverride ||
      (getPref("tableTemplate" as any) as string) ||
      DEFAULT_TABLE_TEMPLATE;
    const fillPrompt =
      (getPref("tableFillPrompt" as any) as string) ||
      DEFAULT_TABLE_FILL_PROMPT;
    const concurrency = (getPref("tableFillConcurrency" as any) as number) || 3;

    // 构建父条目 → PDF 附件的映射
    const itemPdfPairs: Array<{
      parentItem: Zotero.Item;
      pdfAttachment: Zotero.Item;
    }> = [];
    for (const pdfAtt of pdfAttachments) {
      const parentID = pdfAtt.parentID;
      if (parentID) {
        const parentItem = await Zotero.Items.getAsync(parentID);
        if (parentItem) {
          itemPdfPairs.push({ parentItem, pdfAttachment: pdfAtt });
        }
      }
    }

    progressCallback?.("正在逐篇填表...", 10);

    const tableResults = await this.fillTablesInParallel(
      itemPdfPairs,
      tableTemplate,
      fillPrompt,
      concurrency,
      undefined,
      (done, total) => {
        const progress = 10 + Math.floor((done / total) * 50);
        progressCallback?.(`正在填表 (${done}/${total})...`, progress);
      },
    );

    // 2. 汇总表格并生成综述
    progressCallback?.("正在汇总表格...", 65);

    const aggregated = this.aggregateTableContents(tableResults, itemPdfPairs);

    progressCallback?.("正在生成综述...", 70);

    const reviewPrompt =
      prompt ||
      (getPref("tableReviewPrompt" as any) as string) ||
      DEFAULT_TABLE_REVIEW_PROMPT;
    const fullPrompt = `${reviewPrompt}\n\n以下是各文献的结构化信息表格：\n\n${aggregated}`;

    const reviewResponse = await LLMService.generate({
      task: "literature-review",
      prompt: fullPrompt,
      content: { kind: "text", text: aggregated, policy: "text" },
    });
    let summaryContent = reviewResponse.text;

    // 3. 后处理引用链接
    summaryContent = await this.postProcessCitations(
      summaryContent,
      itemPdfPairs,
    );

    progressCallback?.("正在创建笔记...", 90);

    // 4. 创建独立笔记（直接放在分类目录下）
    const reviewNote = await this.createStandaloneReviewNote(
      collection,
      reviewName,
      summaryContent,
      LLMNoteMetadataService.fromResponse("literature-review", reviewResponse),
    );

    // 5. 为所有已纳入综述的文献添加 AI-Reviewed 标签
    for (const { parentItem } of itemPdfPairs) {
      try {
        const existingTags: Array<{ tag: string }> =
          (parentItem as any).getTags?.() || [];
        if (!existingTags.some((t) => t.tag === "AI-Reviewed")) {
          parentItem.addTag("AI-Reviewed");
          await parentItem.saveTx();
        }
      } catch (e) {
        ztoolkit.log(
          `[AI-Butler] 添加 AI-Reviewed 标签失败: ${parentItem.getField("title")}`,
          e,
        );
      }
    }

    progressCallback?.("完成!", 100);

    return reviewNote;
  }

  /**
   * 基于表格进行独立的针对性提问
   *
   * 与综述流程独立，但同样通过表格汇总后作答。
   */
  static async generateTargetedAnswer(
    collection: Zotero.Collection,
    pdfAttachments: Zotero.Item[],
    noteTitle: string,
    questionPrompt: string,
    tableTemplateOverride?: string,
    options?: TargetedAnswerOptions,
    progressCallback?: (message: string, progress: number) => void,
  ): Promise<Zotero.Item> {
    const tableTemplate =
      tableTemplateOverride ||
      (getPref("tableTemplate" as any) as string) ||
      DEFAULT_TABLE_TEMPLATE;
    const fillPrompt =
      (getPref("tableFillPrompt" as any) as string) ||
      DEFAULT_TABLE_FILL_PROMPT;
    const concurrency = (getPref("tableFillConcurrency" as any) as number) || 3;
    const appendedTableEntries = Array.from(
      new Set(
        (options?.appendedTableEntries || [])
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    );
    const forceMergeAppendedEntries = appendedTableEntries.length > 0;

    const itemPdfPairs: Array<{
      parentItem: Zotero.Item;
      pdfAttachment: Zotero.Item;
    }> = [];
    const parentSeen = new Set<number>();
    for (const pdfAtt of pdfAttachments) {
      const parentID = pdfAtt.parentID;
      if (!parentID || parentSeen.has(parentID)) continue;
      const parentItem = await Zotero.Items.getAsync(parentID);
      if (parentItem) {
        parentSeen.add(parentID);
        itemPdfPairs.push({ parentItem, pdfAttachment: pdfAtt });
      }
    }

    progressCallback?.("正在逐篇填表...", 10);

    const tableResults = forceMergeAppendedEntries
      ? await this.appendTableEntriesInParallel(
          itemPdfPairs,
          appendedTableEntries,
          fillPrompt,
          concurrency,
          (done, total) => {
            const progress = 10 + Math.floor((done / total) * 50);
            progressCallback?.(`正在追加填表 (${done}/${total})...`, progress);
          },
        )
      : await this.fillTablesInParallel(
          itemPdfPairs,
          tableTemplate,
          fillPrompt,
          concurrency,
          undefined,
          (done, total) => {
            const progress = 10 + Math.floor((done / total) * 50);
            progressCallback?.(`正在填表 (${done}/${total})...`, progress);
          },
        );

    const selectedTableEntries = Array.from(
      new Set(
        (options?.selectedTableEntries || [])
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    );
    const filteredTableResults = this.filterTableResultsByEntries(
      tableResults,
      selectedTableEntries,
    );

    progressCallback?.("正在汇总表格...", 65);
    const aggregated = this.aggregateTableContents(
      filteredTableResults,
      itemPdfPairs,
    );

    const selectedEntriesInstruction =
      selectedTableEntries.length > 0
        ? `\n\n请仅使用以下表格条目回答问题：${selectedTableEntries.join("、")}。若条目证据不足，请明确说明。`
        : "";

    const fullPrompt = `${questionPrompt}${selectedEntriesInstruction}\n\n以下是各文献的结构化信息表格：\n\n${aggregated}`;

    progressCallback?.("正在回答问题...", 75);
    const answerResponse = await LLMService.generate({
      task: "literature-review",
      prompt: fullPrompt,
      content: { kind: "text", text: aggregated, policy: "text" },
    });
    let answerContent = answerResponse.text;
    answerContent = await this.postProcessCitations(
      answerContent,
      itemPdfPairs,
    );

    progressCallback?.("正在创建笔记...", 90);
    const note = await this.createStandaloneReviewNote(
      collection,
      noteTitle,
      answerContent,
      LLMNoteMetadataService.fromResponse("literature-review", answerResponse),
    );
    progressCallback?.("完成!", 100);
    return note;
  }

  private static normalizeTableEntryName(entry: string): string {
    return entry.trim().replace(/\s+/g, " ").toLowerCase();
  }

  private static parseMarkdownTableCells(line: string): string[] {
    const content = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    return content.split("|").map((cell) => cell.trim());
  }

  private static isMarkdownSeparatorRow(cells: string[]): boolean {
    return (
      cells.length > 0 &&
      cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")))
    );
  }

  private static filterSingleTableByEntries(
    tableContent: string,
    selectedEntries: Set<string>,
  ): string {
    const lines = tableContent.split("\n");
    const filtered: string[] = [];
    let headerCaptured = false;
    let separatorCaptured = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("|")) {
        filtered.push(line);
        continue;
      }

      const cells = this.parseMarkdownTableCells(trimmed);
      if (!headerCaptured) {
        headerCaptured = true;
        filtered.push(line);
        continue;
      }
      if (!separatorCaptured && this.isMarkdownSeparatorRow(cells)) {
        separatorCaptured = true;
        filtered.push(line);
        continue;
      }

      const rowKey = this.normalizeTableEntryName(cells[0] || "");
      if (rowKey && selectedEntries.has(rowKey)) {
        filtered.push(line);
      }
    }

    return filtered.join("\n");
  }

  private static filterTableResultsByEntries(
    tableResults: Map<number, string>,
    selectedEntries: string[],
  ): Map<number, string> {
    if (selectedEntries.length === 0) return tableResults;

    const selectedEntrySet = new Set(
      selectedEntries
        .map((entry) => this.normalizeTableEntryName(entry))
        .filter(Boolean),
    );
    if (selectedEntrySet.size === 0) return tableResults;

    const filteredResults = new Map<number, string>();
    for (const [itemId, tableContent] of tableResults) {
      filteredResults.set(
        itemId,
        this.filterSingleTableByEntries(tableContent, selectedEntrySet),
      );
    }
    return filteredResults;
  }

  private static buildTableTemplateFromEntries(entries: string[]): string {
    if (entries.length === 0) {
      return DEFAULT_TABLE_TEMPLATE;
    }
    const rows = entries.map((entry) => `| ${entry} | |`);
    return ["| 维度 | 内容 |", "|------|------|", ...rows].join("\n");
  }

  private static buildAppendOnlyFillPrompt(
    fillPrompt: string,
    appendedEntries: string[],
  ): string {
    const entryList = appendedEntries.map((entry) => `- ${entry}`).join("\n");
    return `${fillPrompt}

【追加填表模式】
仅填写以下新增条目：
${entryList}

额外要求：
1. 不要重写已有条目
2. 只输出新增条目的 Markdown 表格（或数据行）
3. 不要输出解释性文字`;
  }

  private static extractTableDataRows(md: string): string[] {
    const lines = md
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("|"));
    if (lines.length === 0) return [];

    const dataRows: string[] = [];
    let headerDone = false;
    for (const line of lines) {
      const cells = this.parseMarkdownTableCells(line);
      if (!headerDone) {
        if (this.isMarkdownSeparatorRow(cells)) {
          headerDone = true;
        }
        continue;
      }
      if (!this.isMarkdownSeparatorRow(cells)) {
        dataRows.push(line);
      }
    }

    if (dataRows.length > 0) return dataRows;

    const nonSeparator = lines.filter(
      (line) =>
        !this.isMarkdownSeparatorRow(this.parseMarkdownTableCells(line)),
    );
    if (nonSeparator.length > 1) {
      return nonSeparator.slice(1);
    }
    return nonSeparator.length === 1 ? nonSeparator : [];
  }

  private static extractRowEntryName(row: string): string {
    const cells = this.parseMarkdownTableCells(row);
    return this.normalizeTableEntryName(cells[0] || "");
  }

  private static mergeAppendRowsIntoExistingTable(
    existingTable: string,
    appendResult: string,
    appendTemplate: string,
    appendedEntries: string[],
  ): string {
    const allowedEntrySet = new Set(
      appendedEntries
        .map((entry) => this.normalizeTableEntryName(entry))
        .filter(Boolean),
    );

    const appendRowsRaw = this.extractTableDataRows(appendResult);
    const appendRows: string[] = [];
    const appendSeen = new Set<string>();
    for (const row of appendRowsRaw) {
      const rowKey = this.extractRowEntryName(row);
      if (!rowKey) continue;
      if (allowedEntrySet.size > 0 && !allowedEntrySet.has(rowKey)) continue;
      if (appendSeen.has(rowKey)) continue;
      appendSeen.add(rowKey);
      appendRows.push(row);
    }

    if (!existingTable.trim()) {
      if (appendRows.length > 0) {
        const templateLines = appendTemplate
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.startsWith("|"));
        const header = templateLines[0] || "| 维度 | 内容 |";
        const separator =
          templateLines.find((line) =>
            this.isMarkdownSeparatorRow(this.parseMarkdownTableCells(line)),
          ) || "|------|------|";
        return [header, separator, ...appendRows].join("\n");
      }
      return appendResult.trim() || appendTemplate;
    }

    if (appendRows.length === 0) {
      return existingTable;
    }

    const existingRows = this.extractTableDataRows(existingTable);
    const existingEntrySet = new Set(
      existingRows.map((row) => this.extractRowEntryName(row)).filter(Boolean),
    );
    const rowsToInsert = appendRows.filter(
      (row) => !existingEntrySet.has(this.extractRowEntryName(row)),
    );
    if (rowsToInsert.length === 0) {
      return existingTable;
    }

    const lines = existingTable.split("\n");
    let insertPos = lines.length;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim().startsWith("|")) {
        insertPos = i + 1;
        break;
      }
    }
    lines.splice(insertPos, 0, ...rowsToInsert);
    return lines.join("\n");
  }

  private static async appendTableEntriesInParallel(
    items: Array<{ parentItem: Zotero.Item; pdfAttachment: Zotero.Item }>,
    appendedEntries: string[],
    fillPrompt: string,
    concurrency: number,
    progressCallback?: (done: number, total: number) => void,
  ): Promise<Map<number, string>> {
    const results = new Map<number, string>();
    let completed = 0;
    const total = items.length;
    const queue = [...items];
    const appendTemplate = this.buildTableTemplateFromEntries(appendedEntries);
    const appendPrompt = this.buildAppendOnlyFillPrompt(
      fillPrompt,
      appendedEntries,
    );

    const worker = async () => {
      while (queue.length > 0) {
        const task = queue.shift()!;
        try {
          const existingTable =
            (await this.findTableNote(task.parentItem)) || "";
          const appendResult = await this.fillTableForSinglePDF(
            task.parentItem,
            task.pdfAttachment,
            appendTemplate,
            appendPrompt,
          );
          const mergedTable = this.mergeAppendRowsIntoExistingTable(
            existingTable,
            appendResult,
            appendTemplate,
            appendedEntries,
          );
          await this.saveTableNote(task.parentItem, mergedTable, true);
          results.set(task.parentItem.id, mergedTable);
        } catch (error) {
          ztoolkit.log(
            `[AI-Butler] 追加填表失败: ${task.parentItem.getField("title")}`,
            error,
          );
          const fallback =
            (await this.findTableNote(task.parentItem)) ||
            `(追加填表失败: ${error instanceof Error ? error.message : String(error)})`;
          results.set(task.parentItem.id, fallback);
        }
        completed++;
        progressCallback?.(completed, total);
      }
    };

    const effectiveConcurrency = Math.min(concurrency, total);
    await Promise.all(
      Array.from({ length: effectiveConcurrency }, () => worker()),
    );

    return results;
  }

  // ==================== 表格填写相关方法 ====================

  /**
   * 对单篇文献的 PDF 进行填表
   *
   * @param item 文献条目
   * @param pdfAttachment PDF 附件
   * @param tableTemplate Markdown 表格模板
   * @param fillPrompt 填表提示词
   * @param progressCallback 进度回调
   * @returns 填好的 Markdown 表格字符串
   */
  static async fillTableForSinglePDF(
    item: Zotero.Item,
    pdfAttachment: Zotero.Item,
    tableTemplate: string,
    fillPrompt: string,
    progressCallback?: (message: string, progress: number) => void,
  ): Promise<string> {
    const itemTitle = (item.getField("title") as string) || "未知标题";

    progressCallback?.(`正在提取 PDF: ${itemTitle.slice(0, 30)}...`, 10);

    // 构建完整提示词：将 ${tableTemplate} 替换为实际模板
    const actualPrompt = fillPrompt.replace(
      /\$\{tableTemplate\}/g,
      tableTemplate,
    );

    progressCallback?.(`正在填表: ${itemTitle.slice(0, 30)}...`, 50);

    // 调用统一 LLM 中间件填表。输入策略由中间件统一读取并按 Provider 能力降级。
    const response = await LLMService.generate({
      task: "table",
      prompt: actualPrompt,
      content: {
        kind: "pdf-attachment",
        item,
        attachment: pdfAttachment,
      },
      onProgress: () => {
        /* dummy callback to trigger streaming */
      },
    });
    const result = response.text;
    this.lastTableMetadataByItemId.set(
      item.id,
      LLMNoteMetadataService.fromResponse("table", response),
    );

    progressCallback?.(`填表完成: ${itemTitle.slice(0, 30)}`, 100);

    return result;
  }

  /**
   * 查找文献条目下已有的 AI-Table 填表笔记条目
   *
   * @param item 文献条目
   * @returns 填表笔记条目，未找到返回 null
   */
  static async findTableNoteItem(
    item: Zotero.Item,
  ): Promise<Zotero.Item | null> {
    try {
      const noteIDs = (item as any).getNotes?.() || [];
      for (const nid of noteIDs) {
        const note = await Zotero.Items.getAsync(nid);
        if (!note) continue;
        const tags: Array<{ tag: string }> = (note as any).getTags?.() || [];
        const hasTableTag = tags.some((t) => t.tag === TABLE_NOTE_TAG);
        if (hasTableTag) {
          return note as Zotero.Item;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 查找文献条目是否已有 AI-Table 填表笔记
   *
   * @param item 文献条目
   * @returns 填表笔记内容，未找到返回 null
   */
  static async findTableNote(item: Zotero.Item): Promise<string | null> {
    try {
      const note = await this.findTableNoteItem(item);
      if (!note) return null;

      const noteContent: string = (note as any).getNote?.() || "";
      // 提取 data-ai-table-raw 元素中的原始 Markdown（兼容 div 和 pre）
      const rawMatch = noteContent.match(
        /<(?:div|pre)[^>]*data-ai-table-raw[^>]*>([\s\S]*?)<\/(?:div|pre)>/,
      );
      if (rawMatch && rawMatch[1]) {
        // 反转义 HTML 实体
        const raw = rawMatch[1]
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .trim();
        return raw || null;
      }

      // 兼容旧格式：直接去除 HTML 标签
      const textContent = noteContent.replace(/<[^>]*>/g, "").trim();
      return textContent || null;
    } catch {
      return null;
    }
  }

  /**
   * 保存填表结果为子笔记（AI-Table 标签）
   *
   * 根据 tableStrategy 偏好决定行为：
   * - skip（默认）：已存在 AI-Table 笔记时跳过
   * - overwrite：删除旧的 AI-Table 笔记，重新创建
   *
   * @param item 文献条目
   * @param tableContent 填表的 Markdown 内容
   * @param forceOverwrite 是否强制覆盖（忽略 tableStrategy）
   * @returns 创建的笔记，或已存在的笔记（skip 模式）
   */
  static async saveTableNote(
    item: Zotero.Item,
    tableContent: string,
    forceOverwrite: boolean = false,
    metadata?: LLMNoteMetadata | null,
  ): Promise<Zotero.Item> {
    const strategy: TableStrategy = ((getPref(
      "tableStrategy" as any,
    ) as string) || "skip") as TableStrategy;

    // 查找已有的 AI-Table 笔记
    const existingNote = await this.findTableNoteItem(item);

    // 根据策略处理已有笔记
    if (existingNote) {
      if (!forceOverwrite && strategy === "skip") {
        return existingNote;
      }
      // overwrite: 删除旧笔记
      await (existingNote as any).eraseTx?.();
    }

    // 创建新的填表笔记
    // 不使用 formatNoteContent，避免标题模式与 AI 笔记冲突
    const itemTitle = ((item.getField("title") as string) || "未知").slice(
      0,
      60,
    );

    // 使用 marked 将 Markdown 表格转换为 HTML 表格（用于 Zotero 显示）
    marked.setOptions({ gfm: true, breaks: true });
    let renderedHtml = marked.parse(tableContent) as string;
    // 移除内联样式，Zotero 笔记不支持
    renderedHtml = renderedHtml.replace(/\s+style="[^"]*"/g, "");

    // 将 LaTeX 公式转换为 Zotero 原生格式
    // 块级公式: $$...$$ → <span class="math">$\displaystyle ...$</span>
    renderedHtml = renderedHtml.replace(
      /\$\$([\s\S]*?)\$\$/g,
      (_match, formula) =>
        `<span class="math">$\\displaystyle ${formula.trim()}$</span>`,
    );
    // 行内公式: $...$ → <span class="math">$...$</span>
    // 使用负向前瞻/后瞻避免匹配已处理的 $$
    renderedHtml = renderedHtml.replace(
      /(?<!\$)\$(?!\$)([^$\n]+?)(?<!\$)\$(?!\$)/g,
      (_match, formula) => `<span class="math">$${formula.trim()}$</span>`,
    );

    // 将原始 Markdown 存储在预格式区块中，供 findTableNote 提取
    const escapedRaw = tableContent
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const metadataBlock =
      metadata || this.lastTableMetadataByItemId.get(item.id) || null;
    const noteHtmlRaw =
      `<h2>📊 文献表格 - ${itemTitle}</h2>` +
      `<div>${renderedHtml}</div>` +
      `<br/>` +
      `<p style="color: gray; font-size: 12px;"><em>👇 以下为系统缓存的原始 Markdown 数据（用于追加填表，请勿修改）：</em></p>` +
      `<pre data-ai-table-raw>${escapedRaw}</pre>`;
    const noteHtml = metadataBlock
      ? LLMNoteMetadataService.wrapHtml(noteHtmlRaw, metadataBlock)
      : noteHtmlRaw;

    const note = new Zotero.Item("note");
    note.libraryID = item.libraryID;
    note.parentID = item.id;
    note.setNote(noteHtml);
    note.addTag(TABLE_NOTE_TAG);
    await note.saveTx();

    return note;
  }

  /**
   * 汇总多篇文献的表格内容，附加元数据供 LLM 引用
   *
   * 优化策略：表头只出现一次（置顶），后续每篇仅发送数据行，
   * 大幅减少 100+ 篇文献场景下的 token 消耗。
   *
   * @param tableResults 文献ID → 表格内容的映射
   * @param itemPdfPairs 父条目 → PDF 附件的映射（用于提取作者/年份）
   * @returns 合并后的 Markdown 文档
   */
  static aggregateTableContents(
    tableResults: Map<number, string>,
    itemPdfPairs?: Array<{
      parentItem: Zotero.Item;
      pdfAttachment: Zotero.Item;
    }>,
  ): string {
    // 构建 itemId → parentItem 的快速查找
    const itemMap = new Map<number, Zotero.Item>();
    if (itemPdfPairs) {
      for (const { parentItem } of itemPdfPairs) {
        itemMap.set(parentItem.id, parentItem);
      }
    }

    // 辅助函数：从 Markdown 表格中分离表头和数据行
    const splitTableHeaderAndRows = (
      md: string,
    ): { header: string; dataRows: string; nonTableContent: string } => {
      const lines = md.split("\n");
      const headerLines: string[] = [];
      const dataLines: string[] = [];
      const nonTableLines: string[] = [];
      let headerDone = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith("|")) {
          if (!headerDone) {
            headerLines.push(trimmed);
            // 分隔行（如 |---|---|---| ）标志表头结束
            if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
              headerDone = true;
            }
          } else {
            dataLines.push(trimmed);
          }
        } else {
          nonTableLines.push(trimmed);
        }
      }

      return {
        header: headerLines.join("\n"),
        dataRows: dataLines.join("\n"),
        nonTableContent: nonTableLines.join("\n"),
      };
    };

    // 辅助函数：提取作者姓氏
    const extractAuthorSurname = (item: Zotero.Item): string => {
      const creators = (item as any).getCreators?.() || [];
      if (creators.length === 0) return "未知";
      const c = creators[0];
      if (c.lastName) return c.lastName;
      if (c.name) {
        const nameParts = c.name.trim().split(/\s+/);
        return nameParts[nameParts.length - 1];
      }
      return "未知";
    };

    // 辅助函数：提取年份
    const extractYear = (item: Zotero.Item): string => {
      const dateStr = (item.getField("date") as string) || "";
      const m = dateStr.match(/(\d{4})/);
      return m ? m[1] : "未知";
    };

    let globalHeader = "";
    const parts: string[] = [];
    let index = 1;

    for (const [itemId, tableContent] of tableResults) {
      const parentItem = itemMap.get(itemId);

      // 提取作者与年份标注
      let label: string;
      if (parentItem) {
        const author = extractAuthorSurname(parentItem);
        const year = extractYear(parentItem);
        const title = ((parentItem.getField("title") as string) || "").slice(
          0,
          80,
        );
        label = `> **[${index}] 文献**: ${title} (${author}, ${year})`;
      } else {
        label = `> **[${index}] 文献**`;
      }

      const { header, dataRows, nonTableContent } =
        splitTableHeaderAndRows(tableContent);

      if (!globalHeader && header) {
        // 首次遇到表头，记录为全局表头
        globalHeader = header;
      }

      // 组装：标注 + 数据行（无表头）
      let entry = label;
      if (nonTableContent) {
        entry += `\n${nonTableContent}`;
      }
      if (dataRows) {
        entry += `\n${dataRows}`;
      } else {
        // 如果没有解析出数据行（表格格式不标准），原样输出
        entry += `\n${tableContent}`;
      }

      parts.push(entry);
      index++;
    }

    // 拼装：全局表头 + 所有文献数据
    let result = "";
    if (globalHeader) {
      result += `**表格结构定义（以下每篇文献的数据行均遵循此表头）：**\n\n${globalHeader}\n\n---\n\n`;
    }
    result += parts.join("\n\n---\n\n");

    return result;
  }

  /**
   * 并行填表（带并发控制）
   *
   * @param items 文献条目与 PDF 附件的配对列表
   * @param tableTemplate 表格模板
   * @param fillPrompt 填表提示词
   * @param concurrency 并发数
   * @param options 填表执行选项
   * @param progressCallback 进度回调 (done, total)
   * @returns 文献ID → 表格内容的映射
   */
  static async fillTablesInParallel(
    items: Array<{ parentItem: Zotero.Item; pdfAttachment: Zotero.Item }>,
    tableTemplate: string,
    fillPrompt: string,
    concurrency: number,
    options?: {
      forceFillExisting?: boolean;
      forceOverwriteSave?: boolean;
    },
    progressCallback?: (done: number, total: number) => void,
  ): Promise<Map<number, string>> {
    const results = new Map<number, string>();
    let completed = 0;
    const total = items.length;
    const queue = [...items];

    const strategy: TableStrategy = ((getPref(
      "tableStrategy" as any,
    ) as string) || "skip") as TableStrategy;
    const forceFillExisting = options?.forceFillExisting || false;
    const forceOverwriteSave = options?.forceOverwriteSave || false;

    const worker = async () => {
      while (queue.length > 0) {
        const task = queue.shift()!;
        try {
          // skip 策略时先查缓存，overwrite 策略时跳过缓存直接重新填表
          if (strategy === "skip" && !forceFillExisting) {
            const existing = await this.findTableNote(task.parentItem);
            if (existing) {
              results.set(task.parentItem.id, existing);
              completed++;
              progressCallback?.(completed, total);
              continue;
            }
          }
          const table = await this.fillTableForSinglePDF(
            task.parentItem,
            task.pdfAttachment,
            tableTemplate,
            fillPrompt,
          );
          await this.saveTableNote(task.parentItem, table, forceOverwriteSave);
          results.set(task.parentItem.id, table);
        } catch (error) {
          ztoolkit.log(
            `[AI-Butler] 填表失败: ${task.parentItem.getField("title")}`,
            error,
          );
          results.set(
            task.parentItem.id,
            `(填表失败: ${error instanceof Error ? error.message : String(error)})`,
          );
        }
        completed++;
        progressCallback?.(completed, total);
      }
    };

    // 启动 N 个并行 worker
    const effectiveConcurrency = Math.min(concurrency, total);
    await Promise.all(
      Array.from({ length: effectiveConcurrency }, () => worker()),
    );

    return results;
  }

  /**
   * 创建报告条目
   */
  static async createReportItem(
    collection: Zotero.Collection,
    reportName: string,
  ): Promise<Zotero.Item> {
    const item = new Zotero.Item("report");
    item.setField("title", reportName);
    item.libraryID = collection.libraryID;

    // 使用事务包装保存和添加到分类操作
    await Zotero.DB.executeTransaction(async () => {
      await item.save();
      await collection.addItem(item.id);
    });

    return item;
  }

  /**
   * 将 PDF 附件添加到报告条目
   *
   * 创建链接附件，将原始 PDF 链接到报告条目下
   * 附件命名格式：论文标题前N位 + 原附件名称
   * 优化：缓存父条目标题，避免重复查询
   */
  static async attachPdfsToReport(
    reportItem: Zotero.Item,
    pdfAttachments: Zotero.Item[],
  ): Promise<void> {
    const TITLE_PREFIX_LENGTH = 30; // 论文标题前缀长度

    // 缓存父条目标题
    const parentTitleCache = new Map<number, string>();

    for (const pdfAtt of pdfAttachments) {
      try {
        // 获取原始 PDF 文件路径
        const filePath = await pdfAtt.getFilePathAsync();
        if (!filePath) {
          ztoolkit.log(`[AI-Butler] PDF 附件无文件路径: ${pdfAtt.id}`);
          continue;
        }

        // 获取原始附件的标题
        const originalTitle = (pdfAtt.getField("title") as string) || "PDF";

        // 获取父条目（论文）的标题（带缓存）
        let paperTitle = "";
        const parentID = pdfAtt.parentID;
        if (parentID) {
          if (parentTitleCache.has(parentID)) {
            paperTitle = parentTitleCache.get(parentID) || "";
          } else {
            const parentItem = await Zotero.Items.getAsync(parentID);
            if (parentItem) {
              paperTitle = (
                (parentItem.getField("title") as string) || ""
              ).trim();
              parentTitleCache.set(parentID, paperTitle);
            }
          }
        }

        // 构建新的附件标题：论文标题前N位 + 原附件名称
        let newTitle = originalTitle;
        if (paperTitle) {
          const titlePrefix =
            paperTitle.length > TITLE_PREFIX_LENGTH
              ? paperTitle.substring(0, TITLE_PREFIX_LENGTH) + "..."
              : paperTitle;
          newTitle = `[${titlePrefix}] ${originalTitle}`;
        }

        // 创建链接附件
        await Zotero.Attachments.linkFromFile({
          file: filePath,
          parentItemID: reportItem.id,
          title: newTitle,
        });
      } catch (error) {
        ztoolkit.log(`[AI-Butler] 添加 PDF 附件失败:`, error);
        // 继续处理其他附件
      }
    }
  }

  /**
   * 从 PDF 附件提取内容（包括文件路径）
   * 优化：缓存父条目信息，避免重复查询
   */
  static async extractPDFContentsFromAttachments(
    pdfAttachments: Zotero.Item[],
    progressCallback?: (message: string, progress: number) => void,
  ): Promise<PdfFileData[]> {
    const contents: PdfFileData[] = [];
    const total = pdfAttachments.length;

    // 缓存父条目标题，避免重复查询
    const parentTitleCache = new Map<number, string>();
    // 统计每个父条目有多少个 PDF，用于判断是否需要显示附件名
    const parentPdfCount = new Map<number, number>();

    // 第一遍：统计每个父条目的 PDF 数量
    for (const pdfAtt of pdfAttachments) {
      const parentID = pdfAtt.parentID;
      if (parentID) {
        parentPdfCount.set(parentID, (parentPdfCount.get(parentID) || 0) + 1);
      }
    }

    for (let i = 0; i < pdfAttachments.length; i++) {
      const pdfAtt = pdfAttachments[i];
      const attachmentTitle =
        (pdfAtt.getField("title") as string) || `PDF ${i + 1}`;
      const progress = 30 + Math.floor((i / total) * 20);
      progressCallback?.(
        `正在提取 (${i + 1}/${total}): ${attachmentTitle.slice(0, 30)}...`,
        progress,
      );

      try {
        // 获取文件路径
        const filePath = await pdfAtt.getFilePathAsync();
        if (!filePath) {
          ztoolkit.log(`[AI-Butler] PDF 附件无文件路径: ${pdfAtt.id}`);
          continue;
        }

        // 获取父条目标题（带缓存）
        let paperTitle = "";
        const parentID = pdfAtt.parentID;
        if (parentID) {
          if (parentTitleCache.has(parentID)) {
            paperTitle = parentTitleCache.get(parentID) || "";
          } else {
            const parentItem = await Zotero.Items.getAsync(parentID);
            if (parentItem) {
              paperTitle = (
                (parentItem.getField("title") as string) || ""
              ).trim();
              parentTitleCache.set(parentID, paperTitle);
            }
          }
        }

        // 构建显示标题：如果同一论文有多个 PDF，则显示 "论文标题 - 附件名"
        let displayTitle = paperTitle || attachmentTitle;
        const pdfCountForParent = parentID
          ? parentPdfCount.get(parentID) || 1
          : 1;
        if (pdfCountForParent > 1 && paperTitle) {
          displayTitle = `${paperTitle} - ${attachmentTitle}`;
        }

        // 尝试读取 Base64 内容
        let base64Content = "";
        try {
          const fileData = await IOUtils.read(filePath);
          // 使用分块方式转换为 base64，避免大文件导致 "too many function arguments" 错误
          base64Content = this.arrayBufferToBase64(fileData);
        } catch (e) {
          ztoolkit.log(`[AI-Butler] 读取 PDF 文件失败: ${filePath}`, e);
        }

        contents.push({
          title: displayTitle,
          filePath,
          content: base64Content,
          isBase64: true,
        });
      } catch (error) {
        ztoolkit.log(
          `[AI-Butler] 提取 PDF 内容失败: ${attachmentTitle}`,
          error,
        );
        // 继续处理其他文献
      }
    }

    return contents;
  }

  /**
   * 使用 LLM 从多个 PDF 生成综述
   */
  static async generateSummaryFromMultiplePDFs(
    pdfContents: PdfFileData[],
    prompt: string,
    progressCallback?: (message: string, progress: number) => void,
  ): Promise<string> {
    if (pdfContents.length === 0) {
      throw new Error("没有可用的 PDF 内容");
    }

    progressCallback?.("正在调用 AI 生成综述...", 60);

    const files = pdfContents.map((pdf, index) => ({
      filePath: pdf.filePath,
      displayName: `${index + 1}_${pdf.title.slice(0, 50)}`,
      base64Content: pdf.isBase64 ? pdf.content : undefined,
      textContent: pdf.isBase64 ? undefined : pdf.content,
    }));

    return LLMService.generateText({
      task: "literature-review",
      prompt,
      content: {
        kind: "pdf-files",
        files,
      },
    });
  }

  /**
   * 使用 Gemini File API 生成综述
   */
  private static async generateWithGeminiFileAPI(
    pdfContents: PdfFileData[],
    prompt: string,
    progressCallback?: (message: string, progress: number) => void,
  ): Promise<string> {
    progressCallback?.("正在上传 PDF 文件到大模型...", 55);

    const files = pdfContents.map((pdf, index) => ({
      filePath: pdf.filePath,
      displayName: `${index + 1}_${pdf.title.slice(0, 50)}`,
      base64Content: pdf.isBase64 ? pdf.content : undefined,
      textContent: pdf.isBase64 ? undefined : pdf.content,
    }));

    progressCallback?.("正在调用 AI 生成综述...", 65);

    const result = await LLMService.generateText({
      task: "literature-review",
      prompt,
      content: { kind: "pdf-files", files },
    });

    return result;
  }

  /**
   * 使用合并文本模式生成综述
   */
  private static async generateWithMergedText(
    pdfContents: PdfFileData[],
    prompt: string,
    progressCallback?: (message: string, progress: number) => void,
  ): Promise<string> {
    progressCallback?.("正在调用 AI 生成综述 (文本模式)...", 60);

    // 如果有 Base64 内容但 provider 不支持多文件，尝试提取文本
    let combinedContent = "";
    let hasBase64 = false;
    let firstBase64Content = "";

    for (const pdf of pdfContents) {
      if (pdf.isBase64 && pdf.content) {
        if (!hasBase64) {
          hasBase64 = true;
          firstBase64Content = pdf.content;
        }
        combinedContent += `\n\n=== 论文: ${pdf.title} ===\n[PDF 内容]\n`;
      } else {
        combinedContent += `\n\n=== 论文: ${pdf.title} ===\n${pdf.content}\n`;
      }
    }

    // 如果有 Base64 内容，使用第一个 PDF 的 Base64
    if (hasBase64 && firstBase64Content) {
      const fullPrompt = `${prompt}\n\n以下是需要综述的论文列表:\n${pdfContents.map((p, i) => `${i + 1}. ${p.title}`).join("\n")}\n\n请基于上传的 PDF 内容生成综述。`;

      const result = await LLMService.generateText({
        task: "literature-review",
        prompt: fullPrompt,
        content: {
          kind: "legacy",
          content: firstBase64Content,
          isBase64: true,
          policy: "pdf-base64",
        },
      });
      return result;
    }

    // 纯文本模式
    if (!combinedContent.trim()) {
      throw new Error("当前 API 不支持多文件处理，且无法提取 PDF 文本内容");
    }

    const fullPrompt = `${prompt}\n\n以下是需要综述的论文内容:\n${combinedContent}`;

    const result = await LLMService.generateText({
      task: "literature-review",
      prompt: fullPrompt,
      content: { kind: "text", text: combinedContent, policy: "text" },
    });

    return result;
  }

  /**
   * 创建综述笔记（兼容旧接口，用于子笔记创建）
   */
  static async createReviewNote(
    reportItem: Zotero.Item,
    reviewName: string,
    content: string,
    metadata?: LLMNoteMetadata | null,
  ): Promise<Zotero.Item> {
    const formattedContent = NoteGenerator.formatNoteContent(
      reviewName,
      content,
      "",
      metadata,
    );
    const note = await NoteGenerator.createNote(reportItem, formattedContent);
    return note;
  }

  /**
   * 创建独立综述笔记（直接放在分类目录下，无父条目）
   *
   * @param collection 目标分类
   * @param reviewName 综述名称
   * @param content 综述正文（Markdown）
   * @returns 创建的笔记条目
   */
  static async createStandaloneReviewNote(
    collection: Zotero.Collection,
    reviewName: string,
    content: string,
    metadata?: LLMNoteMetadata | null,
  ): Promise<Zotero.Item> {
    // 格式化内容
    const formattedContent = NoteGenerator.formatNoteContent(
      reviewName,
      content,
      "",
      metadata,
    );

    // 创建独立笔记（无父条目）
    const note = new Zotero.Item("note");
    note.libraryID = collection.libraryID;
    note.setNote(formattedContent);
    note.addTag("AI-Review");

    // 保存并添加到分类
    await Zotero.DB.executeTransaction(async () => {
      await note.save();
      await collection.addItem(note.id);
    });

    return note;
  }

  /**
   * 后处理综述正文中的引用标记，转换为 Zotero 链接
   *
   * 匹配 LLM 生成的 [num] 格式引用（如 [1]、[2]），
   * 基于 aggregateTableContents 中的文献编号构建序号 → item 映射，
   * 将匹配成功的引用转换为 zotero://select 可点击链接。
   *
   * @param content 综述正文
   * @param itemPdfPairs 文献条目列表（顺序与 aggregateTableContents 中的编号一致）
   * @returns 处理后的正文
   */
  static async postProcessCitations(
    content: string,
    itemPdfPairs: Array<{
      parentItem: Zotero.Item;
      pdfAttachment: Zotero.Item;
    }>,
  ): Promise<string> {
    if (itemPdfPairs.length === 0) return content;

    // 构建序号 → Zotero URI 的映射（序号从 1 开始，与 aggregateTableContents 一致）
    const numToUri = new Map<number, string>();
    itemPdfPairs.forEach(({ parentItem }, idx) => {
      const itemKey = (parentItem as any).key || "";
      if (itemKey) {
        numToUri.set(idx + 1, `zotero://select/library/items/${itemKey}`);
      }
    });

    if (numToUri.size === 0) return content;

    // 匹配 [N] 格式引用，将其转换为 Markdown 链接
    // 匹配规则：方括号内为纯数字，如 [1]、[12]
    // 使用负向前瞻排除已经是 Markdown 链接的情况 [N](url)
    const result = content.replace(
      /\[(\d+)\](?!\()/g,
      (fullMatch, numStr: string) => {
        const num = parseInt(numStr, 10);
        const uri = numToUri.get(num);
        if (uri) {
          return `[[${numStr}]](${uri})`;
        }
        return fullMatch;
      },
    );

    return result;
  }

  /**
   * 将 ArrayBuffer 转换为 Base64 字符串
   * 使用分块处理避免 "too many function arguments" 错误
   */
  private static arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
    const bytes =
      buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const chunkSize = 0x8000; // 32KB chunks
    let result = "";

    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      result += String.fromCharCode.apply(null, Array.from(chunk));
    }

    return btoa(result);
  }
}
