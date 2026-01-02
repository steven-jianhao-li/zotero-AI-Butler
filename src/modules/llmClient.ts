/**
 * 精简版 LLMClient 门面：
 * - 读取偏好
 * - 组装统一 LLMOptions
 * - 委派给 ProviderRegistry
 * 供应商私有逻辑都在 src/modules/llmproviders 下实现。
 */
import { getPref } from "../utils/prefs";
import { getDefaultSummaryPrompt } from "../utils/prompts";
import { ProviderRegistry } from "./llmproviders/ProviderRegistry";
import "./llmproviders";
import type {
  LLMOptions,
  ProgressCb as ProviderProgressCb,
  ConversationMessage,
} from "./llmproviders/types";

type ProgressCb = (chunk: string) => Promise<void> | void;

export class LLMClient {
  private static getRequestTimeout(): number {
    const raw = (getPref("requestTimeout") as string) || "300000";
    const val = parseInt(raw) || 300000;
    return Math.max(val, 30000);
  }

  private static buildOptions(
    providerId: string,
    extra?: Partial<LLMOptions>,
  ): LLMOptions {
    const id = providerId.toLowerCase();
    const common: LLMOptions = {
      stream: (getPref("stream") as boolean) ?? true,
      temperature:
        parseFloat((getPref("temperature") as string) || "0.7") || 0.7,
      topP: parseFloat((getPref("topP") as string) || "1.0") || 1.0,
      maxTokens: parseInt((getPref("maxTokens") as string) || "4096") || 4096,
      requestTimeoutMs: LLMClient.getRequestTimeout(),
    };
    if (id.includes("gemini") || id === "google") {
      common.apiUrl = (
        (getPref("geminiApiUrl" as any) as string) ||
        "https://generativelanguage.googleapis.com"
      ).replace(/\/$/, "");
      common.apiKey = ((getPref("geminiApiKey" as any) as string) || "").trim();
      common.model = (
        (getPref("geminiModel" as any) as string) || "gemini-2.5-pro"
      ).trim();
    } else if (id.includes("anthropic") || id.includes("claude")) {
      common.apiUrl = (
        (getPref("anthropicApiUrl" as any) as string) ||
        "https://api.anthropic.com"
      ).replace(/\/$/, "");
      common.apiKey = (
        (getPref("anthropicApiKey" as any) as string) || ""
      ).trim();
      common.model = (
        (getPref("anthropicModel" as any) as string) ||
        "claude-3-5-sonnet-20241022"
      ).trim();
    } else if (id === "openai-compat") {
      // 旧 Chat Completions 兼容
      common.apiUrl = (
        (getPref("openaiCompatApiUrl" as any) as string) ||
        "https://api.openai.com/v1/chat/completions"
      ).trim();
      common.apiKey = (
        (getPref("openaiCompatApiKey" as any) as string) ||
        (getPref("openaiApiKey" as any) as string) ||
        ""
      ).trim();
      common.model = (
        (getPref("openaiCompatModel" as any) as string) ||
        (getPref("openaiApiModel" as any) as string) ||
        "gpt-3.5-turbo"
      ).trim();
    } else if (id === "openrouter") {
      common.apiUrl = (
        (getPref("openRouterApiUrl" as any) as string) ||
        "https://openrouter.ai/api/v1/chat/completions"
      ).trim();
      common.apiKey = (
        (getPref("openRouterApiKey" as any) as string) || ""
      ).trim();
      common.model = (
        (getPref("openRouterModel" as any) as string) || "google/gemma-3-27b-it"
      ).trim();
    } else {
      common.apiUrl = ((getPref("openaiApiUrl" as any) as string) || "").trim();
      common.apiKey = ((getPref("openaiApiKey" as any) as string) || "").trim();
      common.model = (
        (getPref("openaiApiModel" as any) as string) || "gpt-3.5-turbo"
      ).trim();
    }
    return { ...common, ...(extra || {}) };
  }

  private static resolveProvider(): { id: string; impl: any } {
    const providerId = (
      (getPref("provider" as any) as string) || "openai"
    ).trim();
    const impl =
      ProviderRegistry.get(providerId) || ProviderRegistry.get("openai");
    if (!impl) {
      const list = ProviderRegistry.list().join(", ");
      const msg = `未知的供应商: ${providerId}。可用: ${list}`;
      LLMClient.notifyError(msg);
      throw new Error(msg);
    }
    return { id: providerId, impl };
  }

  static async generateSummary(
    content: string,
    isBase64 = false,
    prompt?: string,
    onProgress?: ProgressCb,
  ): Promise<string> {
    const { id, impl } = this.resolveProvider();
    const saved = (getPref("summaryPrompt") as string) || "";
    const summaryPrompt =
      prompt || (saved.trim() ? saved : getDefaultSummaryPrompt());
    const options = this.buildOptions(id);
    return impl.generateSummary(
      content,
      isBase64,
      summaryPrompt,
      options,
      onProgress as ProviderProgressCb,
    );
  }

  static async chat(
    pdfContent: string,
    isBase64: boolean,
    conversation: Array<{ role: string; content: string }>,
    onProgress?: ProgressCb,
  ): Promise<string> {
    const { id, impl } = this.resolveProvider();
    const options = this.buildOptions(id);
    return impl.chat(
      pdfContent,
      isBase64,
      conversation as ConversationMessage[],
      options,
      onProgress as ProviderProgressCb,
    );
  }

  static async testConnection(): Promise<string> {
    const { id, impl } = this.resolveProvider();
    const options = this.buildOptions(id, { stream: false });
    return impl.testConnection(options);
  }

  private static notifyError(message: string) {
    try {
      new ztoolkit.ProgressWindow("AI Butler", {
        closeOtherProgressWindows: false,
      })
        .createLine({ text: message, type: "default" })
        .show();
    } catch {
      try {
        Zotero?.log?.(message);
      } catch {
        // 忽略
      }
    }
  }
}

export default LLMClient;
