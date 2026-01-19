/**
 * 精简版 LLMClient 门面：
 * - 读取偏好
 * - 组装统一 LLMOptions
 * - 委派给 ProviderRegistry
 * - 支持多 API 密钥轮换
 * 供应商私有逻辑都在 src/modules/llmproviders 下实现。
 */
import { getPref } from "../utils/prefs";
import { getDefaultSummaryPrompt } from "../utils/prompts";
import { ProviderRegistry } from "./llmproviders/ProviderRegistry";
import { ApiKeyManager, type ProviderId } from "./apiKeyManager";
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

    // 检查参数启用状态
    const enableTemperature =
      (getPref("enableTemperature" as any) as boolean) ?? true;
    const enableMaxTokens =
      (getPref("enableMaxTokens" as any) as boolean) ?? true;
    const enableTopP = (getPref("enableTopP" as any) as boolean) ?? true;

    const common: LLMOptions = {
      stream: (getPref("stream") as boolean) ?? true,
      requestTimeoutMs: LLMClient.getRequestTimeout(),
    };

    // 仅在启用时添加对应参数
    if (enableTemperature) {
      common.temperature =
        parseFloat((getPref("temperature") as string) || "0.7") || 0.7;
    }
    if (enableTopP) {
      common.topP = parseFloat((getPref("topP") as string) || "1.0") || 1.0;
    }
    if (enableMaxTokens) {
      common.maxTokens =
        parseInt((getPref("maxTokens") as string) || "4096") || 4096;
    }

    // 映射到 ApiKeyManager 的 ProviderId
    const keyManagerId = this.mapToKeyManagerId(id);

    if (id.includes("gemini") || id === "google") {
      common.apiUrl = (
        (getPref("geminiApiUrl" as any) as string) ||
        "https://generativelanguage.googleapis.com"
      ).replace(/\/$/, "");
      // 使用 ApiKeyManager 获取当前活动密钥
      common.apiKey = ApiKeyManager.getCurrentKey(keyManagerId);
      common.model = (
        (getPref("geminiModel" as any) as string) || "gemini-2.5-pro"
      ).trim();
    } else if (id.includes("anthropic") || id.includes("claude")) {
      common.apiUrl = (
        (getPref("anthropicApiUrl" as any) as string) ||
        "https://api.anthropic.com"
      ).replace(/\/$/, "");
      common.apiKey = ApiKeyManager.getCurrentKey(keyManagerId);
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
      common.apiKey = ApiKeyManager.getCurrentKey(keyManagerId);
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
      common.apiKey = ApiKeyManager.getCurrentKey(keyManagerId);
      common.model = (
        (getPref("openRouterModel" as any) as string) || "google/gemma-3-27b-it"
      ).trim();
    } else if (id === "volcanoark") {
      common.apiUrl = (
        (getPref("volcanoArkApiUrl" as any) as string) ||
        "https://ark.cn-beijing.volces.com/api/v3/responses"
      ).trim();
      common.apiKey = ApiKeyManager.getCurrentKey(keyManagerId);
      common.model = (
        (getPref("volcanoArkModel" as any) as string) ||
        "doubao-seed-1-8-251228"
      ).trim();
    } else {
      common.apiUrl = ((getPref("openaiApiUrl" as any) as string) || "").trim();
      common.apiKey = ApiKeyManager.getCurrentKey(keyManagerId);
      common.model = (
        (getPref("openaiApiModel" as any) as string) || "gpt-3.5-turbo"
      ).trim();
    }
    return { ...common, ...(extra || {}) };
  }

  /**
   * 映射 provider ID 到 ApiKeyManager 的 ProviderId
   */
  private static mapToKeyManagerId(providerId: string): ProviderId {
    const id = providerId.toLowerCase();
    if (id.includes("gemini") || id === "google") return "google";
    if (id.includes("anthropic") || id.includes("claude")) return "anthropic";
    if (id === "openai-compat") return "openai-compat";
    if (id === "openrouter") return "openrouter";
    if (id === "volcanoark") return "volcanoark";
    return "openai";
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

  /**
   * 获取当前 Provider 实例
   *
   * 用于检查 Provider 是否支持特定功能（如多文件上传）
   */
  static getCurrentProvider(): any | null {
    try {
      const { impl } = LLMClient.resolveProvider();
      return impl;
    } catch {
      return null;
    }
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

  /**
   * 多文件摘要生成
   *
   * 调用 provider 的 generateMultiFileSummary 方法处理多个 PDF
   * 仅当 provider 支持此方法时可用
   */
  static async generateMultiFileSummary(
    pdfFiles: Array<{
      filePath: string;
      displayName: string;
      base64Content?: string;
    }>,
    prompt?: string,
    onProgress?: ProgressCb,
  ): Promise<string> {
    const { id, impl } = this.resolveProvider();
    const options = this.buildOptions(id);

    // 使用与 generateSummary 相同的 prompt 解析逻辑
    const saved = (getPref("summaryPrompt") as string) || "";
    const summaryPrompt =
      prompt || (saved.trim() ? saved : getDefaultSummaryPrompt());

    if (typeof impl.generateMultiFileSummary !== "function") {
      throw new Error(`Provider ${id} 不支持多文件摘要生成`);
    }

    return impl.generateMultiFileSummary(
      pdfFiles,
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

  /**
   * 获取当前 LLM 选项（用于直接调用 provider 方法）
   */
  static getLLMOptions(): LLMOptions {
    const { id } = this.resolveProvider();
    return this.buildOptions(id);
  }

  /**
   * 测试指定密钥的连接（用于多密钥测试UI）
   *
   * @param apiKey 要测试的密钥
   */
  static async testConnectionWithKey(apiKey: string): Promise<string> {
    const { id, impl } = this.resolveProvider();
    const options = this.buildOptions(id, { stream: false });
    options.apiKey = apiKey;
    return impl.testConnection(options);
  }

  /**
   * 带自动轮换的生成摘要方法
   * 遇到 API 错误时自动切换到下一个可用密钥
   */
  static async generateSummaryWithRetry(
    content: string,
    isBase64 = false,
    prompt?: string,
    onProgress?: ProgressCb,
  ): Promise<string> {
    const { id } = this.resolveProvider();
    const keyManagerId = this.mapToKeyManagerId(id);
    const maxRetries = ApiKeyManager.getMaxSwitchCount();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await this.generateSummary(
          content,
          isBase64,
          prompt,
          onProgress,
        );
        // 成功后轮换到下一个密钥（等权重轮换）
        ApiKeyManager.advanceToNextKey(keyManagerId);
        return result;
      } catch (error: any) {
        lastError = error;
        ztoolkit.log(
          `[LLMClient] API 调用失败 (尝试 ${attempt + 1}/${maxRetries}): ${error?.message || error}`,
        );

        // 尝试轮换到下一个密钥
        const rotated = ApiKeyManager.rotateToNextKey(keyManagerId);
        if (!rotated) {
          ztoolkit.log(`[LLMClient] 无更多可用密钥，停止重试`);
          break;
        }
      }
    }

    throw lastError || new Error("所有 API 密钥均已耗尽");
  }

  /**
   * 带自动轮换的聊天方法
   * 遇到 API 错误时自动切换到下一个可用密钥
   */
  static async chatWithRetry(
    pdfContent: string,
    isBase64: boolean,
    conversation: Array<{ role: string; content: string }>,
    onProgress?: ProgressCb,
  ): Promise<string> {
    const { id } = this.resolveProvider();
    const keyManagerId = this.mapToKeyManagerId(id);
    const maxRetries = ApiKeyManager.getMaxSwitchCount();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await this.chat(
          pdfContent,
          isBase64,
          conversation,
          onProgress,
        );
        // 成功后轮换到下一个密钥（等权重轮换）
        ApiKeyManager.advanceToNextKey(keyManagerId);
        return result;
      } catch (error: any) {
        lastError = error;
        ztoolkit.log(
          `[LLMClient] Chat API 调用失败 (尝试 ${attempt + 1}/${maxRetries}): ${error?.message || error}`,
        );

        // 尝试轮换到下一个密钥
        const rotated = ApiKeyManager.rotateToNextKey(keyManagerId);
        if (!rotated) {
          ztoolkit.log(`[LLMClient] 无更多可用密钥，停止重试`);
          break;
        }
      }
    }

    throw lastError || new Error("所有 API 密钥均已耗尽");
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
