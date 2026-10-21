import { SYSTEM_ROLE_PROMPT, buildUserMessage } from "../../utils/prompts";
import { ILlmProvider } from "./ILlmProvider";
import {
  formatConnectionTestSuccess,
  getConnectionTestInput,
} from "./shared/connectionTest";
import {
  providerHttpRequestFailed,
  providerMissingApiKey,
  providerMissingApiUrl,
  providerNoPdfFiles,
  providerNoPdfProcessed,
  providerRequestFailed,
} from "./shared/localizedErrors";
import {
  deriveVersionedModelsUrl,
  parseModelListResponse,
  requestModelListJson,
} from "./shared/modelList";
import { resolveOpenRouterReasoningEffort } from "./shared/reasoning";
import { mergeRequestHeaders } from "./shared/requestHeaders";
import { requestLLMText } from "./shared/textTransport";
import type { LLMProviderResult } from "./types";
import {
  ConversationMessage,
  LLMModelInfo,
  LLMOptions,
  LLMProviderCapabilities,
  ProgressCb,
} from "./types";

/**
 * OpenRouter Provider
 *
 * Documentation: https://openrouter.ai/docs/guides/overview/multimodal/pdfs#using-base64-encoded-pdfs
 */
export class OpenRouterProvider implements ILlmProvider {
  readonly id = "openrouter";
  readonly capabilities: LLMProviderCapabilities = {
    supportsText: true,
    supportsStreaming: true,
    supportsPdfBase64: true,
    maxPdfFiles: 20,
    supportsSystemPrompt: true,
    supportedParams: [
      "temperature",
      "topP",
      "maxTokens",
      "stream",
      "reasoningEffort",
    ],
  };

  private ensureUrlAndKey(options: LLMOptions) {
    const rawApiUrl = (
      options.apiUrl || "https://openrouter.ai/api/v1/chat/completions"
    ).trim();
    const apiUrl = this.normalizeChatCompletionsUrl(rawApiUrl);
    const apiKey = (options.apiKey || "").trim();
    if (!apiUrl) throw new Error(providerMissingApiUrl());
    if (!apiKey) throw new Error(providerMissingApiKey());
    return { apiUrl, apiKey };
  }

  private normalizeChatCompletionsUrl(apiUrl: string): string {
    const raw = apiUrl.trim().replace(/\/+$/, "");
    if (!raw) return raw;
    if (/\/(?:v\d+(?:beta)?\/)?chat\/completions$/i.test(raw)) return raw;
    if (/\/v\d+(?:beta)?$/i.test(raw)) return `${raw}/chat/completions`;
    if (/\/v\d+(?:beta)?\/.+$/i.test(raw)) {
      return raw.replace(/(\/v\d+(?:beta)?)(?:\/.*)?$/i, "$1/chat/completions");
    }
    return `${raw}/v1/chat/completions`;
  }

  private buildHeaders(apiKey: string, customHeaders?: Record<string, string>) {
    return mergeRequestHeaders(
      {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://github.com/steven-jianhao-li/zotero-AI-Butler", // Required by OpenRouter for rankings
        "X-Title": "Zotero AI Butler", // Optional
      },
      customHeaders,
    );
  }

  private buildGenParams(options: LLMOptions) {
    const params: any = {};
    if (options.temperature !== undefined)
      params.temperature = options.temperature;
    if (options.topP !== undefined) params.top_p = options.topP;
    if (options.maxTokens !== undefined) params.max_tokens = options.maxTokens;
    const reasoningEffort = resolveOpenRouterReasoningEffort(
      options.reasoningEffort,
    );
    if (reasoningEffort) params.reasoning = { effort: reasoningEffort };
    return params;
  }

  async generateSummary(
    content: string,
    isBase64: boolean,
    prompt: string | undefined,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<LLMProviderResult> {
    const { apiUrl, apiKey } = this.ensureUrlAndKey(options);
    const model = (options.model || "google/gemma-3-27b-it").trim();
    const streamEnabled = options.stream ?? true;

    const messages: Array<{
      role: "system" | "user" | "assistant";
      content: any;
    }> = [];
    messages.push({ role: "system", content: SYSTEM_ROLE_PROMPT });

    if (isBase64) {
      // OpenRouter PDF Specific Format
      // https://openrouter.ai/docs/guides/overview/multimodal/pdfs#using-base64-encoded-pdfs
      messages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: prompt || "Please analyze this document.",
          },
          {
            type: "file",
            file: {
              filename: "document.pdf",
              file_data: content, // base64 string
            },
          },
        ],
      });
    } else {
      const userText = buildUserMessage(prompt || "", content);
      messages.push({ role: "user", content: userText });
    }

    const basePayload: any = {
      model,
      messages,
      ...this.buildGenParams(options),
    };

    if (streamEnabled && onProgress) {
      return this.streamRequest(
        apiUrl,
        apiKey,
        basePayload,
        options,
        onProgress,
      );
    } else {
      return this.nonStreamRequest(
        apiUrl,
        apiKey,
        basePayload,
        options,
        onProgress,
      );
    }
  }

  async chat(
    pdfContent: string,
    isBase64: boolean,
    conversation: ConversationMessage[],
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<LLMProviderResult> {
    const { apiUrl, apiKey } = this.ensureUrlAndKey(options);
    const model = (options.model || "google/gemma-3-27b-it").trim();

    const messages: Array<{
      role: "system" | "user" | "assistant";
      content: any;
    }> = [{ role: "system", content: SYSTEM_ROLE_PROMPT }];

    if (conversation && conversation.length > 0) {
      for (const msg of conversation) {
        let role: "system" | "user" | "assistant" = msg.role as any;
        if (role !== "system" && role !== "user" && role !== "assistant") {
          role = "user";
        }
        const isFirstUserMessage = role === "user" && msg === conversation[0];
        if (isFirstUserMessage) {
          if (isBase64) {
            messages.push({
              role: "user",
              content: [
                { type: "text", text: msg.content },
                {
                  type: "file",
                  file: {
                    filename: "document.pdf",
                    file_data: pdfContent,
                  },
                },
              ],
            });
          } else {
            messages.push({
              role: "user",
              content: buildUserMessage(msg.content, pdfContent),
            });
          }
        } else {
          messages.push({ role, content: msg.content });
        }
      }
    }

    const payload = {
      model,
      messages,
      stream: true,
      ...this.buildGenParams(options),
    } as any;

    return this.streamRequest(apiUrl, apiKey, payload, options, onProgress);
  }

  async testConnection(options: LLMOptions): Promise<string> {
    const { apiUrl, apiKey } = this.ensureUrlAndKey(options);
    const model = (options.model || "google/gemma-3-27b-it").trim();
    const testInput = getConnectionTestInput(options);
    const userContent = testInput.isBase64
      ? [
          { type: "text", text: testInput.text },
          {
            type: "file",
            file: {
              filename: "connection-test.pdf",
              file_data: testInput.pdfBase64 || "",
            },
          },
        ]
      : testInput.text;

    const payload = {
      model,
      stream: false,
      messages: [
        { role: "system", content: SYSTEM_ROLE_PROMPT },
        {
          role: "user",
          content: userContent,
        },
      ],
      ...this.buildGenParams(options),
    } as any;
    const payloadStr = JSON.stringify(payload, null, 2);

    const responseHeaders: Record<string, string> = {};
    let response: any;

    try {
      response = await Zotero.HTTP.request("POST", apiUrl, {
        headers: this.buildHeaders(apiKey, options.customHeaders),
        body: JSON.stringify(payload),
        responseType: "text",
        timeout: options.requestTimeoutMs ?? 30000,
        errorDelayMax: 0,
      });

      // Extract headers
      try {
        const headerStr = response.getAllResponseHeaders?.() || "";
        headerStr.split(/\r?\n/).forEach((line: string) => {
          const idx = line.indexOf(":");
          if (idx > 0) {
            responseHeaders[line.slice(0, idx).trim().toLowerCase()] = line
              .slice(idx + 1)
              .trim();
          }
        });
      } catch {
        /* ignore */
      }
    } catch (error: any) {
      // Extract headers from error if possible
      try {
        const headerStr = error?.xmlhttp?.getAllResponseHeaders?.() || "";
        headerStr.split(/\r?\n/).forEach((line: string) => {
          const idx = line.indexOf(":");
          if (idx > 0) {
            responseHeaders[line.slice(0, idx).trim().toLowerCase()] = line
              .slice(idx + 1)
              .trim();
          }
        });
      } catch {
        /* ignore */
      }

      const status = error?.xmlhttp?.status;
      const responseBody =
        error?.xmlhttp?.response || error?.xmlhttp?.responseText || "";
      let errorMessage = error?.message || providerRequestFailed("OpenRouter");
      let errorName = "NetworkError";

      try {
        if (responseBody) {
          const parsed =
            typeof responseBody === "string"
              ? JSON.parse(responseBody)
              : responseBody;
          const err = parsed?.error || parsed;
          errorName = err?.code || err?.type || "APIError";
          errorMessage = err?.message || errorMessage;
        }
      } catch {
        /* ignore */
      }

      const { APITestError } = await import("./types");
      throw new APITestError(errorMessage, {
        errorName,
        errorMessage,
        statusCode: status,
        requestUrl: apiUrl,
        requestBody: payloadStr,
        responseHeaders,
        responseBody:
          typeof responseBody === "string"
            ? responseBody
            : JSON.stringify(responseBody),
      });
    }

    const status = response.status;
    const rawResponse = response.response || "";

    if (status === 200) {
      const json =
        typeof rawResponse === "string" ? JSON.parse(rawResponse) : rawResponse;
      const content = json?.choices?.[0]?.message?.content || "";
      return formatConnectionTestSuccess({
        mode: testInput.mode,
        model,
        response: content,
        rawResponse,
      });
    }

    const { APITestError } = await import("./types");
    throw new APITestError(`HTTP ${status}`, {
      errorName: `HTTP_${status}`,
      errorMessage: response.statusText
        ? `HTTP ${status}: ${response.statusText}`
        : providerHttpRequestFailed(status),
      statusCode: status,
      requestUrl: apiUrl,
      requestBody: payloadStr,
      responseHeaders,
      responseBody: rawResponse,
    });
  }

  async listModels(options: LLMOptions): Promise<LLMModelInfo[]> {
    const { apiUrl, apiKey } = this.ensureUrlAndKey(options);
    const url = deriveVersionedModelsUrl(
      apiUrl,
      "https://openrouter.ai/api/v1/chat/completions",
    );
    const data = await requestModelListJson(
      url,
      this.buildHeaders(apiKey, options.customHeaders),
      options.requestTimeoutMs ?? 30000,
    );
    return parseModelListResponse(data);
  }

  // --- Helpers ---

  private async streamRequest(
    apiUrl: string,
    apiKey: string,
    payload: any,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<LLMProviderResult> {
    return requestLLMText({
      protocol: "chat",
      provider: this.id,
      url: apiUrl,
      headers: this.buildHeaders(apiKey, options.customHeaders),
      payload,
      options,
      onProgress,
    });
  }

  private async nonStreamRequest(
    apiUrl: string,
    apiKey: string,
    payload: any,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<LLMProviderResult> {
    return requestLLMText({
      protocol: "chat",
      provider: this.id,
      url: apiUrl,
      headers: this.buildHeaders(apiKey, options.customHeaders),
      payload,
      options,
      onProgress,
    });
  }

  /**
   * 多文件摘要生成
   * 使用 OpenRouter API 发送多个 file 类型的 PDF 文件
   */
  async generateMultiFileSummary(
    pdfFiles: Array<{
      filePath: string;
      displayName: string;
      base64Content?: string;
    }>,
    prompt: string,
    options: LLMOptions,
    onProgress?: ProgressCb,
    history: ConversationMessage[] = [],
  ): Promise<LLMProviderResult> {
    const { apiUrl, apiKey } = this.ensureUrlAndKey(options);
    const model = (options.model || "google/gemma-3-27b-it").trim();

    if (pdfFiles.length === 0) throw new Error(providerNoPdfFiles());

    // 构建 file 部分
    const fileParts: any[] = [];
    for (let i = 0; i < pdfFiles.length; i++) {
      const pdfFile = pdfFiles[i];
      if (pdfFile.base64Content && pdfFile.base64Content.length > 0) {
        fileParts.push({
          type: "file",
          file: {
            filename: pdfFile.displayName || `document_${i + 1}.pdf`,
            file_data: pdfFile.base64Content,
          },
        });
        ztoolkit.log(
          `[AI-Butler] 添加 PDF 附件 (${i + 1}/${pdfFiles.length}): ${pdfFile.displayName}, base64 长度: ${pdfFile.base64Content.length}`,
        );
      } else {
        ztoolkit.log(
          `[AI-Butler] PDF 文件 ${pdfFile.displayName} 无 base64 内容，跳过`,
        );
      }
    }

    if (fileParts.length === 0) {
      throw new Error(providerNoPdfProcessed());
    }

    ztoolkit.log(
      `[AI-Butler] 准备发送 ${fileParts.length} 个 PDF 附件到 OpenRouter`,
    );

    const messages: Array<{
      role: "system" | "user" | "assistant";
      content: any;
    }> = [];
    messages.push({ role: "system", content: SYSTEM_ROLE_PROMPT });
    messages.push({
      role: "user",
      content: [{ type: "text", text: prompt }, ...fileParts],
    });

    const payload = {
      model,
      messages,
      stream: true,
      ...this.buildGenParams(options),
    } as any;

    payload.messages.push(...history);
    return this.streamRequest(apiUrl, apiKey, payload, options, onProgress);
  }
}

// Self-registration
import { ProviderRegistry } from "./ProviderRegistry";
ProviderRegistry.register(new OpenRouterProvider());

export default OpenRouterProvider;
