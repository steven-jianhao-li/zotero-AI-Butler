import { ILlmProvider } from "./ILlmProvider";
import { ConversationMessage, LLMOptions, ProgressCb } from "./types";
import { SYSTEM_ROLE_PROMPT, buildUserMessage } from "../../utils/prompts";
import { getRequestTimeoutMs } from "./shared/llmutils";

export class GeminiProvider implements ILlmProvider {
  readonly id = "google"; // 同步现有 provider 识别：google/gemini

  async generateSummary(
    content: string,
    isBase64: boolean,
    prompt: string | undefined,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string> {
    const baseUrl = (
      options.apiUrl || "https://generativelanguage.googleapis.com"
    ).replace(/\/$/, "");
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "gemini-2.5-pro").trim();
    const temperature = options.temperature ?? 0.7;
    const topP = options.topP ?? 1.0;
    const maxTokens = options.maxTokens ?? 4096;

    if (!baseUrl) throw new Error("Gemini API URL 未配置");
    if (!apiKey) throw new Error("Gemini API Key 未配置");

    const endpoint = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

    let payload: any;
    if (isBase64) {
      const generationConfig: any = {};
      if (options.temperature !== undefined)
        generationConfig.temperature = temperature;
      if (options.topP !== undefined) generationConfig.topP = topP;
      if (options.maxTokens !== undefined)
        generationConfig.maxOutputTokens = maxTokens;
      payload = {
        generationConfig,
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt || "" },
              { inlineData: { mimeType: "application/pdf", data: content } },
            ],
          },
        ],
        systemInstruction: { parts: [{ text: SYSTEM_ROLE_PROMPT }] },
      };
    } else {
      const userContent = buildUserMessage(prompt || "", content);
      const generationConfig: any = {};
      if (options.temperature !== undefined)
        generationConfig.temperature = temperature;
      if (options.topP !== undefined) generationConfig.topP = topP;
      if (options.maxTokens !== undefined)
        generationConfig.maxOutputTokens = maxTokens;
      payload = {
        generationConfig,
        contents: [{ role: "user", parts: [{ text: userContent }] }],
        systemInstruction: { parts: [{ text: SYSTEM_ROLE_PROMPT }] },
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
          "x-goog-api-key": apiKey,
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
                const code = err?.code || `HTTP ${status}`;
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
                  parts[parts.length - 1].indexOf("data: ") === 0 &&
                  slice.indexOf("\n", slice.length - 1) === slice.length - 1
                    ? ""
                    : parts.pop() || "";

                for (const raw of parts) {
                  if (raw.indexOf("data: ") !== 0) continue;
                  const jsonStr = raw.replace(/^data:\s*/, "").trim();
                  if (!jsonStr) continue;
                  try {
                    const json = JSON.parse(jsonStr);
                    const text = this.extractGeminiText(json);
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
                  } catch {
                    /* ignore */
                  }
                }
              }
            } catch (err) {
              ztoolkit.log("[AI-Butler] Gemini stream parse error:", err);
            }
          };
        },
      });
    } catch (error: any) {
      let errorMessage = error?.message || "Gemini 请求失败";
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
    const baseUrl = (
      options.apiUrl || "https://generativelanguage.googleapis.com"
    ).replace(/\/$/, "");
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "gemini-2.5-pro").trim();
    const temperature = options.temperature ?? 0.7;

    if (!baseUrl) throw new Error("Gemini API URL 未配置");
    if (!apiKey) throw new Error("Gemini API Key 未配置");

    const endpoint = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

    const contents: any[] = [];
    if (conversation && conversation.length > 0) {
      const firstUserMsg = conversation[0];
      if (isBase64) {
        contents.push({
          role: "user",
          parts: [
            { text: firstUserMsg.content },
            { inlineData: { mimeType: "application/pdf", data: pdfContent } },
          ],
        });
      } else {
        contents.push({
          role: "user",
          parts: [
            { text: buildUserMessage(firstUserMsg.content, pdfContent || "") },
          ],
        });
      }
      if (conversation.length > 1) {
        contents.push({
          role: "model",
          parts: [{ text: conversation[1].content }],
        });
      }
      for (let i = 2; i < conversation.length; i++) {
        const msg = conversation[i];
        contents.push({
          role: msg.role === "user" ? "user" : "model",
          parts: [{ text: msg.content }],
        });
      }
    }

    const genCfg: any = {};
    if (options.temperature !== undefined) genCfg.temperature = temperature;
    const payload: any = {
      generationConfig: genCfg,
      contents,
      systemInstruction: { parts: [{ text: SYSTEM_ROLE_PROMPT }] },
    };

    const chunks: string[] = [];
    let delivered = 0;
    let processedLength = 0;
    let partialLine = "";
    let abortError: Error | null = null;
    let gotAnyDelta = false;

    try {
      await Zotero.HTTP.request("POST", endpoint, {
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
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
                const code = err?.code || `HTTP ${status}`;
                const msg = err?.message || "请求失败";
                const errorMessage = `${code}: ${msg}`;
                abortError = new Error(errorMessage);
                ztoolkit.log("[AI-Butler] Gemini HTTP error:", {
                  status,
                  code,
                  msg,
                  response: errorResponse,
                });
                xmlhttp.abort();
              } catch (parseErr) {
                const errorMessage = `HTTP ${status}: 请求失败`;
                abortError = new Error(errorMessage);
                ztoolkit.log("[AI-Butler] Gemini HTTP error:", {
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
                    const text = this.extractGeminiText(json);
                    if (text) {
                      gotAnyDelta = true;
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
                  } catch {
                    /* ignore */
                  }
                }
              }
            } catch (err) {
              ztoolkit.log("[AI-Butler] Gemini stream parse error:", err);
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
        if (gotAnyDelta && chunks.length > 0) {
          return chunks.join("");
        }
        throw abortError;
      }
      let errorMessage = error?.message || "Gemini 请求失败";
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
      ztoolkit.log("[AI-Butler] Gemini request error:", {
        status: error?.xmlhttp?.status,
        statusText: error?.xmlhttp?.statusText,
        message: errorMessage,
      });
      if (gotAnyDelta && chunks.length > 0) return chunks.join("");
      throw new Error(errorMessage);
    }

    return chunks.join("");
  }

  async testConnection(options: LLMOptions): Promise<string> {
    const baseUrl = (
      options.apiUrl || "https://generativelanguage.googleapis.com"
    ).replace(/\/$/, "");
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "gemini-2.5-pro").trim();
    if (!baseUrl) throw new Error("Gemini API URL 未配置");
    if (!apiKey) throw new Error("Gemini API Key 未配置");

    const url = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const payload = {
      contents: [
        {
          role: "user",
          parts: [
            { text: "Hello! Please respond with 'OK' to confirm connection." },
          ],
        },
      ],
      systemInstruction: { parts: [{ text: SYSTEM_ROLE_PROMPT }] },
      generationConfig: { temperature: 0.1, topP: 1.0, maxOutputTokens: 16 },
    };
    const payloadStr = JSON.stringify(payload, null, 2);

    let response: any;
    const responseHeaders: Record<string, string> = {};
    try {
      response = await Zotero.HTTP.request("POST", url, {
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
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
      let errorMessage = error?.message || "Gemini 请求失败";
      let errorName = "NetworkError";
      try {
        if (responseBody) {
          const parsed =
            typeof responseBody === "string"
              ? JSON.parse(responseBody)
              : responseBody;
          const err = parsed?.error || parsed;
          errorName = err?.code || err?.status || "APIError";
          errorMessage = err?.message || errorMessage;
        }
      } catch {
        /* ignore */
      }

      // 导入并抛出 APITestError
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
      const text =
        json?.candidates?.[0]?.content?.parts
          ?.map((p: any) => p?.text || "")
          .join("") || "";
      return `✅ 连接成功!\n模型: ${model}\n响应: ${text}\n\n--- 原始响应 ---\n${typeof rawResponse === "string" ? rawResponse : JSON.stringify(rawResponse, null, 2)}`;
    }

    // 非 200 但未抛出异常的情况
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

  private extractGeminiText(json: any): string {
    try {
      const cand0 = json?.candidates?.[0];
      if (!cand0) return "";
      const deltaParts = cand0?.delta?.content?.parts || cand0?.delta?.parts;
      if (Array.isArray(deltaParts))
        return deltaParts.map((p: any) => p?.text || "").join("");
      const parts = cand0?.content?.parts;
      if (Array.isArray(parts))
        return parts.map((p: any) => p?.text || "").join("");
      const text = cand0?.content?.parts?.[0]?.text || cand0?.text;
      return typeof text === "string" ? text : "";
    } catch {
      return "";
    }
  }

  /**
   * 使用 Gemini File API 上传文件
   *
   * @param filePath 文件路径
   * @param displayName 显示名称
   * @param apiKey API 密钥
   * @param baseUrl API 基础 URL
   * @returns 上传后的文件 URI
   */
  private async uploadFileToGemini(
    filePath: string,
    displayName: string,
    apiKey: string,
    baseUrl: string,
  ): Promise<string> {
    // 读取文件内容
    const fileData = await IOUtils.read(filePath);
    const numBytes = fileData.byteLength;
    const mimeType = "application/pdf";

    // 步骤 1: 开始可恢复上传
    const startUploadUrl = `${baseUrl}/upload/v1beta/files`;

    let uploadUrl: string;
    try {
      const startResponse = await Zotero.HTTP.request("POST", startUploadUrl, {
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": String(numBytes),
          "X-Goog-Upload-Header-Content-Type": mimeType,
        },
        body: JSON.stringify({
          file: { display_name: displayName },
        }),
        responseType: "text",
        timeout: 60000,
      });

      // 从响应头获取上传 URL
      const headers = startResponse.getAllResponseHeaders?.() || "";
      const urlMatch = headers.match(/x-goog-upload-url:\s*(.+?)(?:\r?\n|$)/i);
      if (!urlMatch) {
        throw new Error("无法获取 Gemini 文件上传 URL");
      }
      uploadUrl = urlMatch[1].trim();
    } catch (error: any) {
      ztoolkit.log("[AI-Butler] Gemini 文件上传初始化失败:", error);
      throw new Error(`Gemini 文件上传初始化失败: ${error.message}`);
    }

    // 步骤 2: 上传文件内容
    try {
      const uploadResponse = await Zotero.HTTP.request("POST", uploadUrl, {
        headers: {
          "Content-Length": String(numBytes),
          "X-Goog-Upload-Offset": "0",
          "X-Goog-Upload-Command": "upload, finalize",
        },
        body: new Uint8Array(fileData),
        responseType: "json",
        timeout: 120000, // 文件上传可能需要更长时间
      });

      const fileInfo = uploadResponse.response;
      const fileUri = fileInfo?.file?.uri;
      if (!fileUri) {
        throw new Error("无法获取上传文件的 URI");
      }

      ztoolkit.log(`[AI-Butler] 文件上传成功: ${displayName} -> ${fileUri}`);
      return fileUri;
    } catch (error: any) {
      ztoolkit.log("[AI-Butler] Gemini 文件上传失败:", error);
      throw new Error(`Gemini 文件上传失败: ${error.message}`);
    }
  }

  /**
   * 多文件摘要生成
   * 使用 inline_data 方式发送多个 PDF 文件
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
    const baseUrl = (
      options.apiUrl || "https://generativelanguage.googleapis.com"
    ).replace(/\/$/, "");
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "gemini-2.5-pro").trim();
    const temperature = options.temperature ?? 0.7;
    const topP = options.topP ?? 1.0;
    const maxTokens = options.maxTokens ?? 8192;

    if (!baseUrl) throw new Error("Gemini API URL 未配置");
    if (!apiKey) throw new Error("Gemini API Key 未配置");
    if (pdfFiles.length === 0) throw new Error("没有要处理的 PDF 文件");

    // 构建 inline_data 部分
    const fileParts: any[] = [];

    for (let i = 0; i < pdfFiles.length; i++) {
      const pdfFile = pdfFiles[i];

      if (pdfFile.base64Content && pdfFile.base64Content.length > 0) {
        // 直接使用已有的 base64 内容
        fileParts.push({
          inline_data: {
            mime_type: "application/pdf",
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

    if (fileParts.length === 0) {
      throw new Error("没有成功处理任何 PDF 文件");
    }

    ztoolkit.log(
      `[AI-Butler] 准备发送 ${fileParts.length} 个 PDF 附件到 Gemini`,
    );

    // 构建请求
    const endpoint = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

    const generationConfig: any = {
      temperature,
      topP,
      maxOutputTokens: maxTokens,
    };

    const payload = {
      generationConfig,
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }, ...fileParts],
        },
      ],
      systemInstruction: { parts: [{ text: SYSTEM_ROLE_PROMPT }] },
    };

    // 发送请求并处理流式响应
    const chunks: string[] = [];
    let delivered = 0;
    let processedLength = 0;
    let partialLine = "";
    let gotAnyDelta = false;

    try {
      await Zotero.HTTP.request("POST", endpoint, {
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
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
                const code = err?.code || `HTTP ${status}`;
                const msg = err?.message || "请求失败";
                xmlhttp.abort();
                throw new Error(`${code}: ${msg}`);
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
                  parts[parts.length - 1].indexOf("data: ") === 0 &&
                  slice.indexOf("\n", slice.length - 1) === slice.length - 1
                    ? ""
                    : parts.pop() || "";

                for (const raw of parts) {
                  if (raw.indexOf("data: ") !== 0) continue;
                  const jsonStr = raw.replace(/^data:\s*/, "").trim();
                  if (!jsonStr) continue;
                  try {
                    const json = JSON.parse(jsonStr);
                    const text = this.extractGeminiText(json);
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
                  } catch {
                    /* ignore */
                  }
                }
              }
            } catch (err) {
              ztoolkit.log("[AI-Butler] Gemini stream parse error:", err);
            }
          };
        },
      });
    } catch (error: any) {
      let errorMessage = error?.message || "Gemini 请求失败";
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

    const streamed = chunks.join("");
    if (gotAnyDelta && streamed) return streamed;
    return "";
  }
}

// 自注册
import { ProviderRegistry } from "./ProviderRegistry";
ProviderRegistry.register(new GeminiProvider());

export default GeminiProvider;
