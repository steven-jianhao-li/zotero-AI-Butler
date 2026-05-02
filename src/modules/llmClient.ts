/**
 * 兼容版 LLMClient 门面。
 *
 * 新业务代码应优先使用 LLMService；本类保留旧入口签名，
 * 并统一委托给 LLMService，避免上层继续绕过中间件。
 */
import LLMService from "./llmService";
import type { ILlmProvider, PdfFileInfo } from "./llmproviders/ILlmProvider";
import type {
  ConversationMessage,
  LLMOptions,
  ProgressCb,
} from "./llmproviders/types";

export class LLMClient {
  static getCurrentProvider(): ILlmProvider | null {
    return LLMService.getCurrentProvider();
  }

  static async generateSummary(
    content: string,
    isBase64 = false,
    prompt?: string,
    onProgress?: ProgressCb,
  ): Promise<string> {
    return LLMService.generateText({
      task: "summary",
      prompt,
      content: {
        kind: "legacy",
        content,
        isBase64,
        policy: isBase64 ? "pdf-base64" : "text",
      },
      transport: { retry: false, keyRotation: false },
      onProgress,
    });
  }

  static async generateMultiFileSummary(
    pdfFiles: PdfFileInfo[],
    prompt?: string,
    onProgress?: ProgressCb,
  ): Promise<string> {
    return LLMService.generateText({
      task: "summary",
      prompt,
      content: {
        kind: "pdf-files",
        files: pdfFiles,
        policy: "pdf-base64",
      },
      transport: { retry: false, keyRotation: false },
      onProgress,
    });
  }

  static async chat(
    pdfContent: string,
    isBase64: boolean,
    conversation: Array<{ role: string; content: string }>,
    onProgress?: ProgressCb,
  ): Promise<string> {
    return LLMService.chatText({
      content: {
        kind: "legacy",
        content: pdfContent,
        isBase64,
        policy: isBase64 ? "pdf-base64" : "text",
      },
      conversation: conversation as ConversationMessage[],
      transport: { retry: false, keyRotation: false },
      onProgress,
    });
  }

  static async testConnection(): Promise<string> {
    return LLMService.testConnection();
  }

  static getLLMOptions(): LLMOptions {
    return LLMService.getLLMOptions();
  }

  static async testConnectionWithKey(apiKey: string): Promise<string> {
    return LLMService.testConnectionWithKey(apiKey);
  }

  static async generateSummaryWithRetry(
    content: string,
    isBase64 = false,
    prompt?: string,
    onProgress?: ProgressCb,
  ): Promise<string> {
    return LLMService.generateText({
      task: "summary",
      prompt,
      content: {
        kind: "legacy",
        content,
        isBase64,
        policy: isBase64 ? "pdf-base64" : "text",
      },
      onProgress,
    });
  }

  static async chatWithRetry(
    pdfContent: string,
    isBase64: boolean,
    conversation: Array<{ role: string; content: string }>,
    onProgress?: ProgressCb,
  ): Promise<string> {
    return LLMService.chatText({
      content: {
        kind: "legacy",
        content: pdfContent,
        isBase64,
        policy: isBase64 ? "pdf-base64" : "text",
      },
      conversation: conversation as ConversationMessage[],
      onProgress,
    });
  }
}

export default LLMClient;
