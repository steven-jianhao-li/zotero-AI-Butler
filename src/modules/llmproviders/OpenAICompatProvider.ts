import { ILlmProvider } from "./ILlmProvider";
import { ConversationMessage, LLMOptions, ProgressCb } from "./types";
import { SYSTEM_ROLE_PROMPT, buildUserMessage } from "../../utils/prompts";
import { getRequestTimeoutMs } from "./shared/llmutils";

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

  private ensureUrlAndKey(options: LLMOptions) {
    const apiUrl = (
      options.apiUrl || "https://api.openai.com/v1/chat/completions"
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
    const model = (options.model || "gpt-3.5-turbo").trim();
    const streamEnabled = options.stream ?? true;

    // Chat Completions 的消息结构
    const messages: Array<{
      role: "system" | "user" | "assistant";
      content: any;
    }> = [];
    messages.push({ role: "system", content: SYSTEM_ROLE_PROMPT });

    if (isBase64) {
      // 尝试使用多模态格式（某些兼容服务支持 image_url 或 vision）
      messages.push({
        role: "user",
        content: [
          { type: "text", text: prompt || "请分析这个文档。" },
          {
            type: "image_url",
            image_url: { url: `data:application/pdf;base64,${content}` },
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
      const payload = { ...basePayload, stream: true };
      const chunks: string[] = [];
      let delivered = 0;
      let processedLength = 0;
      let partialLine = "";
      let gotAnyDelta = false;
      let abortError: Error | null = null;

      try {
        await Zotero.HTTP.request("POST", apiUrl, {
          headers: this.buildHeaders(apiKey),
          body: JSON.stringify(payload),
          responseType: "text",
          timeout: options.requestTimeoutMs ?? getRequestTimeoutMs(),
          requestObserver: (xmlhttp: XMLHttpRequest) => {
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
                  const msg = err?.message || "请求失败";
                  abortError = new Error(`${code}: ${msg}`);
                  xmlhttp.abort();
                } catch {
                  abortError = new Error(`HTTP ${status}: 请求失败`);
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
                        chunks.push(delta.replace(/\n+/g, "\n"));
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
                      /* ignore */
                    }
                  }
                }
              } catch (err) {
                ztoolkit.log("[AI-Butler] OpenAI Compat SSE parse error:", err);
              }
            };
            xmlhttp.onerror = () => {
              if (!abortError)
                abortError = new Error("NetworkError: XHR onerror");
            };
            xmlhttp.ontimeout = () => {
              if (!abortError)
                abortError = new Error(
                  `Timeout: 请求超过 ${options.requestTimeoutMs ?? getRequestTimeoutMs()} ms`,
                );
            };
          },
        });
      } catch (error: any) {
        if (abortError) {
          if (gotAnyDelta && chunks.length > 0) return chunks.join("");
          throw abortError;
        }
        let errorMessage = error?.message || "OpenAI 兼容请求失败";
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
      }

      return chunks.join("");
    }

    // 非流式
    try {
      const res = await Zotero.HTTP.request("POST", apiUrl, {
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify(basePayload),
        responseType: "json",
        timeout: options.requestTimeoutMs ?? getRequestTimeoutMs(),
      });
      const data = res.response || res;
      const text = data?.choices?.[0]?.message?.content || "";
      const result = typeof text === "string" ? text : JSON.stringify(text);
      if (onProgress && result) await onProgress(result);
      return result;
    } catch (e: any) {
      let errorMessage = e?.message || "OpenAI 兼容请求失败";
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
            // Base64 模式：使用多模态格式
            messages.push({
              role: "user",
              content: [
                { type: "text", text: msg.content },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:application/pdf;base64,${pdfContent}`,
                  },
                },
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
    let gotAnyDelta = false;
    let abortError: Error | null = null;

    try {
      await Zotero.HTTP.request("POST", apiUrl, {
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify(payload),
        responseType: "text",
        timeout: options.requestTimeoutMs ?? getRequestTimeoutMs(),
        requestObserver: (xmlhttp: XMLHttpRequest) => {
          xmlhttp.onprogress = (e: any) => {
            const status = e.target.status;
            if (status >= 400) {
              try {
                const errorResponse = e.target.response;
                const parsed = errorResponse ? JSON.parse(errorResponse) : null;
                const err = parsed?.error || parsed || {};
                const code = err?.code || `HTTP ${status}`;
                const msg = err?.message || "请求失败";
                abortError = new Error(`${code}: ${msg}`);
                xmlhttp.abort();
              } catch {
                abortError = new Error(`HTTP ${status}: 请求失败`);
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
                      chunks.push(delta.replace(/\n+/g, "\n"));
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
                    /* ignore */
                  }
                }
              }
            } catch (err) {
              ztoolkit.log(
                "[AI-Butler] OpenAI Compat chat SSE parse error:",
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
                `Timeout: 请求超过 ${options.requestTimeoutMs ?? getRequestTimeoutMs()} ms`,
              );
          };
        },
      });
    } catch (error: any) {
      if (abortError) {
        if (gotAnyDelta && chunks.length > 0) return chunks.join("");
        throw abortError;
      }
      let errorMessage = error?.message || "OpenAI 兼容请求失败";
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
    }

    return chunks.join("");
  }

  async testConnection(options: LLMOptions): Promise<string> {
    const { apiUrl, apiKey } = this.ensureUrlAndKey(options);
    const model = (options.model || "gpt-3.5-turbo").trim();

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

    let response: any;
    let responseHeaders: Record<string, string> = {};
    try {
      response = await Zotero.HTTP.request("POST", apiUrl, {
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify(payload),
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
      let errorMessage = error?.message || "OpenAI 兼容请求失败";
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
      return `✅ 连接成功!\n模型: ${model}\n响应: ${content}\n\n--- 原始响应 ---\n${typeof rawResponse === "string" ? rawResponse : JSON.stringify(rawResponse, null, 2)}`;
    }

    const { APITestError } = await import("./types");
    throw new APITestError(`HTTP ${status}`, {
      errorName: `HTTP_${status}`,
      errorMessage: `HTTP ${status}: ${response.statusText || "请求失败"}`,
      statusCode: status,
      requestUrl: apiUrl,
      requestBody: payloadStr,
      responseHeaders,
      responseBody: rawResponse,
    });
  }
}

// 自注册
import { ProviderRegistry } from "./ProviderRegistry";
ProviderRegistry.register(new OpenAICompatProvider());

export default OpenAICompatProvider;
