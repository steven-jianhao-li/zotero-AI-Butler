import { ILlmProvider } from "./ILlmProvider";
import {
  APITestError,
  ConversationMessage,
  LLMModelInfo,
  LLMOptions,
  LLMProviderCapabilities,
  ProgressCb,
} from "./types";
import { SYSTEM_ROLE_PROMPT, buildUserMessage } from "../../utils/prompts";
import { getRequestTimeoutMs } from "./shared/llmutils";
import {
  getConnectionTestInput,
  getConnectionTestModeLabel,
} from "./shared/connectionTest";
import {
  parseModelListResponse,
  requestModelListJson,
} from "./shared/modelList";
import {
  bindAbortSignal,
  isAbortError,
  normalizeAbortError,
  throwIfAborted,
} from "./shared/requestAbort";

type OllamaChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OllamaConfig = {
  apiBaseUrl: string;
  chatUrl: string;
  tagsUrl: string;
  apiKey: string;
};

/**
 * Ollama provider using the native /api/chat endpoint.
 *
 * Ollama does not accept PDF file parts. When the upper layer sends PDF
 * Base64 content, surface a clear error and let the user switch the PDF mode.
 */
export class OllamaProvider implements ILlmProvider {
  readonly id = "ollama";
  readonly capabilities: LLMProviderCapabilities = {
    supportsText: true,
    supportsStreaming: true,
    supportsPdfBase64: false,
    maxPdfFiles: 1,
    supportsSystemPrompt: true,
    supportedParams: ["temperature", "topP", "maxTokens", "stream"],
  };

  private ensureConfig(options: LLMOptions): OllamaConfig {
    const apiBaseUrl = this.normalizeApiBaseUrl(
      options.apiUrl || "http://localhost:11434",
    );
    const apiKey = (options.apiKey || "").trim();
    if (!apiBaseUrl) throw new Error("Ollama API URL 未配置");
    return {
      apiBaseUrl,
      chatUrl: `${apiBaseUrl}/chat`,
      tagsUrl: `${apiBaseUrl}/tags`,
      apiKey,
    };
  }

  private normalizeApiBaseUrl(apiUrl: string): string {
    const raw = apiUrl.trim().replace(/\/+$/, "");
    if (!raw) return raw;
    const base = raw
      .replace(/\/v1(?:\/chat\/completions)?$/i, "")
      .replace(/\/api(?:\/chat|\/generate|\/tags)?$/i, "")
      .replace(/\/chat$/i, "")
      .replace(/\/generate$/i, "");
    return `${base}/api`;
  }

  private buildHeaders(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    return headers;
  }

  private buildOllamaOptions(options: LLMOptions): Record<string, unknown> {
    const ollamaOptions: Record<string, unknown> = {};
    if (options.temperature !== undefined) {
      ollamaOptions.temperature = options.temperature;
    }
    if (options.topP !== undefined) {
      ollamaOptions.top_p = options.topP;
    }
    if (options.maxTokens !== undefined) {
      ollamaOptions.num_predict = options.maxTokens;
    }

    const vendor = options.vendorOptions || {};
    this.copyVendorNumber(vendor, ollamaOptions, "topK", "top_k");
    this.copyVendorNumber(vendor, ollamaOptions, "top_k", "top_k");
    this.copyVendorNumber(vendor, ollamaOptions, "seed", "seed");
    this.copyVendorNumber(vendor, ollamaOptions, "numCtx", "num_ctx");
    this.copyVendorNumber(vendor, ollamaOptions, "num_ctx", "num_ctx");
    return ollamaOptions;
  }

  private copyVendorNumber(
    vendor: Record<string, unknown>,
    target: Record<string, unknown>,
    sourceKey: string,
    targetKey: string,
  ): void {
    const value = vendor[sourceKey];
    if (typeof value === "number" && Number.isFinite(value)) {
      target[targetKey] = value;
    }
  }

  private readKeepAlive(options: LLMOptions): string | number | undefined {
    const vendor = options.vendorOptions || {};
    const value = vendor.keepAlive ?? vendor.keep_alive;
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return undefined;
  }

  private buildPayload(
    model: string,
    messages: OllamaChatMessage[],
    options: LLMOptions,
    stream: boolean,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      model,
      messages,
      stream,
    };
    const ollamaOptions = this.buildOllamaOptions(options);
    if (Object.keys(ollamaOptions).length > 0) {
      payload.options = ollamaOptions;
    }
    const keepAlive = this.readKeepAlive(options);
    if (keepAlive !== undefined) {
      payload.keep_alive = keepAlive;
    }
    return payload;
  }

  private rejectPdfBase64(): never {
    throw new Error(
      "Ollama 原生接口不支持 PDF Base64 输入。请在 PDF 处理配置中切换为“文本提取”或“MinerU”后再使用 Ollama。",
    );
  }

  async generateSummary(
    content: string,
    isBase64: boolean,
    prompt: string | undefined,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string> {
    if (isBase64) this.rejectPdfBase64();

    const { chatUrl, apiKey } = this.ensureConfig(options);
    const model = (options.model || "llama3.2").trim();
    const messages: OllamaChatMessage[] = [
      { role: "system", content: SYSTEM_ROLE_PROMPT },
      { role: "user", content: buildUserMessage(prompt || "", content) },
    ];
    const streamEnabled = options.stream ?? true;
    const payload = this.buildPayload(model, messages, options, streamEnabled);

    if (streamEnabled && onProgress) {
      return this.streamRequest(chatUrl, apiKey, payload, options, onProgress);
    }
    return this.nonStreamRequest(chatUrl, apiKey, payload, options, onProgress);
  }

  async chat(
    pdfContent: string,
    isBase64: boolean,
    conversation: ConversationMessage[],
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string> {
    if (isBase64) this.rejectPdfBase64();

    const { chatUrl, apiKey } = this.ensureConfig(options);
    const model = (options.model || "llama3.2").trim();
    const messages: OllamaChatMessage[] = [
      { role: "system", content: SYSTEM_ROLE_PROMPT },
    ];

    conversation.forEach((msg, index) => {
      const role = this.normalizeRole(msg.role);
      const content =
        index === 0 && role === "user"
          ? buildUserMessage(msg.content, pdfContent)
          : msg.content;
      messages.push({ role, content });
    });

    const payload = this.buildPayload(model, messages, options, true);
    return this.streamRequest(chatUrl, apiKey, payload, options, onProgress);
  }

  private normalizeRole(role: string): "system" | "user" | "assistant" {
    if (role === "system" || role === "assistant") return role;
    return "user";
  }

  async listModels(options: LLMOptions): Promise<LLMModelInfo[]> {
    const { tagsUrl, apiKey } = this.ensureConfig(options);
    const data = await requestModelListJson(
      tagsUrl,
      this.buildHeaders(apiKey),
      options.requestTimeoutMs ?? 30000,
    );
    return parseModelListResponse(data).map((model) => ({
      ...model,
      ownedBy: model.ownedBy || "ollama",
    }));
  }

  async testConnection(options: LLMOptions): Promise<string> {
    const { chatUrl, apiKey } = this.ensureConfig(options);
    const model = (options.model || "llama3.2").trim();
    const testInput = getConnectionTestInput(options);
    if (testInput.isBase64) this.rejectPdfBase64();

    const payload = this.buildPayload(
      model,
      [
        { role: "system", content: SYSTEM_ROLE_PROMPT },
        { role: "user", content: testInput.text },
      ],
      options,
      false,
    );
    const payloadStr = JSON.stringify(payload, null, 2);
    const responseHeaders: Record<string, string> = {};
    let response: any;

    try {
      response = await Zotero.HTTP.request("POST", chatUrl, {
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify(payload),
        responseType: "text",
        timeout: options.requestTimeoutMs ?? 30000,
        errorDelayMax: 0,
      });
      this.collectHeaders(response, responseHeaders);
    } catch (error: any) {
      this.collectHeaders(error?.xmlhttp, responseHeaders);
      const responseBody =
        error?.xmlhttp?.response || error?.xmlhttp?.responseText || "";
      const status = error?.xmlhttp?.status;
      const parsed = this.parseErrorBody(responseBody);
      throw new APITestError(
        parsed.message || error?.message || "Ollama 请求失败",
        {
          errorName: parsed.name || "OllamaError",
          errorMessage: parsed.message || error?.message || "Ollama 请求失败",
          statusCode: status,
          requestUrl: chatUrl,
          requestBody: payloadStr,
          responseHeaders,
          responseBody:
            typeof responseBody === "string"
              ? responseBody
              : JSON.stringify(responseBody),
        },
      );
    }

    const status = response.status;
    const rawResponse = response.response || "";
    if (status < 200 || status >= 300) {
      throw new APITestError(`HTTP ${status}`, {
        errorName: `HTTP_${status}`,
        errorMessage: `HTTP ${status}: ${response.statusText || "请求失败"}`,
        statusCode: status,
        requestUrl: chatUrl,
        requestBody: payloadStr,
        responseHeaders,
        responseBody: rawResponse,
      });
    }

    const content = this.extractTextFromRawResponse(rawResponse);
    return `Mode: ${getConnectionTestModeLabel(testInput.mode)}\n连接成功!\n模型: ${model}\n响应: ${content}\n\n--- 原始响应 ---\n${rawResponse}`;
  }

  private async nonStreamRequest(
    chatUrl: string,
    apiKey: string,
    payload: Record<string, unknown>,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string> {
    throwIfAborted(options.abortSignal);
    let abortError: Error | null = null;
    let cleanupAbortSignal: (() => void) | undefined;
    try {
      const response = await Zotero.HTTP.request("POST", chatUrl, {
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify({ ...payload, stream: false }),
        responseType: "text",
        timeout: options.requestTimeoutMs ?? getRequestTimeoutMs(),
        errorDelayMax: 0,
        requestObserver: (xmlhttp: XMLHttpRequest) => {
          cleanupAbortSignal = bindAbortSignal(
            options.abortSignal,
            xmlhttp,
            (error) => {
              abortError = error;
            },
          );
        },
      });
      throwIfAborted(options.abortSignal);
      const text = this.extractTextFromRawResponse(response.response || "");
      if (!text) throw new Error("Ollama 返回内容为空");
      if (onProgress) await onProgress(text);
      return text;
    } catch (error: any) {
      if (abortError || isAbortError(error, options.abortSignal)) {
        throw normalizeAbortError(abortError || error, options.abortSignal);
      }
      throw this.toRequestError(error, "Ollama 请求失败");
    } finally {
      cleanupAbortSignal?.();
    }
  }

  private async streamRequest(
    chatUrl: string,
    apiKey: string,
    payload: Record<string, unknown>,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string> {
    throwIfAborted(options.abortSignal);
    const chunks: string[] = [];
    let processedLength = 0;
    let pending = "";
    let abortError: Error | null = null;
    let cleanupAbortSignal: (() => void) | undefined;

    const deliver = (chunk: string) => {
      if (!chunk) return;
      chunks.push(chunk);
      if (!onProgress) return;
      Promise.resolve(onProgress(chunk)).catch((err) =>
        ztoolkit.log("[AI-Butler] onProgress error (Ollama stream):", err),
      );
    };

    const processLines = (text: string, final = false) => {
      const combined = pending + text;
      const lines = combined.split(/\r?\n/);
      if (final) {
        pending = "";
        if (lines[lines.length - 1] === "") lines.pop();
      } else {
        pending = lines.pop() || "";
      }

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        const chunk = this.extractTextFromStreamLine(line);
        if (chunk) deliver(chunk);
      }
    };

    let response: any;
    try {
      response = await Zotero.HTTP.request("POST", chatUrl, {
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify({ ...payload, stream: true }),
        responseType: "text",
        timeout: options.requestTimeoutMs ?? getRequestTimeoutMs(),
        errorDelayMax: 0,
        requestObserver: (xmlhttp: XMLHttpRequest) => {
          cleanupAbortSignal = bindAbortSignal(
            options.abortSignal,
            xmlhttp,
            (error) => {
              abortError = error;
            },
          );
          xmlhttp.onprogress = (event: any) => {
            const status = event.target.status;
            if (status >= 400) {
              abortError = this.toRequestError(
                { xmlhttp: event.target },
                `HTTP ${status}: Ollama 请求失败`,
              );
              xmlhttp.abort();
              return;
            }

            const responseText: string = event.target.response || "";
            if (responseText.length <= processedLength) return;
            processLines(responseText.slice(processedLength));
            processedLength = responseText.length;
          };
          xmlhttp.onerror = () => {
            if (!abortError)
              abortError = new Error("NetworkError: XHR onerror");
          };
          xmlhttp.ontimeout = () => {
            if (!abortError) {
              abortError = new Error(
                `Timeout: 请求超过 ${options.requestTimeoutMs ?? getRequestTimeoutMs()} ms`,
              );
            }
          };
        },
      });
    } catch (error: any) {
      if (abortError && isAbortError(abortError, options.abortSignal)) {
        throw normalizeAbortError(abortError, options.abortSignal);
      }
      if (isAbortError(error, options.abortSignal)) {
        throw normalizeAbortError(error, options.abortSignal);
      }
      if (abortError && chunks.length === 0) throw abortError;
      if (chunks.length > 0) return chunks.join("");
      throw this.toRequestError(error, "Ollama 流式请求失败");
    } finally {
      cleanupAbortSignal?.();
    }

    throwIfAborted(options.abortSignal);
    const rawResponse = response?.response || "";
    if (rawResponse.length > processedLength) {
      processLines(rawResponse.slice(processedLength));
    }
    processLines("", true);

    const text = chunks.join("");
    if (!text) {
      throw new Error("Ollama 返回内容为空");
    }
    return text;
  }

  private extractTextFromStreamLine(line: string): string {
    const jsonText = line.replace(/^data:\s*/, "").trim();
    if (!jsonText || jsonText === "[DONE]") return "";
    try {
      const data = JSON.parse(jsonText);
      return this.extractText(data);
    } catch (error) {
      ztoolkit.log("[AI-Butler] Ollama stream parse error:", error);
      return "";
    }
  }

  private extractTextFromRawResponse(rawResponse: string): string {
    if (!rawResponse) return "";
    const trimmed = rawResponse.trim();
    if (!trimmed) return "";

    const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length > 1) {
      return lines.map((line) => this.extractTextFromStreamLine(line)).join("");
    }

    try {
      return this.extractText(JSON.parse(trimmed));
    } catch {
      return trimmed;
    }
  }

  private extractText(data: any): string {
    const messageContent = data?.message?.content;
    if (typeof messageContent === "string") return messageContent;
    if (typeof data?.response === "string") return data.response;
    if (typeof data?.content === "string") return data.content;
    return "";
  }

  private toRequestError(error: any, fallback: string): Error {
    const responseBody =
      error?.xmlhttp?.response || error?.xmlhttp?.responseText || "";
    const parsed = this.parseErrorBody(responseBody);
    if (parsed.message) return new Error(parsed.message);
    return new Error(error?.message || fallback);
  }

  private parseErrorBody(body: unknown): { name?: string; message?: string } {
    if (!body) return {};
    try {
      const data = typeof body === "string" ? JSON.parse(body) : body;
      const error = (data as any)?.error;
      if (typeof error === "string")
        return { name: "OllamaError", message: error };
      if (error && typeof error === "object") {
        return {
          name: error.code || error.type || "OllamaError",
          message: error.message || JSON.stringify(error),
        };
      }
      if (typeof (data as any)?.message === "string") {
        return { name: "OllamaError", message: (data as any).message };
      }
    } catch {
      if (typeof body === "string" && body.trim()) {
        return { name: "OllamaError", message: body.trim() };
      }
    }
    return {};
  }

  private collectHeaders(
    response: { getAllResponseHeaders?: () => string } | undefined,
    target: Record<string, string>,
  ): void {
    try {
      const headerStr = response?.getAllResponseHeaders?.() || "";
      headerStr.split(/\r?\n/).forEach((line: string) => {
        const idx = line.indexOf(":");
        if (idx > 0) {
          target[line.slice(0, idx).trim().toLowerCase()] = line
            .slice(idx + 1)
            .trim();
        }
      });
    } catch {
      // Header capture is best-effort for diagnostics.
    }
  }
}

import { ProviderRegistry } from "./ProviderRegistry";
ProviderRegistry.register(new OllamaProvider());

export default OllamaProvider;
