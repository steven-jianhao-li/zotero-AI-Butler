import { SYSTEM_ROLE_PROMPT, buildUserMessage } from "../../utils/prompts";
import { ILlmProvider } from "./ILlmProvider";
import {
  formatConnectionTestSuccess,
  getConnectionTestInput,
} from "./shared/connectionTest";
import {
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
import { resolveReasoningEffort } from "./shared/reasoning";
import { throwIfAborted } from "./shared/requestAbort";
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
 * OpenAI 旧接口兼容 Provider（Chat Completions 格式）
 *
 * 使用 /v1/chat/completions 接口，适配第三方 API 服务商（例如 SiliconFlow 等）
 * 注意：如果使用 OpenAI 官方 API，请不要选择本接口，请改用 “OpenAI” 提供商（/v1/responses）。
 *
 * URL 要求：必须是完整的端点地址，例如：
 *   https://api.openai.com/v1/chat/completions
 * 不会在代码中自动追加路径。
 */
export class OpenAICompatProvider implements ILlmProvider {
  readonly id: string = "openai-compat"; // 供偏好使用的唯一标识
  /** 子类可覆盖为厂商自己的 Chat Completions 默认端点。 */
  protected readonly defaultChatCompletionsUrl: string =
    "https://api.openai.com/v1/chat/completions";
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

  /** 解析并校验端点地址与密钥；子类可覆盖地址默认值。 */
  protected ensureUrlAndKey(options: LLMOptions) {
    const rawApiUrl = (options.apiUrl || this.defaultChatCompletionsUrl).trim();
    const apiUrl = this.normalizeChatCompletionsUrl(rawApiUrl);
    const apiKey = (options.apiKey || "").trim();
    if (!apiUrl) throw new Error(providerMissingApiUrl());
    if (!apiKey) throw new Error(providerMissingApiKey());
    return { apiUrl, apiKey };
  }

  /** 子类可覆盖地址归一化规则（例如固定网关路径）。 */
  protected normalizeChatCompletionsUrl(apiUrl: string): string {
    const raw = apiUrl.trim().replace(/\/+$/, "");
    if (!raw) return raw;
    if (/\/(?:v\d+(?:beta)?\/)?chat\/completions$/i.test(raw)) return raw;
    if (/\/v\d+(?:beta)?$/i.test(raw)) return `${raw}/chat/completions`;
    if (/\/v\d+(?:beta)?\/.+$/i.test(raw)) {
      return raw.replace(/(\/v\d+(?:beta)?)(?:\/.*)?$/i, "$1/chat/completions");
    }
    return `${raw}/v1/chat/completions`;
  }

  protected buildHeaders(
    apiKey: string,
    customHeaders?: Record<string, string>,
  ) {
    return mergeRequestHeaders(
      {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      customHeaders,
    );
  }

  protected buildGenParams(options: LLMOptions) {
    const params: any = {};
    if (options.temperature !== undefined)
      params.temperature = options.temperature;
    if (options.topP !== undefined) params.top_p = options.topP;
    if (options.maxTokens !== undefined) params.max_tokens = options.maxTokens;
    const reasoningEffort = resolveReasoningEffort(options.reasoningEffort);
    if (reasoningEffort) params.reasoning_effort = reasoningEffort;
    return params;
  }

  private buildPdfFilePart(base64Content: string, filename = "document.pdf") {
    const normalized = base64Content
      .trim()
      .replace(/^data:application\/pdf;base64,/i, "");
    const safeFilename = filename.trim() || "document.pdf";

    return {
      type: "file",
      file: {
        filename: /\.pdf$/i.test(safeFilename)
          ? safeFilename
          : `${safeFilename}.pdf`,
        file_data: `data:application/pdf;base64,${normalized}`,
      },
    };
  }

  async generateSummary(
    content: string,
    isBase64: boolean,
    prompt: string | undefined,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<LLMProviderResult> {
    const { apiUrl, apiKey } = this.ensureUrlAndKey(options);
    const model = (options.model || "gpt-3.5-turbo").trim();
    throwIfAborted(options.abortSignal);

    // Chat Completions 的消息结构
    const messages: Array<{
      role: "system" | "user" | "assistant";
      content: any;
    }> = [];
    messages.push({ role: "system", content: SYSTEM_ROLE_PROMPT });

    if (isBase64) {
      // Chat Completions 文件部件格式；PDF 用 application/pdf data URL。
      messages.push({
        role: "user",
        content: [
          { type: "text", text: prompt || "请分析这个文档。" },
          this.buildPdfFilePart(content, "paper.pdf"),
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

    return requestLLMText({
      protocol: "chat",
      provider: this.id,
      url: apiUrl,
      headers: this.buildHeaders(apiKey, options.customHeaders),
      payload: basePayload,
      options,
      onProgress,
    });
  }

  async chat(
    pdfContent: string,
    isBase64: boolean,
    conversation: ConversationMessage[],
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<LLMProviderResult> {
    const { apiUrl, apiKey } = this.ensureUrlAndKey(options);
    const model = (options.model || "gpt-3.5-turbo").trim();

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
          // 第一条用户消息需要附带论文内容
          if (isBase64) {
            messages.push({
              role: "user",
              content: [
                { type: "text", text: msg.content },
                this.buildPdfFilePart(pdfContent, "paper.pdf"),
              ],
            });
          } else {
            // 文本模式：将论文内容附加到消息中
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

    return requestLLMText({
      protocol: "chat",
      provider: this.id,
      url: apiUrl,
      headers: this.buildHeaders(apiKey, options.customHeaders),
      payload: payload,
      options,
      onProgress,
    });
  }

  async listModels(options: LLMOptions): Promise<LLMModelInfo[]> {
    const { apiUrl, apiKey } = this.ensureUrlAndKey(options);
    const url = deriveVersionedModelsUrl(
      apiUrl,
      this.defaultChatCompletionsUrl,
    );
    const data = await requestModelListJson(
      url,
      this.buildHeaders(apiKey, options.customHeaders),
      options.requestTimeoutMs ?? 30000,
    );
    return parseModelListResponse(data);
  }

  async testConnection(options: LLMOptions): Promise<string> {
    const { apiUrl, apiKey } = this.ensureUrlAndKey(options);
    const model = (options.model || "gpt-3.5-turbo").trim();
    const testInput = getConnectionTestInput(options);
    const userContent = testInput.isBase64
      ? [
          { type: "text", text: testInput.text },
          this.buildPdfFilePart(
            testInput.pdfBase64 || "",
            "connection-test.pdf",
          ),
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

    let response: any;
    const responseHeaders: Record<string, string> = {};
    try {
      response = await Zotero.HTTP.request("POST", apiUrl, {
        headers: this.buildHeaders(apiKey, options.customHeaders),
        body: JSON.stringify(payload),
        errorDelayMax: 0,
        responseType: "text", // 使用 text 以获取原始响应
        timeout: options.requestTimeoutMs ?? 30000,
      });
      // 提取响应首部
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
      // 提取响应首部
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
      let errorMessage =
        error?.message || providerRequestFailed("OpenAI Compatible");
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
      errorMessage: `HTTP ${status}: ${response.statusText || providerRequestFailed("API")}`,
      statusCode: status,
      requestUrl: apiUrl,
      requestBody: payloadStr,
      responseHeaders,
      responseBody: rawResponse,
    });
  }

  /**
   * 多文件摘要生成
   * 使用 OpenAI 兼容 Chat Completions 格式发送多个 PDF 文件
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
    const model = (options.model || "gpt-3.5-turbo").trim();
    throwIfAborted(options.abortSignal);

    if (pdfFiles.length === 0) throw new Error(providerNoPdfFiles());

    // 构建 Chat Completions file 部分（使用 PDF data URI）
    const fileParts: any[] = [];
    for (let i = 0; i < pdfFiles.length; i++) {
      const pdfFile = pdfFiles[i];
      if (pdfFile.base64Content && pdfFile.base64Content.length > 0) {
        fileParts.push(
          this.buildPdfFilePart(
            pdfFile.base64Content,
            pdfFile.displayName || `document_${i + 1}.pdf`,
          ),
        );
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
      `[AI-Butler] 准备发送 ${fileParts.length} 个 PDF 附件到 OpenAI 兼容接口`,
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
    return requestLLMText({
      protocol: "chat",
      provider: this.id,
      url: apiUrl,
      headers: this.buildHeaders(apiKey, options.customHeaders),
      payload: payload,
      options,
      onProgress,
    });
  }
}

// 自注册
import { ProviderRegistry } from "./ProviderRegistry";
ProviderRegistry.register(new OpenAICompatProvider());

export default OpenAICompatProvider;
