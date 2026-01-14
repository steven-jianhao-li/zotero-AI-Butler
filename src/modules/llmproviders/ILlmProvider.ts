import { LLMOptions, ProgressCb, ConversationMessage } from "./types";

/**
 * PDF 文件信息接口
 */
export interface PdfFileInfo {
  /** 文件路径 */
  filePath: string;
  /** 显示名称 */
  displayName: string;
  /** Base64 编码内容（可选，用于不支持 File API 的场景） */
  base64Content?: string;
}

export interface ILlmProvider {
  readonly id: string;

  generateSummary(
    content: string,
    isBase64: boolean,
    prompt: string | undefined,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string>;

  chat(
    pdfContent: string,
    isBase64: boolean,
    conversation: ConversationMessage[],
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string>;

  testConnection(options: LLMOptions): Promise<string>;

  /**
   * 多文件摘要生成（可选方法）
   * 支持同时处理多个 PDF 文件
   *
   * @param pdfFiles PDF 文件列表
   * @param prompt 用户提示词
   * @param options LLM 选项
   * @param onProgress 进度回调
   */
  generateMultiFileSummary?(
    pdfFiles: PdfFileInfo[],
    prompt: string,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string>;
}
