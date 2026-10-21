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
  deriveAnthropicModelsUrl,
  parseModelListResponse,
  requestModelListJson,
} from "./shared/modelList";
import { getAnthropicMaxTokens } from "./shared/outputTokens";
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

export function shouldOmitAnthropicTemperature(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  if (!/claude[-_/]opus[-_/]4/.test(normalized)) return false;
  if (/(^|[-_/])latest($|[-_/])/.test(normalized)) return true;

  const opus4Minor = normalized.match(/claude[-_/]opus[-_/]4[-_/.](\d+)/);
  if (!opus4Minor) return false;

  return Number(opus4Minor[1]) >= 7;
}

export {
  DEFAULT_ANTHROPIC_MAX_TOKENS,
  resolveAnthropicMaxTokens,
} from "./shared/outputTokens";

function buildAnthropicTemperatureParam(
  model: string,
  options: LLMOptions,
): { temperature?: number } {
  if (options.temperature === undefined) return {};
  if (shouldOmitAnthropicTemperature(model)) return {};
  return { temperature: options.temperature };
}

export class AnthropicProvider implements ILlmProvider {
  readonly id = "anthropic";
  readonly capabilities: LLMProviderCapabilities = {
    supportsText: true,
    supportsStreaming: true,
    supportsPdfBase64: true,
    maxPdfFiles: 20,
    supportsSystemPrompt: true,
    supportedParams: ["temperature", "maxTokens", "stream"],
  };

  async generateSummary(
    content: string,
    isBase64: boolean,
    prompt: string | undefined,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<LLMProviderResult> {
    const baseUrl = (options.apiUrl || "https://api.anthropic.com").replace(
      /\/$/,
      "",
    );
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "claude-3-5-sonnet-20241022").trim();
    const maxTokens = await getAnthropicMaxTokens(options);

    if (!baseUrl) throw new Error(providerMissingApiUrl("Anthropic"));
    if (!apiKey) throw new Error(providerMissingApiKey("Anthropic"));
    throwIfAborted(options.abortSignal);

    const endpoint = `${baseUrl}/v1/messages`;

    let payload: any;
    if (isBase64) {
      payload = {
        model,
        max_tokens: maxTokens,
        ...buildAnthropicTemperatureParam(model, options),
        system: SYSTEM_ROLE_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt || "" },
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: content,
                },
              },
            ],
          },
        ],
        stream: true,
      };
    } else {
      const userContent = buildUserMessage(prompt || "", content);
      payload = {
        model,
        max_tokens: maxTokens,
        ...buildAnthropicTemperatureParam(model, options),
        system: SYSTEM_ROLE_PROMPT,
        messages: [
          { role: "user", content: [{ type: "text", text: userContent }] },
        ],
        stream: true,
      };
    }

    return requestLLMText({
      protocol: "anthropic",
      provider: this.id,
      url: endpoint,
      headers: mergeRequestHeaders(
        {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        options.customHeaders,
      ),
      payload: payload,
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
    const baseUrl = (options.apiUrl || "https://api.anthropic.com").replace(
      /\/$/,
      "",
    );
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "claude-3-5-sonnet-20241022").trim();
    const maxTokens = await getAnthropicMaxTokens(options);

    if (!baseUrl) throw new Error(providerMissingApiUrl("Anthropic"));
    if (!apiKey) throw new Error(providerMissingApiKey("Anthropic"));
    throwIfAborted(options.abortSignal);

    const endpoint = `${baseUrl}/v1/messages`;

    const messages: any[] = [];
    if (conversation && conversation.length > 0) {
      const firstUserMsg = conversation[0];
      if (isBase64) {
        messages.push({
          role: "user",
          content: [
            { type: "text", text: firstUserMsg.content },
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: pdfContent,
              },
            },
          ],
        });
      } else {
        messages.push({
          role: "user",
          content: [
            {
              type: "text",
              text: buildUserMessage(firstUserMsg.content, pdfContent || ""),
            },
          ],
        });
      }
      if (conversation.length > 1)
        messages.push({ role: "assistant", content: conversation[1].content });
      for (let i = 2; i < conversation.length; i++) {
        const msg = conversation[i];
        messages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        });
      }
    }

    if (options.enablePromptCache && messages.length > 0) {
      this.attachCacheBreakpoint(messages[0]);
      for (let i = messages.length - 1; i > 0; i--) {
        if (messages[i].role === "assistant") {
          this.attachCacheBreakpoint(messages[i]);
          break;
        }
      }
    }

    const payload: any = {
      model,
      max_tokens: maxTokens,
      ...buildAnthropicTemperatureParam(model, options),
      system: SYSTEM_ROLE_PROMPT,
      messages,
      stream: true,
    };

    return requestLLMText({
      protocol: "anthropic",
      provider: this.id,
      url: endpoint,
      headers: mergeRequestHeaders(
        {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        options.customHeaders,
      ),
      payload: payload,
      options,
      onProgress,
    });
  }

  /**
   * 在消息最后一个内容块标注 Anthropic prompt caching 断点。
   * 字符串 content 仅在开关开启时规范化为内容块数组，关闭路径保持原请求体不变。
   */
  private attachCacheBreakpoint(message: any): void {
    if (!message) return;
    if (typeof message.content === "string") {
      message.content = [{ type: "text", text: message.content }];
    }
    if (!Array.isArray(message.content) || message.content.length === 0) return;
    const last = message.content[message.content.length - 1];
    if (last && typeof last === "object") {
      last.cache_control = { type: "ephemeral" };
    }
  }

  async listModels(options: LLMOptions): Promise<LLMModelInfo[]> {
    const baseUrl = (options.apiUrl || "https://api.anthropic.com").replace(
      /\/+$/,
      "",
    );
    const apiKey = (options.apiKey || "").trim();
    if (!baseUrl) throw new Error(providerMissingApiUrl("Anthropic"));
    if (!apiKey) throw new Error(providerMissingApiKey("Anthropic"));

    const url = deriveAnthropicModelsUrl(baseUrl);
    const data = await requestModelListJson(
      url,
      {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      options.requestTimeoutMs ?? 30000,
      options.customHeaders,
    );
    return parseModelListResponse(data);
  }

  async testConnection(options: LLMOptions): Promise<string> {
    const baseUrl = (options.apiUrl || "https://api.anthropic.com").replace(
      /\/$/,
      "",
    );
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "claude-3-5-sonnet-20241022").trim();
    if (!baseUrl) throw new Error(providerMissingApiUrl("Anthropic"));
    if (!apiKey) throw new Error(providerMissingApiKey("Anthropic"));

    const url = `${baseUrl}/v1/messages`;
    const testInput = getConnectionTestInput(options);
    const userContent = testInput.isBase64
      ? [
          { type: "text", text: testInput.text },
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: testInput.pdfBase64 || "",
            },
          },
        ]
      : testInput.text;
    const payload = {
      model,
      max_tokens: 16,
      system: SYSTEM_ROLE_PROMPT,
      messages: [
        {
          role: "user",
          content: userContent,
        },
      ],
    } as any;
    const payloadStr = JSON.stringify(payload, null, 2);

    let response: any;
    const responseHeaders: Record<string, string> = {};
    try {
      response = await Zotero.HTTP.request("POST", url, {
        headers: mergeRequestHeaders(
          {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          options.customHeaders,
        ),
        body: JSON.stringify(payload),
        errorDelayMax: 0,
        responseType: "text", // 使用 text 以获取原始响应
        timeout: 30000,
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
      let errorMessage = error?.message || providerRequestFailed("Anthropic");
      let errorName = "NetworkError";
      try {
        if (responseBody) {
          const parsed =
            typeof responseBody === "string"
              ? JSON.parse(responseBody)
              : responseBody;
          const err = parsed?.error || parsed;
          errorName = err?.type || err?.code || "APIError";
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
        requestUrl: url,
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
      const text = json?.content?.[0]?.text || "";
      return formatConnectionTestSuccess({
        mode: testInput.mode,
        model,
        response: text,
        rawResponse,
      });
    }

    const { APITestError } = await import("./types");
    throw new APITestError(`HTTP ${status}`, {
      errorName: `HTTP_${status}`,
      errorMessage: `HTTP ${status}: ${response.statusText || providerRequestFailed("API")}`,
      statusCode: status,
      requestUrl: url,
      requestBody: payloadStr,
      responseHeaders,
      responseBody: rawResponse,
    });
  }

  /**
   * 多文件摘要生成
   * 使用 Anthropic Messages API 发送多个 document 类型的 PDF 文件
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
    const baseUrl = (options.apiUrl || "https://api.anthropic.com").replace(
      /\/$/,
      "",
    );
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "claude-3-5-sonnet-20241022").trim();
    const maxTokens = await getAnthropicMaxTokens(options);

    if (!baseUrl) throw new Error(providerMissingApiUrl("Anthropic"));
    if (!apiKey) throw new Error(providerMissingApiKey("Anthropic"));
    if (pdfFiles.length === 0) throw new Error(providerNoPdfFiles());
    throwIfAborted(options.abortSignal);

    // 构建 document 部分
    const documentParts: any[] = [];
    for (let i = 0; i < pdfFiles.length; i++) {
      const pdfFile = pdfFiles[i];
      if (pdfFile.base64Content && pdfFile.base64Content.length > 0) {
        documentParts.push({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: pdfFile.base64Content,
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

    if (documentParts.length === 0) {
      throw new Error(providerNoPdfProcessed());
    }

    ztoolkit.log(
      `[AI-Butler] 准备发送 ${documentParts.length} 个 PDF 附件到 Anthropic`,
    );

    const endpoint = `${baseUrl}/v1/messages`;

    const payload = {
      model,
      max_tokens: maxTokens,
      ...buildAnthropicTemperatureParam(model, options),
      system: SYSTEM_ROLE_PROMPT,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }, ...documentParts],
        },
      ],
      stream: true,
    };

    payload.messages.push(
      ...history.map((message) => ({
        role: message.role,
        content: [{ type: "text", text: message.content }],
      })),
    );
    return requestLLMText({
      protocol: "anthropic",
      provider: this.id,
      url: endpoint,
      headers: mergeRequestHeaders(
        {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        options.customHeaders,
      ),
      payload: payload,
      options,
      onProgress,
    });
  }
}

// 自注册
import { ProviderRegistry } from "./ProviderRegistry";
ProviderRegistry.register(new AnthropicProvider());

export default AnthropicProvider;
