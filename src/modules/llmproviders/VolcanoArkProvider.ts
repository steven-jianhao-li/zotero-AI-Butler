import { ILlmProvider, PdfFileInfo } from "./ILlmProvider";
import { ConversationMessage, LLMOptions, ProgressCb } from "./types";
import { SYSTEM_ROLE_PROMPT, buildUserMessage } from "../../utils/prompts";
import { getRequestTimeoutMs } from "./shared/llmutils";

/**
 * 火山引擎 Ark Provider
 * 使用 Response API 接口
 * 文档: https://www.volcengine.com/docs/82379/1902647
 */
export class VolcanoArkProvider implements ILlmProvider {
  readonly id = "volcanoark";

  async generateSummary(
    content: string,
    isBase64: boolean,
    prompt: string | undefined,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string> {
    const baseUrl = (
      options.apiUrl || "https://ark.cn-beijing.volces.com/api/v3/responses"
    ).replace(/\/$/, "");
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "doubao-seed-1-6-251015").trim();
    const temperature = options.temperature ?? 0.7;
    const maxTokens = options.maxTokens ?? 4096;

    if (!baseUrl) throw new Error("火山引擎 API URL 未配置");
    if (!apiKey) throw new Error("火山引擎 API Key 未配置");

    // 如果 baseUrl 已经以 /responses 结尾，直接使用；否则追加
    const endpoint = baseUrl.endsWith("/responses")
      ? baseUrl
      : `${baseUrl}/responses`;

    let payload: any;
    if (isBase64) {
      // PDF Base64 模式 - 使用 input_file
      payload = {
        model,
        stream: true,
        temperature,
        max_output_tokens: maxTokens,
        input: [
          {
            role: "system",
            content: SYSTEM_ROLE_PROMPT,
          },
          {
            role: "user",
            content: [
              {
                type: "input_file",
                file_data: `data:application/pdf;base64,${content}`,
                filename: "document.pdf",
              },
              {
                type: "input_text",
                text: prompt || "",
              },
            ],
          },
        ],
      };
    } else {
      // 纯文本模式
      const userContent = buildUserMessage(prompt || "", content);
      payload = {
        model,
        stream: true,
        temperature,
        max_output_tokens: maxTokens,
        input: [
          {
            role: "system",
            content: SYSTEM_ROLE_PROMPT,
          },
          {
            role: "user",
            content: userContent,
          },
        ],
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
          Authorization: `Bearer ${apiKey}`,
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
                  parts[parts.length - 1].indexOf("data:") === 0 &&
                  slice.indexOf("\n", slice.length - 1) === slice.length - 1
                    ? ""
                    : parts.pop() || "";

                for (const raw of parts) {
                  if (raw.indexOf("data:") !== 0) continue;
                  const jsonStr = raw.replace(/^data:\s*/, "").trim();
                  if (!jsonStr || jsonStr === "[DONE]") continue;
                  try {
                    const json = JSON.parse(jsonStr);
                    const text = this.extractVolcanoText(json);
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
              ztoolkit.log("[AI-Butler] VolcanoArk stream parse error:", err);
            }
          };
        },
      });
    } catch (error: any) {
      let errorMessage = error?.message || "火山引擎请求失败";
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
      options.apiUrl || "https://ark.cn-beijing.volces.com/api/v3/responses"
    ).replace(/\/$/, "");
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "doubao-seed-1-6-251015").trim();
    const temperature = options.temperature ?? 0.7;

    if (!baseUrl) throw new Error("火山引擎 API URL 未配置");
    if (!apiKey) throw new Error("火山引擎 API Key 未配置");

    // 如果 baseUrl 已经以 /responses 结尾，直接使用；否则追加
    const endpoint = baseUrl.endsWith("/responses")
      ? baseUrl
      : `${baseUrl}/responses`;

    // 构建消息列表
    const inputMessages: any[] = [
      {
        role: "system",
        content: SYSTEM_ROLE_PROMPT,
      },
    ];

    if (conversation && conversation.length > 0) {
      const firstUserMsg = conversation[0];
      if (isBase64) {
        // 第一条消息包含 PDF
        inputMessages.push({
          role: "user",
          content: [
            {
              type: "input_file",
              file_data: `data:application/pdf;base64,${pdfContent}`,
              filename: "document.pdf",
            },
            {
              type: "input_text",
              text: firstUserMsg.content,
            },
          ],
        });
      } else {
        inputMessages.push({
          role: "user",
          content: buildUserMessage(firstUserMsg.content, pdfContent || ""),
        });
      }

      // 添加后续对话
      if (conversation.length > 1) {
        inputMessages.push({
          role: "assistant",
          content: conversation[1].content,
        });
      }

      for (let i = 2; i < conversation.length; i++) {
        const msg = conversation[i];
        inputMessages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        });
      }
    }

    const payload = {
      model,
      stream: true,
      temperature,
      input: inputMessages,
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
          Authorization: `Bearer ${apiKey}`,
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
                ztoolkit.log("[AI-Butler] VolcanoArk HTTP error:", {
                  status,
                  code,
                  msg,
                  response: errorResponse,
                });
                xmlhttp.abort();
              } catch (parseErr) {
                const errorMessage = `HTTP ${status}: 请求失败`;
                abortError = new Error(errorMessage);
                ztoolkit.log("[AI-Butler] VolcanoArk HTTP error:", {
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
                  if (!jsonStr || jsonStr === "[DONE]") continue;

                  try {
                    const json = JSON.parse(jsonStr);
                    const text = this.extractVolcanoText(json);
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
              ztoolkit.log("[AI-Butler] VolcanoArk stream parse error:", err);
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
      let errorMessage = error?.message || "火山引擎请求失败";
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
      ztoolkit.log("[AI-Butler] VolcanoArk request error:", {
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
      options.apiUrl || "https://ark.cn-beijing.volces.com/api/v3/responses"
    ).replace(/\/$/, "");
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "doubao-seed-1-6-251015").trim();
    if (!baseUrl) throw new Error("火山引擎 API URL 未配置");
    if (!apiKey) throw new Error("火山引擎 API Key 未配置");

    // 如果 baseUrl 已经以 /responses 结尾，直接使用；否则追加
    const url = baseUrl.endsWith("/responses")
      ? baseUrl
      : `${baseUrl}/responses`;
    const payload = {
      model,
      input: [
        {
          role: "user",
          content: "Hello! Please respond with 'OK' to confirm connection.",
        },
      ],
      max_output_tokens: 16,
      temperature: 0.1,
    };
    const payloadStr = JSON.stringify(payload, null, 2);

    let response: any;
    const responseHeaders: Record<string, string> = {};
    try {
      response = await Zotero.HTTP.request("POST", url, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        responseType: "text",
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
      let errorMessage = error?.message || "火山引擎请求失败";
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
      // 从 Response API 格式提取文本
      const text = this.extractVolcanoTextFromFull(json);
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

  /**
   * 从火山引擎 Response API 流式响应中提取文本
   * 流式响应格式: {"type":"response.output_text.delta","delta":"文本内容",...}
   *
   * 注意：此方法仅用于流式响应的增量解析，只提取 delta 事件中的内容。
   * 不处理 response.completed 等完整响应事件，因为这些事件包含的是已累加的完整内容，
   * 会导致内容重复输出。
   *
   * 火山引擎（豆包模型）流式响应事件顺序：
   * 1. response.output_text.delta - 实际输出的增量文本（我们需要提取的）
   * 2. response.output_text.done - 输出完成标记（包含完整文本，不提取以避免重复）
   * 3. response.output_item.done - 输出项完成标记
   * 4. response.completed - 响应完成标记（包含完整文本，不提取以避免重复）
   *
   * 另外，豆包模型的思考过程会通过 response.reasoning_summary_text.delta 发送，
   * 我们不提取这些内容，只提取最终的输出文本。
   */
  private extractVolcanoText(json: any): string {
    try {
      // 只处理 response.output_text.delta 格式（流式响应的增量输出）
      // 格式: {"type":"response.output_text.delta","delta":"text",...}
      // 这是我们唯一需要提取的事件类型，其他事件要么是控制事件，要么包含重复的完整内容
      if (json?.type === "response.output_text.delta" && json?.delta) {
        return json.delta;
      }

      // 兼容 OpenAI Chat Completions 格式的增量输出（delta.content）
      // 某些火山引擎配置可能返回这种格式
      const choices = json?.choices;
      if (Array.isArray(choices) && choices.length > 0) {
        const choice = choices[0];
        // 只处理流式增量内容（delta.content），不处理完整消息（message.content）
        if (choice?.delta?.content) {
          return choice.delta.content;
        }
      }

      // 不处理以下事件类型以避免重复输出：
      // - response.output_text.done: 包含完整的输出文本
      // - response.output_item.done: 输出项完成标记
      // - response.completed: 包含完整的响应输出
      // - response.reasoning_summary_text.delta: 模型的思考过程（非最终输出）

      return "";
    } catch {
      return "";
    }
  }

  /**
   * 从火山引擎 Response API 完整响应中提取文本
   */
  private extractVolcanoTextFromFull(json: any): string {
    try {
      const output = json?.output;
      if (Array.isArray(output)) {
        const texts: string[] = [];
        for (const item of output) {
          // 优先处理 message 类型
          if (item?.type === "message" && item?.content) {
            const content = item.content;
            if (Array.isArray(content)) {
              for (const c of content) {
                if (c?.type === "output_text" && c?.text) {
                  texts.push(c.text);
                }
              }
            }
          }
          // 也处理 reasoning 类型的 summary（用于测试连接等短输出场景）
          if (item?.type === "reasoning" && item?.summary) {
            const summary = item.summary;
            if (Array.isArray(summary)) {
              for (const s of summary) {
                if (s?.type === "summary_text" && s?.text) {
                  texts.push(s.text);
                }
              }
            }
          }
        }
        if (texts.length > 0) return texts.join("");
      }

      // 兼容 choices 格式
      const choices = json?.choices;
      if (Array.isArray(choices) && choices.length > 0) {
        const choice = choices[0];
        if (choice?.message?.content) {
          return choice.message.content;
        }
      }

      return "";
    } catch {
      return "";
    }
  }

  /**
   * 多文件摘要生成
   * 使用 input_file 方式发送多个 PDF 文件
   */
  async generateMultiFileSummary(
    pdfFiles: PdfFileInfo[],
    prompt: string,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string> {
    const baseUrl = (
      options.apiUrl || "https://ark.cn-beijing.volces.com/api/v3/responses"
    ).replace(/\/$/, "");
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "doubao-seed-1-6-251015").trim();
    const temperature = options.temperature ?? 0.7;
    const maxTokens = options.maxTokens ?? 8192;

    if (!baseUrl) throw new Error("火山引擎 API URL 未配置");
    if (!apiKey) throw new Error("火山引擎 API Key 未配置");
    if (pdfFiles.length === 0) throw new Error("没有要处理的 PDF 文件");

    // 如果 baseUrl 已经以 /responses 结尾，直接使用；否则追加
    const endpoint = baseUrl.endsWith("/responses")
      ? baseUrl
      : `${baseUrl}/responses`;

    // 构建 input_file 部分
    const contentParts: any[] = [];

    for (let i = 0; i < pdfFiles.length; i++) {
      const pdfFile = pdfFiles[i];

      if (pdfFile.base64Content && pdfFile.base64Content.length > 0) {
        contentParts.push({
          type: "input_file",
          file_data: `data:application/pdf;base64,${pdfFile.base64Content}`,
          filename: pdfFile.displayName || `document_${i + 1}.pdf`,
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

    if (contentParts.length === 0) {
      throw new Error("没有成功处理任何 PDF 文件");
    }

    // 添加文本提示
    contentParts.push({
      type: "input_text",
      text: prompt || "",
    });

    ztoolkit.log(
      `[AI-Butler] 准备发送 ${contentParts.length - 1} 个 PDF 附件到火山引擎`,
    );

    const payload = {
      model,
      stream: true,
      temperature,
      max_output_tokens: maxTokens,
      input: [
        {
          role: "system",
          content: SYSTEM_ROLE_PROMPT,
        },
        {
          role: "user",
          content: contentParts,
        },
      ],
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
          Authorization: `Bearer ${apiKey}`,
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
                  parts[parts.length - 1].indexOf("data:") === 0 &&
                  slice.indexOf("\n", slice.length - 1) === slice.length - 1
                    ? ""
                    : parts.pop() || "";

                for (const raw of parts) {
                  if (raw.indexOf("data:") !== 0) continue;
                  const jsonStr = raw.replace(/^data:\s*/, "").trim();
                  if (!jsonStr || jsonStr === "[DONE]") continue;
                  try {
                    const json = JSON.parse(jsonStr);
                    const text = this.extractVolcanoText(json);
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
              ztoolkit.log("[AI-Butler] VolcanoArk stream parse error:", err);
            }
          };
        },
      });
    } catch (error: any) {
      let errorMessage = error?.message || "火山引擎请求失败";
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
ProviderRegistry.register(new VolcanoArkProvider());

export default VolcanoArkProvider;
