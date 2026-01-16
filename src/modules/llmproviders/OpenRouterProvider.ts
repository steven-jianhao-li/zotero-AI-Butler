import { ILlmProvider } from "./ILlmProvider";
import { ConversationMessage, LLMOptions, ProgressCb } from "./types";
import { SYSTEM_ROLE_PROMPT, buildUserMessage } from "../../utils/prompts";
import { getRequestTimeoutMs } from "./shared/llmutils";

/**
 * OpenRouter Provider
 *
 * Documentation: https://openrouter.ai/docs/guides/overview/multimodal/pdfs#using-base64-encoded-pdfs
 */
export class OpenRouterProvider implements ILlmProvider {
  readonly id = "openrouter";

  private ensureUrlAndKey(options: LLMOptions) {
    const apiUrl = (
      options.apiUrl || "https://openrouter.ai/api/v1/chat/completions"
    ).trim();
    const apiKey = (options.apiKey || "").trim();
    if (!apiUrl) throw new Error("API URL 未配置");
    if (!apiKey) throw new Error("API Key 未配置");
    return { apiUrl, apiKey };
  }

  private buildHeaders(apiKey: string) {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/steven-jianhao-li/zotero-AI-Butler", // Required by OpenRouter for rankings
      "X-Title": "Zotero AI Butler", // Optional
    } as Record<string, string>;
  }

  private buildGenParams(options: LLMOptions) {
    const params: any = {};
    if (options.temperature !== undefined)
      params.temperature = options.temperature;
    if (options.topP !== undefined) params.top_p = options.topP;
    if (options.maxTokens !== undefined) params.max_tokens = options.maxTokens;
    return params;
  }

  async generateSummary(
    content: string,
    isBase64: boolean,
    prompt: string | undefined,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string> {
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
  ): Promise<string> {
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

    const payload = {
      model,
      stream: false,
      messages: [
        { role: "system", content: SYSTEM_ROLE_PROMPT },
        {
          role: "user",
          content: "Hello! Please respond with 'OK' to confirm connection.",
        },
      ],
      ...this.buildGenParams(options),
    } as any;
    const payloadStr = JSON.stringify(payload, null, 2);

    const responseHeaders: Record<string, string> = {};
    let response: any;

    try {
      response = await Zotero.HTTP.request("POST", apiUrl, {
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify(payload),
        responseType: "text",
        timeout: options.requestTimeoutMs ?? 30000,
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
      let errorMessage = error?.message || "OpenRouter Request Failed";
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
      return `✅ Connection Successful!\nModel: ${model}\nResponse: ${content}\n\n--- Raw Response ---\n${typeof rawResponse === "string" ? rawResponse : JSON.stringify(rawResponse, null, 2)}`;
    }

    const { APITestError } = await import("./types");
    throw new APITestError(`HTTP ${status}`, {
      errorName: `HTTP_${status}`,
      errorMessage: `HTTP ${status}: ${response.statusText || "Request failed"}`,
      statusCode: status,
      requestUrl: apiUrl,
      requestBody: payloadStr,
      responseHeaders,
      responseBody: rawResponse,
    });
  }

  // --- Helpers ---

  private async streamRequest(
    apiUrl: string,
    apiKey: string,
    payload: any,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string> {
    const payloadWithStream = { ...payload, stream: true };
    const chunks: string[] = [];
    let delivered = 0;
    let processedLength = 0;
    let partialLine = "";
    let gotAnyDelta = false;
    let abortError: Error | null = null;

    try {
      await Zotero.HTTP.request("POST", apiUrl, {
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify(payloadWithStream),
        responseType: "text",
        timeout: options.requestTimeoutMs ?? getRequestTimeoutMs(),
        requestObserver: (xmlhttp: XMLHttpRequest) => {
          xmlhttp.onprogress = (e: any) => {
            const status = e.target.status;
            if (status >= 400) {
              // ... Error handling similar to others ...
              try {
                const errorResponse = e.target.response;
                const parsed = errorResponse ? JSON.parse(errorResponse) : null;
                const err = parsed?.error || parsed || {};
                const code = err?.code || `HTTP ${status}`;
                const msg = err?.message || "Request failed";
                abortError = new Error(`${code}: ${msg}`);
                xmlhttp.abort();
              } catch {
                abortError = new Error(`HTTP ${status}: Request failed`);
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
                  if (jsonStr === ": OPENROUTER PROCESSING") continue; // OpenRouter specific keep-alive

                  try {
                    const evt = JSON.parse(jsonStr);
                    const delta = evt?.choices?.[0]?.delta?.content;
                    if (typeof delta === "string" && delta.length > 0) {
                      gotAnyDelta = true;
                      chunks.push(delta.replace(/\n+/g, "\n"));
                      const current = chunks.join("");
                      if (onProgress && current.length > delivered) {
                        const newChunk = current.slice(delivered);
                        delivered = current.length;
                        Promise.resolve(onProgress(newChunk)).catch((err) =>
                          ztoolkit.log(
                            "[AI-Butler] onProgress error (OpenRouter SSE):",
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
              ztoolkit.log("[AI-Butler] OpenRouter SSE parse error:", err);
            }
          };
          xmlhttp.onerror = () => {
            if (!abortError)
              abortError = new Error("NetworkError: XHR onerror");
          };
          xmlhttp.ontimeout = () => {
            if (!abortError)
              abortError = new Error(
                `Timeout: exceeded ${options.requestTimeoutMs ?? getRequestTimeoutMs()} ms`,
              );
          };
        },
      });
    } catch (error: any) {
      if (abortError) {
        if (gotAnyDelta && chunks.length > 0) return chunks.join("");
        throw abortError;
      }
      const errorMessage = error?.message || "OpenRouter request failed";
      // ... Error parsing ...
      if (gotAnyDelta && chunks.length > 0) return chunks.join("");
      throw new Error(errorMessage);
    }
    return chunks.join("");
  }

  private async nonStreamRequest(
    apiUrl: string,
    apiKey: string,
    payload: any,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string> {
    try {
      const res = await Zotero.HTTP.request("POST", apiUrl, {
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify(payload),
        responseType: "json",
        timeout: options.requestTimeoutMs ?? getRequestTimeoutMs(),
      });
      const data = res.response || res;
      const text = data?.choices?.[0]?.message?.content || "";
      const result = typeof text === "string" ? text : JSON.stringify(text);
      if (onProgress && result) await onProgress(result);
      return result;
    } catch (e: any) {
      // ... Error handling ...
      const msg = e?.message || "OpenRouter request failed";
      throw new Error(msg);
    }
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
  ): Promise<string> {
    const { apiUrl, apiKey } = this.ensureUrlAndKey(options);
    const model = (options.model || "google/gemma-3-27b-it").trim();

    if (pdfFiles.length === 0) throw new Error("没有要处理的 PDF 文件");

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
      throw new Error("没有成功处理任何 PDF 文件");
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

    return this.streamRequest(apiUrl, apiKey, payload, options, onProgress);
  }
}

// Self-registration
import { ProviderRegistry } from "./ProviderRegistry";
ProviderRegistry.register(new OpenRouterProvider());

export default OpenRouterProvider;
