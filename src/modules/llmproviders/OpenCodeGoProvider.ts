import { getString } from "../../utils/locale";
import { OpenAICompatProvider } from "./OpenAICompatProvider";
import { openCodeGoModelsForFamily } from "./openCodeGoModels";
import { ProviderRegistry } from "./ProviderRegistry";
import {
  deriveVersionedModelsUrl,
  parseModelListResponse,
  requestModelListJson,
} from "./shared/modelList";
import {
  buildOpenCodeGoHeaders,
  classifyOpenCodeGoError,
  OPENCODE_GO_DEFAULT_CHAT_URL,
  resolveOpenCodeGoChatUrl,
  type OpenCodeGoErrorKind,
} from "./shared/openCodeGo";
import type { PdfFileInfo } from "./ILlmProvider";
import type {
  ConversationMessage,
  LLMModelInfo,
  LLMOptions,
  LLMProviderCapabilities,
  LLMProviderResult,
  ProgressCb,
} from "./types";

/**
 * OpenCode Go 原生 Provider。
 *
 * OpenCode Go 使用 OpenAI Chat Completions 协议，但有三点差异需要在这里适配：
 * 1. 端点是 Console 网关 `https://opencode.ai/inference/go/openai/v1/chat/completions`；
 * 2. 每个请求必须带稳定的 `x-opencode-session`，并建议携带客户端自己的 UA；
 * 3. 网关不提供 `/models`（实测 404），模型列表使用内置目录。
 *
 * 该订阅计划只提供文本/推理模型，不支持 PDF 直传，因此声明
 * `supportsPdfBase64: false`：统一中间层会自动改用文本提取，
 * 若仍有 base64 内容直接进入 Provider（旧接口路径），则给出明确提示。
 */
export class OpenCodeGoProvider extends OpenAICompatProvider {
  readonly id: string = "opencode-go";
  protected readonly defaultChatCompletionsUrl = OPENCODE_GO_DEFAULT_CHAT_URL;
  readonly capabilities: LLMProviderCapabilities = {
    supportsText: true,
    supportsStreaming: true,
    supportsPdfBase64: false,
    maxPdfFiles: 1,
    supportsSystemPrompt: true,
    supportedParams: [
      "temperature",
      "topP",
      "maxTokens",
      "stream",
      "reasoningEffort",
    ],
  };

  protected normalizeChatCompletionsUrl(apiUrl: string): string {
    return resolveOpenCodeGoChatUrl(apiUrl);
  }

  protected buildHeaders(
    apiKey: string,
    customHeaders?: Record<string, string>,
  ) {
    return buildOpenCodeGoHeaders(apiKey, customHeaders);
  }

  /**
   * Go 网关目前没有公开 `/models`（实测 404）。先按 OpenAI 兼容规则尝试，
   * 失败或返回空列表时回退到内置目录，保证端点面板始终有可选模型。
   */
  async listModels(options: LLMOptions): Promise<LLMModelInfo[]> {
    const apiKey = (options.apiKey || "").trim();
    const apiUrl = resolveOpenCodeGoChatUrl(options.apiUrl);
    if (apiKey) {
      try {
        const url = deriveVersionedModelsUrl(
          apiUrl,
          OPENCODE_GO_DEFAULT_CHAT_URL,
        );
        const data = await requestModelListJson(
          url,
          this.buildHeaders(apiKey, options.customHeaders),
          options.requestTimeoutMs ?? 30000,
        );
        const models = parseModelListResponse(data);
        if (models.length > 0) return models;
      } catch (error) {
        ztoolkit.log(
          "[AI-Butler] OpenCode Go /models unavailable; using built-in catalog.",
          error,
        );
      }
    }
    return openCodeGoModelsForFamily("chat");
  }

  async generateSummary(
    content: string,
    isBase64: boolean,
    prompt: string | undefined,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<LLMProviderResult> {
    this.assertTextOnly(isBase64);
    try {
      return await super.generateSummary(
        content,
        isBase64,
        prompt,
        options,
        onProgress,
      );
    } catch (error: unknown) {
      throw this.localizeError(error);
    }
  }

  async chat(
    pdfContent: string,
    isBase64: boolean,
    conversation: ConversationMessage[],
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<LLMProviderResult> {
    this.assertTextOnly(isBase64);
    try {
      return await super.chat(
        pdfContent,
        isBase64,
        conversation,
        options,
        onProgress,
      );
    } catch (error: unknown) {
      throw this.localizeError(error);
    }
  }

  async generateMultiFileSummary(
    _pdfFiles: PdfFileInfo[],
    _prompt: string,
    _options: LLMOptions,
    _onProgress?: ProgressCb,
    _history?: ConversationMessage[],
  ): Promise<LLMProviderResult> {
    throw new Error(getString("provider-error-opencode-go-pdf-text-only"));
  }

  async testConnection(options: LLMOptions): Promise<string> {
    try {
      return await super.testConnection(options);
    } catch (error: unknown) {
      throw this.localizeError(error);
    }
  }

  private assertTextOnly(isBase64: boolean): void {
    if (isBase64)
      throw new Error(getString("provider-error-opencode-go-pdf-text-only"));
  }

  private localizeError(error: unknown): Error {
    const kind = classifyOpenCodeGoError(error);
    const original =
      error instanceof Error ? error : new Error(String(error || ""));
    if (kind === "unknown") return original;
    const localized = new Error(
      `${this.localizedHint(kind)}\n${original.message}`,
    );
    localized.name = original.name;
    const diagnostics = (original as Error & { requestDiagnostics?: unknown })
      .requestDiagnostics;
    if (diagnostics) {
      (
        localized as Error & { requestDiagnostics?: unknown }
      ).requestDiagnostics = diagnostics;
    }
    return localized;
  }

  private localizedHint(kind: OpenCodeGoErrorKind): string {
    if (kind === "unauthorized")
      return getString("provider-error-opencode-go-unauthorized");
    if (kind === "forbidden")
      return getString("provider-error-opencode-go-forbidden");
    return getString("provider-error-opencode-go-usage-limit");
  }
}

// 自注册
ProviderRegistry.register(new OpenCodeGoProvider());

export default OpenCodeGoProvider;
