import { ILlmProvider } from "./ILlmProvider";
import { ConversationMessage, LLMOptions, ProgressCb } from "./types";
import { SYSTEM_ROLE_PROMPT, buildUserMessage } from "../../utils/prompts";
import { getRequestTimeoutMs } from "./shared/llmutils";

export class AnthropicProvider implements ILlmProvider {
  readonly id = "anthropic";

  async generateSummary(
    content: string,
    isBase64: boolean,
    prompt: string | undefined,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string> {
    const baseUrl = (options.apiUrl || "https://api.anthropic.com").replace(
      /\/$/,
      "",
    );
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "claude-3-5-sonnet-20241022").trim();
    const temperature = options.temperature ?? 0.7;
    const maxTokens = options.maxTokens ?? 4096; // Anthropic 必填

    if (!baseUrl) throw new Error("Anthropic API URL 未配置");
    if (!apiKey) throw new Error("Anthropic API Key 未配置");

    const endpoint = `${baseUrl}/v1/messages`;

    let payload: any;
    if (isBase64) {
      payload = {
        model,
        max_tokens: maxTokens,
        ...(options.temperature !== undefined ? { temperature } : {}),
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
        ...(options.temperature !== undefined ? { temperature } : {}),
        system: SYSTEM_ROLE_PROMPT,
        messages: [
          { role: "user", content: [{ type: "text", text: userContent }] },
        ],
        stream: true,
      };
    }

    const chunks: string[] = [];
    let delivered = 0;
    let processedLength = 0;
    let partialLine = "";
    let gotAnyDelta = false;

    try {
      await Zotero.HTTP.request("POST", endpoint, {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
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
                const code = err?.type || `HTTP ${status}`;
                const msg = err?.message || "请求失败";
                const errorMessage = `${code}: ${msg}`;
                xmlhttp.abort();
                throw new Error(errorMessage);
              } catch {
                xmlhttp.abort();
                throw new Error(`HTTP ${status}: 请求失败`);
              }
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
                  try {
                    const json = JSON.parse(jsonStr);
                    if (json.type === "content_block_delta") {
                      const text = json?.delta?.text;
                      if (text) {
                        gotAnyDelta = true;
                        chunks.push(text.replace(/\n+/g, "\n"));
                        const current = chunks.join("");
                        if (onProgress && current.length > delivered) {
                          const newChunk = current.slice(delivered);
                          delivered = current.length;
                          Promise.resolve(onProgress(newChunk)).catch((err) => {
                            ztoolkit.log(
                              "[AI-Butler] onProgress callback error:",
                              err,
                            );
                          });
                        }
                      }
                    }
                  } catch {
                    /* ignore */
                  }
                }
              }
            } catch (err) {
              ztoolkit.log("[AI-Butler] Anthropic stream parse error:", err);
            }
          };
        },
      });
    } catch (error: any) {
      let errorMessage = error?.message || "Anthropic 请求失败";
      try {
        const responseText =
          error?.xmlhttp?.response || error?.xmlhttp?.responseText;
        if (responseText) {
          const parsed =
            typeof responseText === "string"
              ? JSON.parse(responseText)
              : responseText;
          const err = parsed?.error || parsed;
          const code = err?.type || "Error";
          const msg = err?.message || error?.message || String(error);
          errorMessage = `${code}: ${msg}`;
        }
      } catch {
        /* ignore */
      }
      if (gotAnyDelta && chunks.length > 0) return chunks.join("");
      throw new Error(errorMessage);
    }

    const streamed = chunks.join("");
    if (gotAnyDelta && streamed) return streamed;
    return "";
  }

  async chat(
    pdfContent: string,
    isBase64: boolean,
    conversation: ConversationMessage[],
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string> {
    const baseUrl = (options.apiUrl || "https://api.anthropic.com").replace(
      /\/$/,
      "",
    );
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "claude-3-5-sonnet-20241022").trim();
    const temperature = options.temperature ?? 0.7;
    const maxTokens = options.maxTokens ?? 4096;

    if (!baseUrl) throw new Error("Anthropic API URL 未配置");
    if (!apiKey) throw new Error("Anthropic API Key 未配置");

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

    const payload: any = {
      model,
      max_tokens: maxTokens,
      ...(options.temperature !== undefined ? { temperature } : {}),
      system: SYSTEM_ROLE_PROMPT,
      messages,
      stream: true,
    };

    const chunks: string[] = [];
    let delivered = 0;
    let processedLength = 0;
    let partialLine = "";
    let abortError: Error | null = null;

    try {
      await Zotero.HTTP.request("POST", endpoint, {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
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
                const code = err?.type || `HTTP ${status}`;
                const msg = err?.message || "请求失败";
                const errorMessage = `${code}: ${msg}`;
                abortError = new Error(errorMessage);
                ztoolkit.log("[AI-Butler] Anthropic HTTP error:", {
                  status,
                  code,
                  msg,
                  response: errorResponse,
                });
                xmlhttp.abort();
              } catch (parseErr) {
                const errorMessage = `HTTP ${status}: 请求失败`;
                abortError = new Error(errorMessage);
                ztoolkit.log("[AI-Butler] Anthropic HTTP error:", {
                  status,
                  parseErr,
                });
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

                  try {
                    const json = JSON.parse(jsonStr);
                    if (json.type === "content_block_delta") {
                      const text = json?.delta?.text;
                      if (text) {
                        chunks.push(text.replace(/\n+/g, "\n"));
                        const current = chunks.join("");
                        if (onProgress && current.length > delivered) {
                          const newChunk = current.slice(delivered);
                          delivered = current.length;
                          Promise.resolve(onProgress(newChunk)).catch((err) => {
                            ztoolkit.log("[AI-Butler] onProgress error:", err);
                          });
                        }
                      }
                    }
                  } catch {
                    /* ignore */
                  }
                }
              }
            } catch (err) {
              ztoolkit.log("[AI-Butler] Anthropic stream parse error:", err);
            }
          };
        },
      });
    } catch (error: any) {
      if (abortError) throw abortError;
      let errorMessage = error?.message || "Anthropic 请求失败";
      try {
        const responseText =
          error?.xmlhttp?.response || error?.xmlhttp?.responseText;
        if (responseText) {
          const parsed =
            typeof responseText === "string"
              ? JSON.parse(responseText)
              : responseText;
          const err = parsed?.error || parsed;
          const code = err?.type || "Error";
          const msg = err?.message || error?.message || String(error);
          errorMessage = `${code}: ${msg}`;
        }
      } catch {
        /* ignore */
      }
      ztoolkit.log("[AI-Butler] Anthropic request error:", {
        status: error?.xmlhttp?.status,
        statusText: error?.xmlhttp?.statusText,
        message: errorMessage,
      });
      throw new Error(errorMessage);
    }

    return chunks.join("");
  }

  async testConnection(options: LLMOptions): Promise<string> {
    const baseUrl = (options.apiUrl || "https://api.anthropic.com").replace(
      /\/$/,
      "",
    );
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "claude-3-5-sonnet-20241022").trim();
    if (!baseUrl) throw new Error("Anthropic API URL 未配置");
    if (!apiKey) throw new Error("Anthropic API Key 未配置");

    const url = `${baseUrl}/v1/messages`;
    const payload = {
      model,
      max_tokens: 16,
      messages: [
        {
          role: "user",
          content: "Hello! Please respond with 'OK' to confirm connection.",
        },
      ],
    } as any;
    const payloadStr = JSON.stringify(payload, null, 2);

    let response: any;
    const responseHeaders: Record<string, string> = {};
    try {
      response = await Zotero.HTTP.request("POST", url, {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(payload),
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
      let errorMessage = error?.message || "Anthropic 请求失败";
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
      return `✅ 连接成功!\n模型: ${model}\n响应: ${text}\n\n--- 原始响应 ---\n${typeof rawResponse === "string" ? rawResponse : JSON.stringify(rawResponse, null, 2)}`;
    }

    const { APITestError } = await import("./types");
    throw new APITestError(`HTTP ${status}`, {
      errorName: `HTTP_${status}`,
      errorMessage: `HTTP ${status}: ${response.statusText || "请求失败"}`,
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
  ): Promise<string> {
    const baseUrl = (options.apiUrl || "https://api.anthropic.com").replace(
      /\/$/,
      "",
    );
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "claude-3-5-sonnet-20241022").trim();
    const temperature = options.temperature ?? 0.7;
    const maxTokens = options.maxTokens ?? 8192;

    if (!baseUrl) throw new Error("Anthropic API URL 未配置");
    if (!apiKey) throw new Error("Anthropic API Key 未配置");
    if (pdfFiles.length === 0) throw new Error("没有要处理的 PDF 文件");

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
      throw new Error("没有成功处理任何 PDF 文件");
    }

    ztoolkit.log(
      `[AI-Butler] 准备发送 ${documentParts.length} 个 PDF 附件到 Anthropic`,
    );

    const endpoint = `${baseUrl}/v1/messages`;

    const payload = {
      model,
      max_tokens: maxTokens,
      ...(options.temperature !== undefined ? { temperature } : {}),
      system: SYSTEM_ROLE_PROMPT,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }, ...documentParts],
        },
      ],
      stream: true,
    };

    const chunks: string[] = [];
    let delivered = 0;
    let processedLength = 0;
    let partialLine = "";
    let gotAnyDelta = false;
    let abortError: Error | null = null;

    try {
      await Zotero.HTTP.request("POST", endpoint, {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
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
                const code = err?.type || `HTTP ${status}`;
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
                  if (!jsonStr) continue;
                  try {
                    const json = JSON.parse(jsonStr);
                    if (json.type === "content_block_delta") {
                      const text = json?.delta?.text;
                      if (text) {
                        gotAnyDelta = true;
                        chunks.push(text.replace(/\n+/g, "\n"));
                        const current = chunks.join("");
                        if (onProgress && current.length > delivered) {
                          const newChunk = current.slice(delivered);
                          delivered = current.length;
                          Promise.resolve(onProgress(newChunk)).catch((err) => {
                            ztoolkit.log(
                              "[AI-Butler] onProgress error (Anthropic multi-PDF):",
                              err,
                            );
                          });
                        }
                      }
                    }
                  } catch {
                    /* ignore */
                  }
                }
              }
            } catch (err) {
              ztoolkit.log(
                "[AI-Butler] Anthropic multi-PDF stream parse error:",
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
      let errorMessage = error?.message || "Anthropic 多文件请求失败";
      try {
        const responseText =
          error?.xmlhttp?.response || error?.xmlhttp?.responseText;
        if (responseText) {
          const parsed =
            typeof responseText === "string"
              ? JSON.parse(responseText)
              : responseText;
          const err = parsed?.error || parsed;
          const code = err?.type || "Error";
          const msg = err?.message || error?.message || String(error);
          errorMessage = `${code}: ${msg}`;
        }
      } catch {
        /* ignore */
      }
      if (gotAnyDelta && chunks.length > 0) return chunks.join("");
      throw new Error(errorMessage);
    }

    const streamed = chunks.join("");
    if (gotAnyDelta && streamed) return streamed;
    return "";
  }
}

// 自注册
import { ProviderRegistry } from "./ProviderRegistry";
ProviderRegistry.register(new AnthropicProvider());

export default AnthropicProvider;
