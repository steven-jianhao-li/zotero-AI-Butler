import { ILlmProvider } from "./ILlmProvider";
import {
  ConversationMessage,
  LLMOptions,
  LLMModelInfo,
  LLMProviderCapabilities,
  ProgressCb,
} from "./types";
import { SYSTEM_ROLE_PROMPT, buildUserMessage } from "../../utils/prompts";
import { getRequestTimeoutMs, logPromptCacheUsage } from "./shared/llmutils";
import {
  getConnectionTestInput,
  formatConnectionTestSuccess,
  formatProviderTimeout,
} from "./shared/connectionTest";
import {
  deriveVersionedModelsUrl,
  parseModelListResponse,
  requestModelListJson,
} from "./shared/modelList";
import { resolveReasoningEffort } from "./shared/reasoning";
import {
  bindAbortSignal,
  isAbortError,
  normalizeAbortError,
  throwIfAborted,
} from "./shared/requestAbort";
import {
  providerHttpRequestFailed,
  providerMissingApiKey,
  providerMissingApiUrl,
  providerNoPdfFiles,
  providerNoPdfProcessed,
  providerRequestFailed,
  providerStreamMissingDone,
  providerStreamParseFailed,
  providerStreamTruncated,
  providerStreamUnexpectedEnd,
} from "./shared/localizedErrors";

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
  readonly id = "openai-compat"; // 供偏好使用的唯一标识
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
      options.apiUrl || "https://api.openai.com/v1/chat/completions"
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

  private buildHeaders(apiKey: string) {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    } as Record<string, string>;
  }

  private buildGenParams(options: LLMOptions) {
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
  ): Promise<string> {
    const { apiUrl, apiKey } = this.ensureUrlAndKey(options);
    const model = (options.model || "gpt-3.5-turbo").trim();
    const streamEnabled = options.stream ?? true;
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

    if (streamEnabled && onProgress) {
      const payload = { ...basePayload, stream: true };
      const chunks: string[] = [];
      let delivered = 0;
      let processedLength = 0;
      let partialLine = "";
      let streamComplete = false;
      let finishReason = "";
      let abortError: Error | null = null;
      let cleanupAbortSignal: (() => void) | undefined;

      try {
        await Zotero.HTTP.request("POST", apiUrl, {
          headers: this.buildHeaders(apiKey),
          body: JSON.stringify(payload),
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
            xmlhttp.onprogress = (e: any) => {
              const status = e.target.status;
              if (status >= 400) {
                try {
                  const errorResponse = e.target.response;
                  const parsed = errorResponse
                    ? JSON.parse(errorResponse)
                    : null;
                  const err = parsed?.error || parsed || {};
                  const code = err?.code || `HTTP ${status}`;
                  const msg = err?.message || providerRequestFailed("API");
                  abortError = new Error(`${code}: ${msg}`);
                  xmlhttp.abort();
                } catch {
                  abortError = new Error(providerHttpRequestFailed(status));
                  xmlhttp.abort();
                }
                return;
              }

              try {
                const resp: string = e.target.response || "";
                if (resp.length > processedLength) {
                  const slice = partialLine + resp.slice(processedLength);
                  processedLength = resp.length;
                  const parts = slice.split(/\r?\n/);
                  partialLine =
                    parts[parts.length - 1].indexOf("data:") === 0 &&
                    slice.indexOf("\n", slice.length - 1) === slice.length - 1
                      ? ""
                      : parts.pop() || "";

                  for (const raw of parts) {
                    if (raw.indexOf("data:") !== 0) continue;
                    const jsonStr = raw.replace(/^data:\s*/, "").trim();
                    if (!jsonStr) continue;
                    if (jsonStr === "[DONE]") {
                      streamComplete = true;
                      continue;
                    }
                    try {
                      const evt = JSON.parse(jsonStr);
                      const reason = evt?.choices?.[0]?.finish_reason;
                      if (typeof reason === "string" && reason.length > 0) {
                        finishReason = reason;
                        streamComplete = true;
                      }
                      const delta = evt?.choices?.[0]?.delta?.content;
                      if (typeof delta === "string" && delta.length > 0) {
                        chunks.push(delta);
                        const current = chunks.join("");
                        if (onProgress && current.length > delivered) {
                          const newChunk = current.slice(delivered);
                          delivered = current.length;
                          Promise.resolve(onProgress(newChunk)).catch((err) =>
                            ztoolkit.log(
                              "[AI-Butler] onProgress error (OpenAI Compat SSE):",
                              err,
                            ),
                          );
                        }
                      }
                    } catch {
                      abortError = new Error(
                        providerStreamParseFailed("OpenAI Compatible"),
                      );
                      xmlhttp.abort();
                      return;
                    }
                  }
                }
              } catch (err) {
                ztoolkit.log("[AI-Butler] OpenAI Compat SSE parse error:", err);
                if (!abortError) {
                  abortError = new Error(
                    providerStreamParseFailed("OpenAI Compatible"),
                  );
                }
                xmlhttp.abort();
              }
            };
            xmlhttp.onerror = () => {
              if (!abortError)
                abortError = new Error("NetworkError: XHR onerror");
            };
            xmlhttp.ontimeout = () => {
              if (!abortError)
                abortError = new Error(
                  formatProviderTimeout(
                    options.requestTimeoutMs ?? getRequestTimeoutMs(),
                  ),
                );
            };
          },
        });
      } catch (error: any) {
        if (abortError) {
          if (isAbortError(abortError, options.abortSignal)) {
            throw normalizeAbortError(abortError, options.abortSignal);
          }
          throw abortError;
        }
        if (isAbortError(error, options.abortSignal)) {
          throw normalizeAbortError(error, options.abortSignal);
        }
        let errorMessage =
          error?.message || providerRequestFailed("OpenAI Compatible");
        try {
          const responseText =
            error?.xmlhttp?.response || error?.xmlhttp?.responseText;
          if (responseText) {
            const parsed =
              typeof responseText === "string"
                ? JSON.parse(responseText)
                : responseText;
            const err = parsed?.error || parsed;
            const code = err?.code || "Error";
            const msg = err?.message || error?.message || String(error);
            errorMessage = `${code}: ${msg}`;
          }
        } catch {
          /* ignore */
        }
        throw new Error(errorMessage);
      } finally {
        cleanupAbortSignal?.();
      }

      this.assertStreamCompleted(streamComplete, finishReason, partialLine);
      return chunks.join("");
    }

    // 非流式
    let abortError: Error | null = null;
    let cleanupAbortSignal: (() => void) | undefined;
    try {
      const res = await Zotero.HTTP.request("POST", apiUrl, {
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify(basePayload),
        responseType: "json",
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
      const data = res.response || res;
      const text = data?.choices?.[0]?.message?.content || "";
      const result = typeof text === "string" ? text : JSON.stringify(text);
      if (onProgress && result) await onProgress(result);
      return result;
    } catch (e: any) {
      if (abortError || isAbortError(e, options.abortSignal)) {
        throw normalizeAbortError(abortError || e, options.abortSignal);
      }
      let errorMessage =
        e?.message || providerRequestFailed("OpenAI Compatible");
      try {
        const responseText = e?.xmlhttp?.response || e?.xmlhttp?.responseText;
        if (responseText) {
          const parsed =
            typeof responseText === "string"
              ? JSON.parse(responseText)
              : responseText;
          const err = parsed?.error || parsed;
          const code = err?.code || "Error";
          const msg = err?.message || e?.message || String(e);
          errorMessage = `${code}: ${msg}`;
        }
      } catch {
        /* ignore */
      }
      throw new Error(errorMessage);
    } finally {
      cleanupAbortSignal?.();
    }
  }

  async chat(
    pdfContent: string,
    isBase64: boolean,
    conversation: ConversationMessage[],
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string> {
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

    const chunks: string[] = [];
    let delivered = 0;
    let processedLength = 0;
    let partialLine = "";
    let streamComplete = false;
    let finishReason = "";
    let lastUsage: any;
    let abortError: Error | null = null;
    let cleanupAbortSignal: (() => void) | undefined;

    try {
      await Zotero.HTTP.request("POST", apiUrl, {
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify(payload),
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
          xmlhttp.onprogress = (e: any) => {
            const status = e.target.status;
            if (status >= 400) {
              try {
                const errorResponse = e.target.response;
                const parsed = errorResponse ? JSON.parse(errorResponse) : null;
                const err = parsed?.error || parsed || {};
                const code = err?.code || `HTTP ${status}`;
                const msg = err?.message || providerRequestFailed("API");
                abortError = new Error(`${code}: ${msg}`);
                xmlhttp.abort();
              } catch {
                abortError = new Error(providerHttpRequestFailed(status));
                xmlhttp.abort();
              }
              return;
            }

            try {
              const resp: string = e.target.response || "";
              if (resp.length > processedLength) {
                const slice = partialLine + resp.slice(processedLength);
                processedLength = resp.length;
                const parts = slice.split(/\r?\n/);
                partialLine =
                  parts[parts.length - 1].indexOf("data:") === 0 &&
                  slice.indexOf("\n", slice.length - 1) === slice.length - 1
                    ? ""
                    : parts.pop() || "";

                for (const raw of parts) {
                  if (raw.indexOf("data:") !== 0) continue;
                  const jsonStr = raw.replace(/^data:\s*/, "").trim();
                  if (!jsonStr) continue;
                  if (jsonStr === "[DONE]") {
                    streamComplete = true;
                    continue;
                  }
                  try {
                    const evt = JSON.parse(jsonStr);
                    if (options.enablePromptCache && evt?.usage) {
                      lastUsage = evt.usage;
                    }
                    const reason = evt?.choices?.[0]?.finish_reason;
                    if (typeof reason === "string" && reason.length > 0) {
                      finishReason = reason;
                      streamComplete = true;
                    }
                    const delta = evt?.choices?.[0]?.delta?.content;
                    if (typeof delta === "string" && delta.length > 0) {
                      chunks.push(delta);
                      const current = chunks.join("");
                      if (onProgress && current.length > delivered) {
                        const newChunk = current.slice(delivered);
                        delivered = current.length;
                        Promise.resolve(onProgress(newChunk)).catch((err) =>
                          ztoolkit.log(
                            "[AI-Butler] onProgress error (OpenAI Compat chat SSE):",
                            err,
                          ),
                        );
                      }
                    }
                  } catch {
                    abortError = new Error(
                      providerStreamParseFailed("OpenAI Compatible"),
                    );
                    xmlhttp.abort();
                    return;
                  }
                }
              }
            } catch (err) {
              ztoolkit.log(
                "[AI-Butler] OpenAI Compat chat SSE parse error:",
                err,
              );
              if (!abortError) {
                abortError = new Error(
                  providerStreamParseFailed("OpenAI Compatible"),
                );
              }
              xmlhttp.abort();
            }
          };
          xmlhttp.onerror = () => {
            if (!abortError)
              abortError = new Error("NetworkError: XHR onerror");
          };
          xmlhttp.ontimeout = () => {
            if (!abortError)
              abortError = new Error(
                formatProviderTimeout(
                  options.requestTimeoutMs ?? getRequestTimeoutMs(),
                ),
              );
          };
        },
      });
    } catch (error: any) {
      if (abortError) {
        if (isAbortError(abortError, options.abortSignal)) {
          throw normalizeAbortError(abortError, options.abortSignal);
        }
        throw abortError;
      }
      if (isAbortError(error, options.abortSignal)) {
        throw normalizeAbortError(error, options.abortSignal);
      }
      let errorMessage =
        error?.message || providerRequestFailed("OpenAI Compatible");
      try {
        const responseText =
          error?.xmlhttp?.response || error?.xmlhttp?.responseText;
        if (responseText) {
          const parsed =
            typeof responseText === "string"
              ? JSON.parse(responseText)
              : responseText;
          const err = parsed?.error || parsed;
          const code = err?.code || "Error";
          const msg = err?.message || error?.message || String(error);
          errorMessage = `${code}: ${msg}`;
        }
      } catch {
        /* ignore */
      }
      throw new Error(errorMessage);
    } finally {
      cleanupAbortSignal?.();
    }

    this.assertStreamCompleted(streamComplete, finishReason, partialLine);
    if (options.enablePromptCache) {
      logPromptCacheUsage("OpenAI-Compat chat", lastUsage);
    }
    return chunks.join("");
  }

  private assertStreamCompleted(
    streamComplete: boolean,
    finishReason: string,
    partialLine: string,
  ): void {
    if (partialLine.trim()) {
      throw new Error(providerStreamTruncated("OpenAI Compatible"));
    }
    if (!streamComplete) {
      throw new Error(providerStreamMissingDone("OpenAI Compatible"));
    }
    if (finishReason && finishReason !== "stop") {
      throw new Error(
        providerStreamUnexpectedEnd("OpenAI Compatible", finishReason),
      );
    }
  }

  async listModels(options: LLMOptions): Promise<LLMModelInfo[]> {
    const { apiUrl, apiKey } = this.ensureUrlAndKey(options);
    const url = deriveVersionedModelsUrl(
      apiUrl,
      "https://api.openai.com/v1/chat/completions",
    );
    const data = await requestModelListJson(
      url,
      this.buildHeaders(apiKey),
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
        headers: this.buildHeaders(apiKey),
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
  ): Promise<string> {
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

    const chunks: string[] = [];
    let delivered = 0;
    let processedLength = 0;
    let partialLine = "";
    let gotAnyDelta = false;
    let abortError: Error | null = null;
    let cleanupAbortSignal: (() => void) | undefined;

    try {
      await Zotero.HTTP.request("POST", apiUrl, {
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify(payload),
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
          xmlhttp.onprogress = (e: any) => {
            const status = e.target.status;
            if (status >= 400) {
              try {
                const errorResponse = e.target.response;
                const parsed = errorResponse ? JSON.parse(errorResponse) : null;
                const err = parsed?.error || parsed || {};
                const code = err?.code || `HTTP ${status}`;
                const msg = err?.message || providerRequestFailed("API");
                abortError = new Error(`${code}: ${msg}`);
                xmlhttp.abort();
              } catch {
                abortError = new Error(providerHttpRequestFailed(status));
                xmlhttp.abort();
              }
              return;
            }

            try {
              const resp: string = e.target.response || "";
              if (resp.length > processedLength) {
                const slice = partialLine + resp.slice(processedLength);
                processedLength = resp.length;
                const parts = slice.split(/\r?\n/);
                partialLine =
                  parts[parts.length - 1].indexOf("data:") === 0 &&
                  slice.indexOf("\n", slice.length - 1) === slice.length - 1
                    ? ""
                    : parts.pop() || "";

                for (const raw of parts) {
                  if (raw.indexOf("data:") !== 0) continue;
                  const jsonStr = raw.replace(/^data:\s*/, "").trim();
                  if (!jsonStr || jsonStr === "[DONE]") continue;
                  try {
                    const evt = JSON.parse(jsonStr);
                    const delta = evt?.choices?.[0]?.delta?.content;
                    if (typeof delta === "string" && delta.length > 0) {
                      gotAnyDelta = true;
                      chunks.push(delta);
                      const current = chunks.join("");
                      if (onProgress && current.length > delivered) {
                        const newChunk = current.slice(delivered);
                        delivered = current.length;
                        Promise.resolve(onProgress(newChunk)).catch((err) =>
                          ztoolkit.log(
                            "[AI-Butler] onProgress error (OpenAI Compat multi-PDF):",
                            err,
                          ),
                        );
                      }
                    }
                  } catch {
                    /* ignore */
                  }
                }
              }
            } catch (err) {
              ztoolkit.log(
                "[AI-Butler] OpenAI Compat multi-PDF SSE parse error:",
                err,
              );
            }
          };
          xmlhttp.onerror = () => {
            if (!abortError)
              abortError = new Error("NetworkError: XHR onerror");
          };
          xmlhttp.ontimeout = () => {
            if (!abortError)
              abortError = new Error(
                formatProviderTimeout(
                  options.requestTimeoutMs ?? getRequestTimeoutMs(),
                ),
              );
          };
        },
      });
    } catch (error: any) {
      if (abortError) {
        if (isAbortError(abortError, options.abortSignal)) {
          throw normalizeAbortError(abortError, options.abortSignal);
        }
        if (gotAnyDelta && chunks.length > 0) return chunks.join("");
        throw abortError;
      }
      if (isAbortError(error, options.abortSignal)) {
        throw normalizeAbortError(error, options.abortSignal);
      }
      let errorMessage =
        error?.message || providerRequestFailed("OpenAI Compatible");
      try {
        const responseText =
          error?.xmlhttp?.response || error?.xmlhttp?.responseText;
        if (responseText) {
          const parsed =
            typeof responseText === "string"
              ? JSON.parse(responseText)
              : responseText;
          const err = parsed?.error || parsed;
          const code = err?.code || "Error";
          const msg = err?.message || error?.message || String(error);
          errorMessage = `${code}: ${msg}`;
        }
      } catch {
        /* ignore */
      }
      if (gotAnyDelta && chunks.length > 0) return chunks.join("");
      throw new Error(errorMessage);
    } finally {
      cleanupAbortSignal?.();
    }

    const streamed = chunks.join("");
    if (gotAnyDelta && streamed) return streamed;
    return "";
  }
}

// 自注册
import { ProviderRegistry } from "./ProviderRegistry";
ProviderRegistry.register(new OpenAICompatProvider());

export default OpenAICompatProvider;
