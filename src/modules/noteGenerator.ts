/**
 * ================================================================
 * AI 笔记生成器模块
 * ================================================================
 *
 * 本模块是插件的核心功能实现,负责协调 PDF 提取、AI 分析和笔记创建的完整流程
 *
 * 主要职责:
 * 1. 统筹论文总结生成的完整工作流
 * 2. 协调 PDF 文本提取和 AI 模型调用
 * 3. 管理流式输出和用户界面更新
 * 4. 处理批量文献的队列执行
 * 5. 创建和管理 Zotero 笔记条目
 *
 * 工作流程:
 * PDF提取 -> 文本清理 -> AI分析 -> Markdown转换 -> 笔记保存
 *
 * 技术特点:
 * - 支持流式输出,实时反馈生成进度
 * - 智能错误处理和重试机制
 * - 批量处理支持用户中断
 * - Markdown 格式适配 Zotero 笔记系统
 *
 * @module noteGenerator
 * @author AI-Butler Team
 */

import { PDFExtractor } from "./pdfExtractor";
import LLMService, { type LLMChatRequest } from "./llmService";
import {
  LLMEndpointManager,
  type LLMEndpoint,
  type LLMPdfProcessMode,
} from "./llmEndpointManager";
import {
  LLMNoteMetadataService,
  type LLMNoteMetadata,
} from "./llmNoteMetadata";
import { markdownToZoteroNoteHtml } from "./noteMarkdown";
import type { LLMAbortSignal, LLMResponse } from "./llmproviders/types";
import {
  isAbortError,
  throwIfAborted,
} from "./llmproviders/shared/requestAbort";
import { SummaryView } from "./views/SummaryView";
import { getPref } from "../utils/prefs";
import { MainWindow } from "./views/MainWindow";
import { marked } from "marked";
import {
  DEFAULT_TABLE_FILL_PROMPT,
  DEFAULT_TABLE_TEMPLATE,
  getBuiltinMultiRoundPromptTemplates,
  getDefaultMultiRoundPromptTemplate,
  mergeMultiRoundPromptTemplates,
  parseChapterStructureResult,
  parseManualChapterStructure,
  parseMultiRoundPromptTemplates,
  type MultiRoundPromptTemplate,
  type SummaryMode,
} from "../utils/prompts";
import {
  DEEP_READ_FINAL_SLOT_ID,
  buildDeepReadSkeletonHtml,
  extractDeepReadPlanMetadata,
  fillDeepReadSlot,
  hasDeepReadV2Slots,
  hasRunnableDeepReadSlots,
  isDeepReadSlotDone,
  markDeepReadSlotRunning,
  planDeepReadSlots,
  resetRunningDeepReadSlots,
  shouldRunDeepReadSlot,
  type DeepReadSlot,
} from "./deepReadEngine";
import { isTableFeatureEnabled } from "./uiCustomization";
import { AiNoteService, type AiNoteKind } from "./aiNoteService";

type MultiModelSummaryResult = {
  endpoint: LLMEndpoint;
  content: string;
  response: LLMResponse;
  metadata: LLMNoteMetadata;
  noteHtml: string;
};

/**
 * AI 笔记生成器类
 *
 * 提供静态方法集合,封装论文笔记生成的核心逻辑
 * 采用静态方法设计,简化调用方式,无需实例化
 */
export class NoteGenerator {
  /**
   * 为单个文献条目生成 AI 总结笔记
   *
   * 这是单条目处理的核心函数,协调整个生成流程
   *
   * 执行流程:
   * 1. 从文献条目提取 PDF 文本
   * 2. 清理和预处理文本内容
   * 3. 调用 AI 模型生成总结
   * 4. 将 Markdown 格式转换为 Zotero 笔记格式
   * 5. 创建笔记并关联到文献条目
   *
   * 流式输出支持:
   * - 如果提供 outputWindow,会实时显示生成过程
   * - 通过 onProgress 回调函数传递 AI 输出的增量内容
   * - 用户可以在输出窗口中看到"打字机效果"
   *
   * 错误处理:
   * - PDF 提取失败:抛出明确的错误信息
   * - AI 调用失败:包含 API 错误详情
   * - 不创建包含错误信息的笔记,直接抛出异常由上层处理
   *
   * @param item Zotero 文献条目对象
   * @param outputWindow 可选的输出窗口,用于显示流式生成过程
   * @param progressCallback 可选的进度回调函数,接收处理状态消息和进度百分比
   * @returns 包含创建的笔记对象和完整内容的对象
   * @throws 当任何步骤失败时抛出错误
   */
  public static async generateNoteForItem(
    item: Zotero.Item,
    outputWindow?: SummaryView,
    progressCallback?: (message: string, progress: number) => void,
    streamCallback?: (chunk: string) => void,
    options?: {
      summaryMode?: string;
      forceOverwrite?: boolean;
      abortSignal?: LLMAbortSignal;
    },
  ): Promise<{ note: Zotero.Item; content: string }> {
    // 获取文献标题,用于日志和用户反馈
    const itemTitle = item.getField("title") as string;
    let note: Zotero.Item | null = null;
    let fullContent = "";
    let llmMetadata: LLMNoteMetadata | null = null;
    let noteContentOverride: string | null = null;

    try {
      throwIfAborted(options?.abortSignal);
      // 笔记管理策略: skip/overwrite/append
      const policy = (
        (getPref("noteStrategy" as any) as string) || "skip"
      ).toLowerCase();
      const requestedSummaryMode =
        options?.summaryMode ||
        (getPref("summaryMode" as any) as string) ||
        "single";
      const summaryMode: SummaryMode =
        requestedSummaryMode === "single" ? "single" : "deepRead";
      const multiModelEndpoints =
        LLMEndpointManager.isMultiModelSummaryEnabled()
          ? LLMEndpointManager.getMultiModelSummaryEndpoints()
          : [];
      const useMultiModelSummary =
        summaryMode === "single" && multiModelEndpoints.length > 0;
      const noteKind: AiNoteKind =
        summaryMode === "single" && !useMultiModelSummary
          ? "summary"
          : "deepRead";
      const existingRecord = await AiNoteService.findNoteRecord(item, noteKind);
      const existing = existingRecord?.note || null;
      const canResumeDeepRead =
        noteKind === "deepRead" &&
        !!existingRecord?.rawHtml &&
        hasDeepReadV2Slots(existingRecord.rawHtml) &&
        hasRunnableDeepReadSlots(existingRecord.rawHtml);
      if (existing && !options?.forceOverwrite && !canResumeDeepRead) {
        if (policy === "skip") {
          progressCallback?.(
            `\u5df2\u5b58\u5728${AiNoteService.getTitle(noteKind)}\uff0c\u8df3\u8fc7`,
            100,
          );
          return {
            note: existing as Zotero.Item,
            content: ((existing as any).getNote?.() as string) || "",
          };
        }
      }

      // Step 1: PDF processing
      throwIfAborted(options?.abortSignal);
      progressCallback?.("正在处理PDF...", 10);

      // 检查 PDF 文件大小限制
      const enableSizeLimit =
        (getPref("enablePdfSizeLimit" as any) as boolean) ?? false;
      if (enableSizeLimit) {
        const maxPdfSizeMB = parseFloat(
          (getPref("maxPdfSizeMB" as any) as string) || "50",
        );
        const fileSizeMB = await PDFExtractor.getPdfFileSize(item);
        if (fileSizeMB > maxPdfSizeMB) {
          throw new Error(
            `PDF 文件过大 (${fileSizeMB.toFixed(1)} MB)，超过设置的阈值 ${maxPdfSizeMB} MB`,
          );
        }
      }

      // 读取当前主模型的 PDF 处理模式和附件选择模式
      const prefMode = LLMService.getEffectivePdfProcessMode();
      const pdfAttachmentMode =
        (getPref("pdfAttachmentMode" as any) as string) || "default";
      if (
        LLMEndpointManager.isMultiModelSummaryEnabled() &&
        multiModelEndpoints.length === 0
      ) {
        throw new Error(
          "已启用多模型同时总结，但没有可用的大模型供应商。请在设置的“模型平台”中选择至少一个已启用供应商。",
        );
      }

      let pdfContent = "";
      let isBase64 = false;
      let useMultiPdfMode = false;

      // 检查是否应该使用多 PDF 模式
      if (
        !useMultiModelSummary &&
        summaryMode === "single" &&
        pdfAttachmentMode === "all" &&
        prefMode === "base64"
      ) {
        const allPdfs = await PDFExtractor.getAllPdfAttachments(item);

        if (allPdfs.length > 1) {
          // 检查当前 provider 是否支持多文件上传
          const provider = LLMService.getCurrentProvider();
          const supportsMultiFile =
            provider &&
            LLMService.getProviderCapabilities(provider).maxPdfFiles > 1 &&
            typeof provider.generateMultiFileSummary === "function";

          if (supportsMultiFile) {
            useMultiPdfMode = true;
            progressCallback?.(
              `使用多 PDF 模式 (${allPdfs.length} 个文件)...`,
              15,
            );
          } else {
            // Provider 不支持多文件，回退到默认模式
            try {
              new ztoolkit.ProgressWindow("AI Butler", {
                closeOnClick: true,
                closeTime: 3000,
              })
                .createLine({
                  text: "当前 API 不支持多 PDF 上传，已使用默认 PDF",
                  type: "warning",
                })
                .show();
            } catch {
              // Ignore notification error
            }
          }
        }
      }

      // AI 精读会复用同一份 PDF 内容；单次总结交给 LLMService 统一解析，避免 MinerU 重复处理。
      if (summaryMode !== "single" && !useMultiModelSummary) {
        const extracted = await this.extractPdfContentForMode(item, prefMode);
        pdfContent = extracted.content;
        isBase64 = extracted.isBase64;
      }

      // 步骤 2: AI 模型总结生成
      // 通知进度回调开始 AI 分析 (40% 完成)
      throwIfAborted(options?.abortSignal);
      progressCallback?.(
        summaryMode === "single"
          ? "正在生成AI总结..."
          : "正在进行 AI 精读分析...",
        40,
      );

      // 如果有输出窗口,开始显示当前处理的条目
      if (outputWindow) {
        // 先显示加载状态
        outputWindow.showLoadingState(`正在分析「${itemTitle}」`);
      }

      // 根据总结模式选择不同的生成策略
      if (useMultiModelSummary) {
        const multiModelResult = await this.generateMultiModelSummaryContent({
          item,
          itemTitle,
          endpoints: multiModelEndpoints,
          summaryMode,
          pdfContent,
          isBase64,
          pdfAttachmentMode,
          prefMode,
          outputWindow,
          progressCallback,
          streamCallback,
          abortSignal: options?.abortSignal,
        });
        fullContent = multiModelResult.content;
        noteContentOverride = multiModelResult.noteHtml;
        llmMetadata = null;
      } else if (summaryMode === "single") {
        // 单次对话模式：使用传统的单次总结
        // 定义流式输出回调函数
        const onProgress = async (chunk: string) => {
          fullContent += chunk;
          try {
            streamCallback?.(chunk);
          } catch (e) {
            ztoolkit.log("[AI Butler] streamCallback error:", e);
          }
          if (outputWindow) {
            if (fullContent === chunk) {
              outputWindow.startItem(itemTitle);
            }
            outputWindow.appendContent(chunk);
          }
        };

        let response: LLMResponse;
        if (useMultiPdfMode) {
          response = await LLMService.generate({
            task: "summary",
            content: {
              kind: "zotero-item",
              item,
              attachmentMode: "all",
            },
            transport: { abortSignal: options?.abortSignal },
            onProgress,
          });
        } else {
          response = await LLMService.generate({
            task: "summary",
            content: {
              kind: "zotero-item",
              item,
              attachmentMode: "default",
            },
            transport: { abortSignal: options?.abortSignal },
            onProgress,
          });
        }
        fullContent = response.text;
        llmMetadata = LLMNoteMetadataService.fromResponse("summary", response);
      } else {
        const deepReadResult = await this.generateDeepReadContent({
          item,
          existing,
          existingHtml: existingRecord?.rawHtml || "",
          policy,
          pdfContent,
          isBase64,
          itemTitle,
          outputWindow,
          progressCallback,
          streamCallback,
          abortSignal: options?.abortSignal,
        });
        note = deepReadResult.note;
        fullContent = deepReadResult.content;
        noteContentOverride = deepReadResult.noteHtml;
        llmMetadata = LLMNoteMetadataService.fromResponse(
          "summary",
          deepReadResult.response,
        );
      }

      if (note && noteContentOverride) {
        progressCallback?.(
          "AI \u7cbe\u8bfb\u7b14\u8bb0\u5df2\u66f4\u65b0",
          100,
        );
        return { note, content: fullContent };
      }

      // Step 3: create or update note
      throwIfAborted(options?.abortSignal);
      progressCallback?.(`正在创建${AiNoteService.getTitle(noteKind)}...`, 80);

      // 检查内容是否为空，防止创建空笔记
      if (!fullContent || !fullContent.trim()) {
        throw new Error("AI 返回内容为空，笔记未创建");
      }

      // 格式化笔记内容,添加标题和样式
      let noteContent =
        noteContentOverride ||
        this.formatNoteContent(
          itemTitle,
          fullContent,
          AiNoteService.getTitle(noteKind),
        );
      if (!noteContentOverride && llmMetadata) {
        noteContent = LLMNoteMetadataService.wrapHtml(noteContent, llmMetadata);
      }

      note = await AiNoteService.saveGeneratedNote({
        item,
        kind: noteKind,
        html: noteContent,
        existing,
        policy,
      });

      // 如果有输出窗口,标记当前条目完成
      if (outputWindow) {
        outputWindow.finishItem();
      }

      // 通知进度回调完成 (100%)
      progressCallback?.("完成！", 100);

      // 异步并行填表（不阻塞笔记返回）
      const enableTable =
        (getPref("enableTableOnSingleNote" as any) as boolean) ?? true;
      if (enableTable && isTableFeatureEnabled()) {
        // 延迟导入以避免循环依赖
        import("./literatureReviewService")
          .then(({ LiteratureReviewService }) => {
            const tableTemplate =
              (getPref("tableTemplate" as any) as string) ||
              DEFAULT_TABLE_TEMPLATE;
            const fillPrompt =
              (getPref("tableFillPrompt" as any) as string) ||
              DEFAULT_TABLE_FILL_PROMPT;
            const tableStrategy =
              (getPref("tableStrategy" as any) as string) || "skip";

            // 获取 PDF 附件
            const noteIDs = (item as any).getAttachments?.() || [];
            void (async () => {
              for (const attId of noteIDs) {
                try {
                  const att = await Zotero.Items.getAsync(attId);
                  if (att && att.isPDFAttachment?.()) {
                    // skip 策略时先检查是否已有表格
                    if (tableStrategy === "skip") {
                      const existing =
                        await LiteratureReviewService.findTableNote(item);
                      if (existing) break;
                    }
                    await LiteratureReviewService.fillTableForSinglePDF(
                      item,
                      att,
                      tableTemplate,
                      fillPrompt,
                    ).then((table) =>
                      LiteratureReviewService.saveTableNote(item, table),
                    );
                    break; // 只用第一个 PDF
                  }
                } catch (e) {
                  ztoolkit.log("[AI-Butler] 额外填表失败:", e);
                }
              }
            })();
          })
          .catch((e) => {
            ztoolkit.log("[AI-Butler] 加载填表服务失败:", e);
          });
      }

      // 返回创建的笔记对象和内容
      return { note, content: fullContent };
    } catch (error: any) {
      // 记录错误日志
      ztoolkit.log(`[AI Butler] 为文献"${itemTitle}"生成笔记时出错:`, error);

      // 如果有输出窗口,显示错误信息
      if (outputWindow) {
        outputWindow.showError(itemTitle, error.message);
      }

      // 不创建包含错误信息的笔记,直接抛出异常由上层处理
      throw error;
    }
  }

  /** 查找已有的 AI 总结笔记(通过标签或标题标识，排除后续追问等独立笔记) */
  public static async findExistingNote(
    item: Zotero.Item,
  ): Promise<Zotero.Item | null> {
    try {
      return await AiNoteService.findNote(item, "summary");
    } catch {
      return null;
    }
  }

  private static async extractPdfContentForMode(
    item: Zotero.Item,
    mode: LLMPdfProcessMode,
  ): Promise<{ content: string; isBase64: boolean }> {
    if (mode === "base64") {
      return {
        content: await PDFExtractor.extractBase64FromItem(item),
        isBase64: true,
      };
    }

    const fullText = await PDFExtractor.extractTextFromItem(item, mode);
    const cleanedText = PDFExtractor.cleanText(fullText);
    return {
      content: PDFExtractor.truncateText(cleanedText),
      isBase64: false,
    };
  }

  private static async generateMultiModelSummaryContent(params: {
    item: Zotero.Item;
    itemTitle: string;
    endpoints: LLMEndpoint[];
    summaryMode: SummaryMode;
    pdfContent: string;
    isBase64: boolean;
    pdfAttachmentMode: string;
    prefMode: string;
    outputWindow?: SummaryView;
    progressCallback?: (message: string, progress: number) => void;
    streamCallback?: (chunk: string) => void;
    abortSignal?: LLMAbortSignal;
  }): Promise<{ content: string; noteHtml: string }> {
    const {
      item,
      itemTitle,
      endpoints,
      summaryMode,
      pdfContent,
      isBase64,
      pdfAttachmentMode,
      prefMode,
      outputWindow,
      progressCallback,
      streamCallback,
      abortSignal,
    } = params;
    const total = endpoints.length;
    let completed = 0;

    progressCallback?.(`正在使用 ${total} 个模型同时总结...`, 42);
    if (outputWindow) {
      outputWindow.showLoadingState(
        `正在使用 ${total} 个模型分析「${itemTitle}」`,
      );
    }

    const tasks = endpoints.map(async (endpoint) => {
      try {
        const result = await this.generateSummaryWithEndpoint({
          item,
          itemTitle,
          endpoint,
          summaryMode,
          pdfContent,
          isBase64,
          pdfAttachmentMode,
          prefMode,
          abortSignal,
        });
        completed++;
        progressCallback?.(
          `模型总结完成：${endpoint.name} (${completed}/${total})`,
          42 + Math.floor((completed / total) * 36),
        );
        return result;
      } catch (error: any) {
        completed++;
        const normalized =
          error instanceof Error ? error : new Error(String(error));
        ztoolkit.log(
          `[AI Butler] 多模型总结失败: ${endpoint.name}`,
          normalized,
        );
        progressCallback?.(
          `模型总结失败：${endpoint.name} (${completed}/${total})`,
          42 + Math.floor((completed / total) * 36),
        );
        return { endpoint, error: normalized };
      }
    });

    const settled = await Promise.all(tasks);
    const successes = settled.filter(
      (result): result is MultiModelSummaryResult => "noteHtml" in result,
    );
    const failures = settled.filter(
      (
        result,
      ): result is {
        endpoint: LLMEndpoint;
        error: Error;
      } => "error" in result,
    );

    if (successes.length === 0) {
      const details = failures
        .map((failure) => `${failure.endpoint.name}: ${failure.error.message}`)
        .join("\n");
      const error = new Error(`多模型同时总结全部失败。\n${details}`);
      const suppressAll =
        failures.length > 0 &&
        failures.every(
          (failure) =>
            (failure.error as Error & { suppressTaskRetry?: boolean })
              .suppressTaskRetry === true,
        );
      if (suppressAll) {
        (error as Error & { suppressTaskRetry?: boolean }).suppressTaskRetry =
          true;
      }
      throw error;
    }

    const content = successes
      .map((result) => this.formatMultiModelDisplayMarkdown(result))
      .join("\n\n---\n\n");
    const noteHtml = successes
      .map((result) => result.noteHtml)
      .join("\n<hr/>\n");
    const displayContent = [
      `**多模型同时总结完成：${successes.length}/${total} 个模型成功**`,
      "",
      content,
      failures.length > 0
        ? [
            "",
            "---",
            "",
            "## 失败的供应商",
            "",
            ...failures.map(
              (failure) =>
                `- ${failure.endpoint.name}: ${failure.error.message}`,
            ),
          ].join("\n")
        : "",
    ]
      .filter((part) => part.trim().length > 0)
      .join("\n\n");

    if (outputWindow) {
      outputWindow.startItem(itemTitle);
      outputWindow.appendContent(displayContent);
      outputWindow.finishItem();
    }
    try {
      streamCallback?.(displayContent);
    } catch (error) {
      ztoolkit.log("[AI Butler] streamCallback error:", error);
    }

    progressCallback?.(
      failures.length > 0
        ? `多模型总结完成：${successes.length} 个成功，${failures.length} 个失败`
        : "多模型总结完成",
      80,
    );

    return { content, noteHtml };
  }

  private static async generateSummaryWithEndpoint(params: {
    item: Zotero.Item;
    itemTitle: string;
    endpoint: LLMEndpoint;
    summaryMode: SummaryMode;
    pdfContent: string;
    isBase64: boolean;
    pdfAttachmentMode: string;
    prefMode: string;
    abortSignal?: LLMAbortSignal;
  }): Promise<MultiModelSummaryResult> {
    const {
      item,
      itemTitle,
      endpoint,
      summaryMode,
      pdfContent,
      isBase64,
      pdfAttachmentMode,
      prefMode,
      abortSignal,
    } = params;

    if (summaryMode !== "single") {
      throw new Error(
        "Multi-model summary only supports normal AI summary; use deepRead v2 for AI deep read.",
      );
    }

    const endpointPdfMode = LLMService.getEffectivePdfProcessMode(endpoint);
    const attachmentMode = this.resolveEndpointAttachmentMode(
      endpoint,
      pdfAttachmentMode,
      endpointPdfMode,
    );
    const response = await LLMService.generateWithEndpoint(endpoint.id, {
      task: "summary",
      content: {
        kind: "zotero-item",
        item,
        attachmentMode,
      },
      transport: { abortSignal },
    });
    const content = response.text;

    if (!content || !content.trim()) {
      throw new Error("AI 返回内容为空");
    }

    const metadata = LLMNoteMetadataService.fromResponse("summary", response);
    const noteHtml = this.formatNoteContent(
      itemTitle,
      content,
      "AI 管家",
      metadata,
    );

    return {
      endpoint,
      content,
      response,
      metadata,
      noteHtml,
    };
  }

  private static resolveEndpointAttachmentMode(
    endpoint: LLMEndpoint,
    pdfAttachmentMode: string,
    pdfProcessMode: LLMPdfProcessMode,
  ): "default" | "all" {
    if (pdfAttachmentMode !== "all") return "default";

    if (pdfProcessMode === "text" || pdfProcessMode === "mineru") return "all";
    return LLMService.endpointSupportsMultiFile(endpoint) ? "all" : "default";
  }

  private static formatMultiModelDisplayMarkdown(
    result: MultiModelSummaryResult,
  ): string {
    const model = result.response.model || result.endpoint.model || "(unknown)";
    return [
      `## ${result.endpoint.name}`,
      "",
      `供应商: ${result.endpoint.name}  模型: ${model}`,
      "",
      result.content,
    ].join("\n");
  }

  /**
   * 格式化笔记内容
   *
   * 为 AI 生成的总结添加标题头部,并转换为 Zotero 笔记兼容的 HTML 格式
   *
   * 处理步骤:
   * 1. 将 Markdown 格式的总结转换为 HTML
   * 2. 添加文献标题作为笔记标题 (并限制长度)
   * 3. 包装成完整的笔记结构
   *
   * @param itemTitle 文献条目标题
   * @param summary AI 生成的总结内容 (Markdown 格式)
   * @returns 格式化后的 HTML 内容,可直接保存到 Zotero 笔记
   *
   * @example
   * ```typescript
   * const formatted = formatNoteContent(
   *   "深度学习综述",
   *   "## 摘要\n这是一篇综述文章..."
   * );
   * // 返回: <h2>AI 管家 - 深度学习综述</h2><div>...</div>
   * ```
   */
  public static formatNoteContent(
    itemTitle: string,
    summary: string,
    prefix: string = "",
    metadata?: LLMNoteMetadata | null,
  ): string {
    // 将 Markdown 转换为笔记格式的 HTML
    const htmlContent = markdownToZoteroNoteHtml(summary);

    // 定义笔记标题中允许的文献标题最大长度,避免 Zotero 同步问题
    const maxTitleLength = 100;
    let truncatedTitle = itemTitle;

    // 如果原始标题超过长度限制,则进行截断并添加省略号
    if (truncatedTitle.length > maxTitleLength) {
      truncatedTitle = truncatedTitle.substring(0, maxTitleLength) + "...";
    }

    // 组装标题：有前缀则 "前缀 - 标题"，无前缀则直接用标题
    const heading = prefix
      ? `${this.escapeHtml(prefix)} - ${this.escapeHtml(truncatedTitle)}`
      : this.escapeHtml(truncatedTitle);

    // 添加标题头部和内容包装
    const noteHtml = `<h2>${heading}</h2>
<div>${htmlContent}</div>`;
    return metadata
      ? LLMNoteMetadataService.wrapHtml(noteHtml, metadata)
      : noteHtml;
  }

  /**
   * 将 Markdown 转换为适合 Zotero 笔记的 HTML 格式
   *
   * Zotero 笔记系统对 HTML 格式有特定要求:
   * 1. 不支持内联样式 (style 属性)
   * 2. 数学公式需要使用特定的 class 标记
   * 3. 块级公式用 <pre class="math">
   * 4. 行内公式用 <span class="math">
   *
   * 转换步骤:
   * 1. 使用 MainWindow 的核心方法将 Markdown 转换为 HTML
   * 2. 移除所有内联样式属性
   * 3. 将 MathJax 格式的公式转换为 Zotero 识别的格式
   *
   * 公式格式转换规则:
   * - `$$公式$$` -> `<pre class="math">$$公式$$</pre>` (块级)
   * - `$公式$` -> `<span class="math">$公式$</span>` (行内)
   *
   * @param markdown 原始 Markdown 文本
   * @returns 转换后的 HTML,适配 Zotero 笔记系统
   *
   * @example
   * ```typescript
   * const html = convertMarkdownToNoteHTML(
   *   "## 公式\n质能方程: $E=mc^2$\n\n$$\\frac{a}{b}$$"
   * );
   * // 返回格式化的 HTML,公式被正确标记
   * ```
   */
  private static convertMarkdownToNoteHTML(markdown: string): string {
    // ===== 步骤 1: 保护公式，避免被 marked 误处理（将下划线转成 <em>）=====
    const formulas: Array<{ content: string; isBlock: boolean }> = [];
    let processedMarkdown = markdown;

    // 保护块级公式 $$...$$ 和 \[...\]
    processedMarkdown = processedMarkdown.replace(
      /(\$\$|\\\[)([\s\S]*?)(\$\$|\\\])/g,
      (_match, start, formula, end) => {
        // 确保匹配闭合（虽然正则已经尽量做了，但防止 $$ 匹配到 \] 等情况，虽然正则结构保证了配对如果贪婪度控制得好）
        // 这里简化处理：只要匹配到了就当做公式
        const placeholder = `FORMULA_BLOCK_${formulas.length}_END`;
        formulas.push({ content: formula.trim(), isBlock: true });
        return placeholder;
      },
    );

    // 保护内联公式 $...$ 和 \(...\)
    processedMarkdown = processedMarkdown.replace(
      // eslint-disable-next-line no-useless-escape
      /((?<!\$)\$(?!\$)|\\\()([^\$\n]+?)((?<!\$)\$(?!\$)|\\\))/g,
      (_match, start, formula, end) => {
        // 简单的完整性检查：start 和 end 应该属于同一类（$配$，\(配\)）
        // 但为了宽容度，我们暂不严格校验配对，因为正则已经限制了内部不含 delimiters
        const placeholder = `FORMULA_INLINE_${formulas.length}_END`;
        formulas.push({ content: formula.trim(), isBlock: false });
        return placeholder;
      },
    );

    // ===== 步骤 2: 预处理加粗语法 =====
    processedMarkdown = processedMarkdown.replace(
      // eslint-disable-next-line no-useless-escape
      /\*\*([^\*\n]+?)\*\*/g,
      "<strong>$1</strong>",
    );

    // ===== 步骤 3: 配置并运行 marked =====
    marked.setOptions({
      breaks: true, // 单换行符转换为 <br>，解决国产模型换行问题
      gfm: true, // 启用 GitHub Flavored Markdown
    });

    let html = marked.parse(processedMarkdown) as string;

    // 移除所有内联样式,Zotero 笔记不支持 style 属性
    html = html.replace(/\s+style="[^"]*"/g, "");

    // ===== 步骤 4: 恢复公式（使用 Zotero 原生笔记编辑器识别的格式）=====
    html = html.replace(
      /FORMULA_(BLOCK|INLINE)_(\d+)_END/g,
      (_match, type, index) => {
        const formulaData = formulas[parseInt(index)];
        if (!formulaData) return _match;
        const { content, isBlock } = formulaData;

        // 关键修复：必须对 LaTeX 内容进行 HTML 转义，否则 <, >, & 等字符会破坏 XML 结构
        const escapedContent = NoteGenerator.escapeHtml(content);

        // 根据用户反馈和 Zotero 特性调整：
        // 鉴于用户反馈块级公式 <math-display> 未渲染，而行内公式有效
        // 为了稳妥，暂时将所有公式都作为 <math-inline> 生成
        if (isBlock) {
          // 块级公式：必须使用 $ 包裹（Zotero不支持 $$），加上 \displaystyle 强制显示为块级样式
          // 外层用 p 和 style 实现居中
          return `<p style="text-align: center;"><span class="math">$\\displaystyle ${escapedContent}$</span></p>`;
        } else {
          // 行内公式：使用 $ 包裹
          return `<span class="math">$${escapedContent}$</span>`;
        }
      },
    );

    return html;
  }

  /**
   * HTML 转义工具函数
   *
   * 将特殊字符转换为 HTML 实体,防止 XSS 攻击和格式错误
   *
   * 转义规则:
   * - & → &amp;
   * - < → &lt;
   * - > → &gt;
   * - " → &quot;
   * - ' → &#39;
   *
   * @param text 待转义的文本
   * @returns 转义后的安全 HTML 文本
   *
   * @example
   * ```typescript
   * escapeHtml('<script>alert("xss")</script>')
   * // 返回: "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
   * ```
   */
  private static escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * 创建新的 Zotero 笔记条目
   *
   * 在 Zotero 数据库中创建一个新的笔记,并关联到指定的文献条目
   *
   * 操作步骤:
   * 1. 实例化一个新的笔记对象
   * 2. 设置父条目 ID (关联到文献)
   * 3. 设置笔记内容 (HTML 格式)
   * 4. 添加标签 "AI-Generated"
   * 5. 保存到数据库
   *
   * 笔记特性:
   * - 自动关联到父文献条目
   * - 带有 "AI-Generated" 标签便于筛选
   * - 内容为 HTML 格式,支持富文本显示
   *
   * @param item 父文献条目对象
   * @param initialContent 初始笔记内容 (HTML 格式),默认为空字符串
   * @returns 创建并保存的笔记对象
   *
   * @example
   * ```typescript
   * const note = await createNote(
   *   parentItem,
   *   "<h2>总结</h2><p>这是AI生成的内容</p>"
   * );
   * console.log(note.id); // 新创建的笔记 ID
   * ```
   */
  public static async createNote(
    item: Zotero.Item,
    initialContent: string = "",
  ): Promise<Zotero.Item> {
    // 创建新的笔记对象
    const note = new Zotero.Item("note");

    // 设置库 ID 和父条目 ID,将笔记关联到文献
    // 修复群组文献库中创建笔记时 "Parent item not found" 的问题
    note.libraryID = item.libraryID;
    note.parentID = item.id;

    // 设置笔记内容
    note.setNote(initialContent);

    // 添加 AI 总结标签,便于用户筛选和识别
    note.addTag(AiNoteService.getTag("summary"));

    // 保存到数据库
    await note.saveTx();

    return note;
  }

  /**
   * Execute the AI deep read v2 two-phase workflow.
   */
  private static async generateDeepReadContent(params: {
    item: Zotero.Item;
    existing: Zotero.Item | null;
    existingHtml: string;
    policy: string;
    pdfContent: string;
    isBase64: boolean;
    itemTitle: string;
    outputWindow?: SummaryView;
    progressCallback?: (message: string, progress: number) => void;
    streamCallback?: (chunk: string) => void;
    abortSignal?: LLMAbortSignal;
  }): Promise<{
    note: Zotero.Item;
    content: string;
    noteHtml: string;
    response?: LLMResponse;
  }> {
    const currentTemplate = this.getActiveDeepReadTemplate();
    const shouldResume =
      params.existing &&
      hasDeepReadV2Slots(params.existingHtml) &&
      hasRunnableDeepReadSlots(params.existingHtml);
    const restoredPlan = shouldResume
      ? extractDeepReadPlanMetadata(params.existingHtml)
      : null;
    const templateChanged =
      !!restoredPlan?.templateId &&
      restoredPlan.templateId !== currentTemplate.id;
    const template =
      templateChanged && restoredPlan?.template
        ? restoredPlan.template
        : currentTemplate;
    if (templateChanged) {
      this.showDeepReadNotice(
        restoredPlan?.template
          ? "Template changed; resuming with the template saved in the note."
          : "Template changed; saved note has no template snapshot, resuming with the current template.",
        "warning",
      );
    }

    const sequentialPhase = template.phases.find(
      (phase) => phase.type === "sequential_dynamic",
    );
    if (!sequentialPhase || sequentialPhase.type !== "sequential_dynamic") {
      throw new Error(
        "AI \u7cbe\u8bfb\u6a21\u677f\u7f3a\u5c11 sequential_dynamic \u9636\u6bb5",
      );
    }

    let lastResponse: LLMResponse | undefined;
    let chapters = restoredPlan?.chapters || [];
    if (params.outputWindow) {
      params.outputWindow.startItem(params.itemTitle);
      params.outputWindow.appendContent(
        "## AI 精读：双阶段逐章阅读\n\nAI 会先解析章节结构，再按章节顺序逐章精读，最后执行重点追问。\n\n",
      );
    }

    if (!chapters.length) {
      params.outputWindow?.appendContent("### 正在解析章节结构\n\n");
      params.outputWindow?.appendContent(
        `**章节解析提示词：**\n\n${sequentialPhase.planningPrompt}\n\n`,
      );
      params.progressCallback?.("正在解析章节结构...", 45);
      const planningResponse = await this.callDeepReadChat({
        pdfContent: params.pdfContent,
        isBase64: params.isBase64,
        conversation: [
          { role: "user", content: sequentialPhase.planningPrompt },
        ],
        abortSignal: params.abortSignal,
      });
      lastResponse = planningResponse;
      const parsedChapters = parseChapterStructureResult(planningResponse.text);
      chapters =
        parsedChapters.source === "fallback"
          ? this.promptManualChapterStructure() || parsedChapters.chapters
          : parsedChapters.chapters;
      if (parsedChapters.source === "regex") {
        this.showDeepReadNotice(
          "章节 JSON 解析失败，已使用正则兜底识别章节。",
          "warning",
        );
      }
      if (parsedChapters.source === "fallback") {
        this.showDeepReadNotice(
          "章节解析失败，已使用手动输入或默认章节兜底。",
          "warning",
        );
      }
    } else {
      params.outputWindow?.appendContent("### 从现有精读笔记恢复章节结构\n\n");
      params.progressCallback?.("正在从已有笔记恢复精读进度...", 45);
    }

    const planned = planDeepReadSlots(template, chapters);

    if (params.outputWindow) {
      params.outputWindow.appendContent(
        `识别到章节：${chapters
          .map(
            (chapter) =>
              `${chapter.title_zh}（${chapter.title_en || "无英文标题"}）`,
          )
          .join("、")}\n\n`,
      );
    }

    const progressSlots = template.finalPrompt?.trim()
      ? [
          ...planned.slots,
          {
            id: DEEP_READ_FINAL_SLOT_ID,
            title: "??",
            prompt: template.finalPrompt.trim(),
            phaseId: "final",
            phaseTitle: "??",
            phaseType: "independent" as const,
            status: "pending" as const,
          },
        ]
      : planned.slots;
    params.outputWindow?.setDeepReadProgressSlots?.(progressSlots);

    const skeleton = buildDeepReadSkeletonHtml(
      params.itemTitle,
      template,
      planned,
    );
    const note = shouldResume
      ? (params.existing as Zotero.Item)
      : await AiNoteService.saveGeneratedNote({
          item: params.item,
          kind: "deepRead",
          html: skeleton,
          existing: params.existing,
          policy: params.policy === "append" ? "append" : "overwrite",
        });

    let writeQueue = Promise.resolve();
    const updateSlot = async (
      slot: DeepReadSlot,
      markdown: string,
      status: "done" | "error" = "done",
    ) => {
      params.outputWindow?.updateDeepReadProgressSlot?.(
        slot.id,
        slot.title,
        status,
        slot.phaseTitle,
      );
      writeQueue = writeQueue.then(async () => {
        const currentHtml = ((note as any).getNote?.() as string) || "";
        const nextHtml = fillDeepReadSlot(
          currentHtml,
          slot.id,
          markdown,
          slot.title,
          status,
        );
        if (nextHtml !== currentHtml) {
          (note as any).setNote?.(nextHtml);
          await (note as any).saveTx?.();
        }
      });
      await writeQueue;
    };

    const markSlotRunning = async (slot: DeepReadSlot) => {
      params.outputWindow?.updateDeepReadProgressSlot?.(
        slot.id,
        slot.title,
        "running",
        slot.phaseTitle,
      );
      writeQueue = writeQueue.then(async () => {
        const currentHtml = ((note as any).getNote?.() as string) || "";
        const nextHtml = markDeepReadSlotRunning(
          currentHtml,
          slot.id,
          slot.title,
        );
        if (nextHtml !== currentHtml) {
          (note as any).setNote?.(nextHtml);
          await (note as any).saveTx?.();
        }
      });
      await writeQueue;
    };

    const retryableSlots = progressSlots as DeepReadSlot[];
    params.outputWindow?.setDeepReadRetryHandler?.(async (slotId) => {
      const slot = retryableSlots.find((candidate) => candidate.id === slotId);
      if (!slot) return;
      const currentHtml = ((note as any).getNote?.() as string) || "";
      if (isDeepReadSlotDone(currentHtml, slot.id)) {
        this.showDeepReadNotice(
          "This slot is already done; retry skipped.",
          "success",
        );
        return;
      }
      await markSlotRunning(slot);
      try {
        const response = await this.callDeepReadChat({
          item: params.item,
          pdfContent: params.pdfContent,
          isBase64: params.isBase64,
          conversation: [{ role: "user", content: slot.prompt }],
          abortSignal: params.abortSignal,
          onProgress: (chunk) => {
            params.streamCallback?.(chunk);
            params.outputWindow?.appendContent(chunk);
          },
        });
        lastResponse = response;
        await updateSlot(slot, response.text, "done");
      } catch (error: any) {
        if (isAbortError(error, params.abortSignal)) throw error;
        await updateSlot(slot, error?.message || String(error), "error");
      }
    });

    const collected: string[] = [];

    try {
      const fullHistory: Array<{
        role: "user" | "assistant";
        content: string;
      }> = [];
      let previousAnswer = "";

      for (let index = 0; index < planned.sequentialSlots.length; index++) {
        const slot = planned.sequentialSlots[index];
        const currentHtml = ((note as any).getNote?.() as string) || "";
        if (!shouldRunDeepReadSlot(currentHtml, slot.id)) continue;

        throwIfAborted(params.abortSignal);
        params.progressCallback?.(
          `\u6b63\u5728\u7cbe\u8bfb\uff1a${slot.title}`,
          55 +
            Math.floor(
              (index / Math.max(1, planned.sequentialSlots.length)) * 20,
            ),
        );
        params.outputWindow?.appendContent(
          `### \u6b63\u5728\u7cbe\u8bfb\uff1a${slot.title}\n\n`,
        );
        params.outputWindow?.appendContent(
          `**\u672c\u7ae0\u63d0\u793a\u8bcd\uff1a**\n\n${slot.prompt}\n\n`,
        );

        const userPrompt =
          sequentialPhase.contextStrategy === "full_history"
            ? slot.prompt
            : previousAnswer
              ? `\u4e0a\u4e00\u8f6e\u7cbe\u8bfb\u5185\u5bb9\u4f9b\u53c2\u8003\uff1a\n${previousAnswer}\n\n\u672c\u8f6e\u4efb\u52a1\uff1a\n${slot.prompt}`
              : slot.prompt;
        const conversation =
          sequentialPhase.contextStrategy === "full_history"
            ? [...fullHistory, { role: "user" as const, content: userPrompt }]
            : [{ role: "user" as const, content: userPrompt }];

        await markSlotRunning(slot);
        try {
          const response = await this.callDeepReadChat({
            item: params.item,
            pdfContent: params.pdfContent,
            isBase64: params.isBase64,
            conversation,
            abortSignal: params.abortSignal,
            onProgress: (chunk) => {
              params.streamCallback?.(chunk);
              params.outputWindow?.appendContent(chunk);
            },
          });
          lastResponse = response;
          previousAnswer = response.text;
          collected.push(`# ${slot.title}\n\n${response.text}`);
          fullHistory.push({ role: "user", content: userPrompt });
          fullHistory.push({ role: "assistant", content: response.text });
          await updateSlot(slot, response.text, "done");
        } catch (error: any) {
          if (
            isAbortError(error, params.abortSignal) ||
            this.shouldStopDeepReadOnError(error)
          )
            throw error;
          await updateSlot(slot, error?.message || String(error), "error");
        }
      }

      const runIndependentSlot = async (
        slot: DeepReadSlot,
        index: number,
        streamLive: boolean,
      ) => {
        const currentHtml = ((note as any).getNote?.() as string) || "";
        if (!shouldRunDeepReadSlot(currentHtml, slot.id)) return;

        throwIfAborted(params.abortSignal);
        params.progressCallback?.(
          `\u6b63\u5728\u8ffd\u95ee\uff1a${slot.title}`,
          78 +
            Math.floor(
              (index / Math.max(1, planned.independentSlots.length)) * 12,
            ),
        );
        params.outputWindow?.appendContent(
          `### \u6b63\u5728\u8ffd\u95ee\uff1a${slot.title}\n\n`,
        );
        params.outputWindow?.appendContent(
          `**\u8ffd\u95ee\u63d0\u793a\u8bcd\uff1a**\n\n${slot.prompt}\n\n`,
        );

        await markSlotRunning(slot);
        try {
          const response = await this.callDeepReadChat({
            item: params.item,
            pdfContent: params.pdfContent,
            isBase64: params.isBase64,
            conversation: [{ role: "user", content: slot.prompt }],
            abortSignal: params.abortSignal,
            onProgress: streamLive
              ? (chunk) => {
                  params.streamCallback?.(chunk);
                  params.outputWindow?.appendContent(chunk);
                }
              : undefined,
          });
          lastResponse = response;
          collected.push(`# ${slot.title}\n\n${response.text}`);
          if (!streamLive) {
            params.streamCallback?.(response.text);
            params.outputWindow?.appendContent(response.text);
          }
          await updateSlot(slot, response.text, "done");
        } catch (error: any) {
          if (
            isAbortError(error, params.abortSignal) ||
            this.shouldStopDeepReadOnError(error)
          )
            throw error;
          await updateSlot(slot, error?.message || String(error), "error");
        }
      };

      let independentIndex = 0;
      for (const phase of template.phases) {
        if (phase.type !== "independent") continue;
        const phaseSlots = planned.independentSlots.filter(
          (slot) => slot.phaseId === phase.id,
        );
        const maxConcurrency = phase.parallelizable ? phase.maxConcurrency : 1;
        for (
          let start = 0;
          start < phaseSlots.length;
          start += maxConcurrency
        ) {
          const batch = phaseSlots.slice(start, start + maxConcurrency);
          const batchStartIndex = independentIndex;
          independentIndex += batch.length;
          if (maxConcurrency === 1) {
            await runIndependentSlot(batch[0], batchStartIndex, true);
            continue;
          }
          const results = await Promise.allSettled(
            batch.map((slot, offset) =>
              runIndependentSlot(slot, batchStartIndex + offset, false),
            ),
          );
          const aborted = results.find(
            (result) =>
              result.status === "rejected" &&
              this.shouldStopDeepReadOnError(result.reason),
          );
          if (aborted?.status === "rejected") throw aborted.reason;
        }
      }

      if (template.finalPrompt?.trim()) {
        const finalSlot: DeepReadSlot = {
          id: DEEP_READ_FINAL_SLOT_ID,
          title: "总结",
          prompt: template.finalPrompt.trim(),
          phaseId: "final",
          phaseTitle: "总结",
          phaseType: "independent",
          status: "pending",
        };
        const currentHtml = ((note as any).getNote?.() as string) || "";
        if (shouldRunDeepReadSlot(currentHtml, finalSlot.id)) {
          await markSlotRunning(finalSlot);
          params.progressCallback?.("正在生成精读总结...", 94);
          try {
            const response = await this.callDeepReadChat({
              pdfContent: params.pdfContent,
              isBase64: params.isBase64,
              conversation: [{ role: "user", content: finalSlot.prompt }],
              abortSignal: params.abortSignal,
            });
            lastResponse = response;
            collected.push(`# ${finalSlot.title}\n\n${response.text}`);
            await updateSlot(finalSlot, response.text, "done");
          } catch (error: any) {
            if (
              isAbortError(error, params.abortSignal) ||
              this.shouldStopDeepReadOnError(error)
            )
              throw error;
            await updateSlot(
              finalSlot,
              error?.message || String(error),
              "error",
            );
          }
        }
      }
    } catch (error) {
      if (isAbortError(error, params.abortSignal)) {
        writeQueue = writeQueue.then(async () => {
          const currentHtml = ((note as any).getNote?.() as string) || "";
          const nextHtml = resetRunningDeepReadSlots(currentHtml);
          if (nextHtml !== currentHtml) {
            (note as any).setNote?.(nextHtml);
            await (note as any).saveTx?.();
          }
        });
        await writeQueue;
        for (const slot of progressSlots) {
          const status = ((note as any).getNote?.() as string) || "";
          if (shouldRunDeepReadSlot(status, slot.id)) {
            params.outputWindow?.updateDeepReadProgressSlot?.(
              slot.id,
              slot.title,
              "pending",
              slot.phaseTitle,
            );
          }
        }
      }
      throw error;
    }

    await writeQueue;
    const noteHtml = ((note as any).getNote?.() as string) || skeleton;
    return {
      note,
      content: collected.join("\n\n---\n\n") || noteHtml,
      noteHtml,
      response: lastResponse,
    };
  }

  private static promptManualChapterStructure(): ReturnType<
    typeof parseManualChapterStructure
  > | null {
    const win = Zotero.getMainWindow() as any;
    const text = { value: "" } as any;
    const ok = Services.prompt.prompt(
      win,
      "手动输入章节结构",
      "章节解析失败。请每行输入一个章节，例如：第1章：Introduction",
      text,
      "",
      { value: false },
    );
    if (!ok || !text.value?.trim()) return null;
    const chapters = parseManualChapterStructure(text.value);
    return chapters.length ? chapters : null;
  }

  private static showDeepReadNotice(
    text: string,
    type: "success" | "warning" | "fail" = "warning",
  ): void {
    try {
      new ztoolkit.ProgressWindow("AI 精读").createLine({ text, type }).show();
    } catch {
      ztoolkit.log(`[AI-Butler] ${text}`);
    }
  }

  private static getActiveDeepReadTemplate(): MultiRoundPromptTemplate {
    const selectedTemplateId = (
      (getPref("multiRoundPromptTemplateId" as any) as string) || ""
    ).trim();
    const customTemplates = parseMultiRoundPromptTemplates(
      (getPref("multiRoundPromptTemplates" as any) as string) || "[]",
    );
    const templates = mergeMultiRoundPromptTemplates(
      getBuiltinMultiRoundPromptTemplates(),
      customTemplates,
    );
    return (
      templates.find((template) => template.id === selectedTemplateId) ||
      getDefaultMultiRoundPromptTemplate()
    );
  }

  private static async callDeepReadChat(params: {
    item?: Zotero.Item;
    pdfContent: string;
    isBase64: boolean;
    conversation: Array<{ role: "user" | "assistant"; content: string }>;
    abortSignal?: LLMAbortSignal;
    onProgress?: (chunk: string) => void;
  }): Promise<LLMResponse> {
    const content = params.item
      ? {
          kind: "zotero-item" as const,
          item: params.item,
          attachmentMode: "default" as const,
        }
      : {
          kind: "legacy" as const,
          content: params.pdfContent,
          isBase64: params.isBase64,
          policy: params.isBase64 ? ("pdf-base64" as const) : ("text" as const),
        };
    let conversation = params.conversation;
    let response = await LLMService.chat({
      content,
      conversation,
      transport: { abortSignal: params.abortSignal },
      onProgress: params.onProgress,
    });
    let text = response.text;

    for (
      let attempt = 0;
      attempt < 2 && this.isLikelyTruncated(response);
      attempt++
    ) {
      throwIfAborted(params.abortSignal);
      const continuePrompt =
        "The previous answer appears to be truncated. Continue exactly from where it stopped. Do not repeat earlier content.";
      conversation = [
        ...conversation,
        { role: "assistant", content: response.text },
        { role: "user", content: continuePrompt },
      ];
      const continuation = await LLMService.chat({
        content,
        conversation,
        transport: { abortSignal: params.abortSignal },
        onProgress: params.onProgress,
      });
      response = { ...continuation, text: text + "\n\n" + continuation.text };
      text = response.text;
    }

    return response;
  }

  private static isLikelyTruncated(response: LLMResponse): boolean {
    const reason = (response.finishReason || "").toLowerCase();
    return ["length", "max_tokens", "max_output_tokens", "content_filter"].some(
      (value) => reason.includes(value),
    );
  }

  private static shouldStopDeepReadOnError(error: unknown): boolean {
    const value = error as
      | {
          name?: string;
          suppressTaskRetry?: boolean;
        }
      | undefined;
    return (
      value?.suppressTaskRetry === true ||
      value?.name === "LLMApiCallError" ||
      value?.name === "LLMApiExhaustedError"
    );
  }

  public static async generateNotesForItems(
    items: Zotero.Item[],
    progressCallback?: (
      current: number,
      total: number,
      progress: number,
      message: string,
    ) => void,
  ): Promise<void> {
    const total = items.length;
    let successCount = 0; // 成功处理计数
    let failedCount = 0; // 失败处理计数
    let stopped = false; // 用户停止标记
    let processingCompleted = false;

    // 创建并打开主窗口
    const mainWindow = MainWindow.getInstance();
    await mainWindow.open("summary");

    // 获取 AI 总结视图
    const summaryView = mainWindow.getSummaryView();
    summaryView.updateQueueButton("ready");

    // 设置返回任务队列按钮的回调函数
    summaryView.setQueueButtonHandler(() => {
      if (!stopped && !processingCompleted) {
        stopped = true;
        summaryView.updateQueueButton("stopped");
      }
      mainWindow.switchTab("tasks");
    });

    // 等待窗口完全初始化,避免渲染问题
    await Zotero.Promise.delay(200);

    try {
      // 依次处理每个文献条目
      for (let i = 0; i < total; i++) {
        // 检查用户是否点击了停止按钮
        if (stopped) {
          ztoolkit.log("[AI Butler] 用户停止了批量处理");
          break;
        }

        const item = items[i];
        const current = i + 1;
        const itemTitle = item.getField("title") as string;

        try {
          // 为当前条目生成笔记,带流式输出
          await this.generateNoteForItem(
            item,
            summaryView,
            (message, progress) => {
              // 转发进度信息到外层回调
              progressCallback?.(current, total, progress, message);
            },
          );

          // 成功计数加一
          successCount++;
        } catch (error: any) {
          // 记录失败,但继续处理下一个条目
          failedCount++;
          ztoolkit.log(`[AI Butler] 处理文献"${itemTitle}"失败:`, error);
        }
      }

      // 根据停止状态显示不同的完成消息
      if (stopped) {
        // 用户主动停止的情况
        const notProcessed = total - successCount - failedCount;
        summaryView.showStopped(successCount, failedCount, notProcessed);
        summaryView.updateQueueButton("stopped");
        processingCompleted = true;
        progressCallback?.(
          total,
          total,
          100,
          `已停止 (已完成 ${successCount} 个，失败 ${failedCount} 个，未处理 ${notProcessed} 个)`,
        );
      } else {
        // 正常完成的情况
        summaryView.showComplete(successCount, total);
        summaryView.updateQueueButton("completed");
        processingCompleted = true;

        // 根据成功/失败情况生成不同的完成消息
        if (failedCount === 0) {
          progressCallback?.(total, total, 100, "所有条目处理完成");
        } else if (successCount === 0) {
          progressCallback?.(total, total, 100, "所有条目处理失败");
        } else {
          progressCallback?.(
            total,
            total,
            100,
            `${successCount} 个成功，${failedCount} 个失败`,
          );
        }
      }
    } catch (error: any) {
      // 发生系统级错误时禁用停止按钮
      summaryView.updateQueueButton("error");
      processingCompleted = true;
      ztoolkit.log("[AI Butler] 批量处理过程中发生错误:", error);
      throw error;
    }
  }
}
