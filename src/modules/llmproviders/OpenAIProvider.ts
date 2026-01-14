import { ILlmProvider } from "./ILlmProvider";
import { ConversationMessage, LLMOptions, ProgressCb } from "./types";
import { SYSTEM_ROLE_PROMPT, buildUserMessage } from "../../utils/prompts";
import { getRequestTimeoutMs } from "./shared/llmutils";

export class OpenAIProvider implements ILlmProvider {
  readonly id = "openai";

  async generateSummary(
    content: string,
    isBase64: boolean,
    prompt: string | undefined,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string> {
    const apiKey = (options.apiKey || "").trim();
    const apiUrl = (options.apiUrl || "").trim();
    const model = (options.model || "gpt-3.5-turbo").trim();
    const temperature = options.temperature ?? 0.7;
    const streamEnabled = options.stream ?? true;

    if (!apiUrl) throw new Error("API URL 未配置");
    if (!apiKey) throw new Error("API Key 未配置");

    // Base64 使用 Responses API
    if (isBase64) {
      const responsesUrl = /\/v1\/.+$/i.test(apiUrl)
        ? apiUrl.replace(/\/v1\/.+$/i, "/v1/responses")
        : apiUrl.endsWith("/v1/responses")
          ? apiUrl
          : apiUrl.replace(/\/?$/, "/v1/responses");

      const input: any[] = [
        {
          role: "developer",
          content: [{ type: "input_text", text: SYSTEM_ROLE_PROMPT }],
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt || "" },
            {
              type: "input_file",
              filename: "paper.pdf",
              file_data: `data:application/pdf;base64,${content}`,
            },
          ],
        },
      ];

      const basePayload: any = { model, input };

      if (streamEnabled && onProgress) {
        const payload = { ...basePayload, stream: true } as any;
        const chunks: string[] = [];
        let delivered = 0;
        let processedLength = 0;
        let partialLine = "";
        let gotAnyDelta = false;
        let abortError: Error | null = null;

        try {
          await Zotero.HTTP.request("POST", responsesUrl, {
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
                        const t = evt?.type as string;
                        if (
                          t === "response.output_text.delta" &&
                          typeof evt.delta === "string"
                        ) {
                          gotAnyDelta = true;
                          chunks.push(evt.delta.replace(/\n+/g, "\n"));
                          const current = chunks.join("");
                          if (onProgress && current.length > delivered) {
                            const newChunk = current.slice(delivered);
                            delivered = current.length;
                            Promise.resolve(onProgress(newChunk)).catch((err) =>
                              ztoolkit.log(
                                "[AI-Butler] onProgress error (OpenAI Responses SSE):",
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
                    "[AI-Butler] OpenAI Responses SSE parse error:",
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
          let errorMessage = error?.message || "OpenAI Responses 请求失败";
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
        const res = await Zotero.HTTP.request("POST", responsesUrl, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(basePayload),
          responseType: "json",
          timeout: options.requestTimeoutMs ?? getRequestTimeoutMs(),
        });
        const data = res.response || res;
        const text = (data?.output_text as string) || "";
        if (onProgress && text) await onProgress(text);
        return text;
      } catch (e: any) {
        let errorMessage = e?.message || "OpenAI Responses 请求失败";
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

    // 文本 Chat Completions
    const input: any[] = [
      { role: "developer", content: SYSTEM_ROLE_PROMPT },
      { role: "user", content: buildUserMessage(prompt || "", content) },
    ];

    const basePayload: any = {
      model,
      input,
    };
    if (options.temperature !== undefined)
      basePayload.temperature = Number(temperature);

    if (streamEnabled && onProgress) {
      const body = JSON.stringify({ ...basePayload, stream: true });
      const chunks: string[] = [];
      let delivered = 0;
      let gotAnyDelta = false;
      let processedLength = 0;
      let partialLine = "";
      let streamComplete = false;
      let abortedDueToError = false;
      let errorFromProgress: Error | null = null;

      try {
        await Zotero.HTTP.request("POST", apiUrl, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body,
          responseType: "text",
          timeout: options.requestTimeoutMs ?? getRequestTimeoutMs(),
          requestObserver: (xmlhttp: XMLHttpRequest) => {
            xmlhttp.onprogress = (e: any) => {
              const status = e.target.status;
              if (status >= 400) {
                try {
                  const errorResponse = e.target.response;
                  if (errorResponse) {
                    const parsed = JSON.parse(errorResponse);
                    const err = parsed?.error || parsed;
                    const code = err?.code || `HTTP ${status}`;
                    const msg = err?.message || "请求失败";
                    const errorMessage = `${code}: ${msg}`;
                    abortedDueToError = true;
                    errorFromProgress = new Error(errorMessage);
                    xmlhttp.abort();
                  }
                } catch {
                  const errorMessage = `HTTP ${status}: 请求失败`;
                  abortedDueToError = true;
                  errorFromProgress = new Error(errorMessage);
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
                    parts[parts.length - 1].indexOf("data: ") === 0 &&
                    slice.indexOf("\n", slice.length - 1) === slice.length - 1
                      ? ""
                      : parts.pop() || "";

                  for (const raw of parts) {
                    if (raw.indexOf("data: ") !== 0) continue;
                    const jsonStr = raw.replace(/^data:\s*/, "").trim();
                    if (jsonStr === "[DONE]") {
                      streamComplete = true;
                      return;
                    }
                    try {
                      const json = JSON.parse(jsonStr);
                      const delta = json?.choices?.[0]?.delta?.content;
                      if (typeof delta === "string" && delta.length > 0) {
                        gotAnyDelta = true;
                        chunks.push(delta.replace(/\n+/g, "\n"));
                        const current = chunks.join("");
                        if (onProgress && current.length > delivered) {
                          const newChunk = current.slice(delivered);
                          delivered = current.length;
                          Promise.resolve(onProgress(newChunk)).catch((err) =>
                            ztoolkit.log(
                              "[AI-Butler] onProgress callback error:",
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
                ztoolkit.log("[AI-Butler] stream parse error:", err);
              }
            };
            xmlhttp.onerror = () => {
              abortedDueToError = true;
              errorFromProgress = new Error("NetworkError: XHR onerror");
              try {
                xmlhttp.abort();
              } catch {
                /* ignore */
              }
            };
            xmlhttp.ontimeout = () => {
              abortedDueToError = true;
              errorFromProgress = new Error(
                `Timeout: 请求超过 ${options.requestTimeoutMs ?? getRequestTimeoutMs()} ms`,
              );
              try {
                xmlhttp.abort();
              } catch {
                /* ignore */
              }
            };
          },
        });
      } catch (error: any) {
        if (abortedDueToError && errorFromProgress) throw errorFromProgress;
        if (streamComplete && gotAnyDelta) return chunks.join("");
        if (gotAnyDelta && chunks.length > 0) return chunks.join("");
        let errorMessage = "未知错误";
        try {
          const responseText =
            error?.xmlhttp?.response || error?.xmlhttp?.responseText;
          if (responseText) {
            const parsed = JSON.parse(responseText);
            const err = parsed?.error || parsed;
            const code = err?.code || "Error";
            const msg = err?.message || error?.message || String(error);
            errorMessage = `${code}: ${msg}`;
          } else {
            errorMessage = error?.message || String(error);
          }
        } catch {
          errorMessage =
            error?.message || error?.xmlhttp?.statusText || String(error);
        }
        throw new Error(errorMessage);
      }

      const streamed = chunks.join("");
      if (gotAnyDelta && streamed) return streamed;

      // 回退非流式
      return await this.nonStreamCompletion(
        apiUrl,
        apiKey,
        basePayload,
        onProgress,
      );
    }

    return await this.nonStreamCompletion(
      apiUrl,
      apiKey,
      basePayload,
      onProgress,
    );
  }

  async chat(
    pdfContent: string,
    isBase64: boolean,
    conversation: ConversationMessage[],
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string> {
    const apiKey = (options.apiKey || "").trim();
    const apiUrl = (options.apiUrl || "").trim();
    const model = (options.model || "gpt-3.5-turbo").trim();
    const temperature = options.temperature ?? 0.7;

    if (!apiUrl) throw new Error("API URL 未配置");
    if (!apiKey) throw new Error("API Key 未配置");

    if (isBase64) {
      const responsesUrl = /\/v1\/.+$/i.test(apiUrl)
        ? apiUrl.replace(/\/v1\/.+$/i, "/v1/responses")
        : apiUrl.endsWith("/v1/responses")
          ? apiUrl
          : apiUrl.replace(/\/?$/, "/v1/responses");

      const inputs: any[] = [
        {
          role: "developer",
          content: [{ type: "input_text", text: SYSTEM_ROLE_PROMPT }],
        },
      ];

      if (conversation && conversation.length > 0) {
        const firstUser = conversation[0];
        const extraHistoryText = conversation
          .slice(1)
          .map(
            (m) => `${m.role === "assistant" ? "助手" : "用户"}: ${m.content}`,
          )
          .join("\n\n");
        const userParts: any[] = [
          { type: "input_text", text: firstUser.content },
          {
            type: "input_file",
            filename: "paper.pdf",
            file_data: `data:application/pdf;base64,${pdfContent}`,
          },
        ];
        if (extraHistoryText)
          userParts.push({
            type: "input_text",
            text: `以下为过往对话供参考：\n${extraHistoryText}`,
          });
        inputs.push({ role: "user", content: userParts });
      }

      const payload: any = { model, input: inputs, stream: true };

      const chunks: string[] = [];
      let delivered = 0;
      let processedLength = 0;
      let partialLine = "";
      let gotAnyDelta = false;
      let abortError: Error | null = null;

      try {
        await Zotero.HTTP.request("POST", responsesUrl, {
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
                      const t = evt?.type as string;
                      if (
                        t === "response.output_text.delta" &&
                        typeof evt.delta === "string"
                      ) {
                        gotAnyDelta = true;
                        chunks.push(evt.delta.replace(/\n+/g, "\n"));
                        const current = chunks.join("");
                        if (onProgress && current.length > delivered) {
                          const newChunk = current.slice(delivered);
                          delivered = current.length;
                          Promise.resolve(onProgress(newChunk)).catch((err) =>
                            ztoolkit.log(
                              "[AI-Butler] onProgress error (OpenAI Responses chat SSE):",
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
                  "[AI-Butler] OpenAI Responses chat SSE parse error:",
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
        let errorMessage = error?.message || "OpenAI Responses 请求失败";
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

    // 文本模式
    const input: any[] = [{ role: "developer", content: SYSTEM_ROLE_PROMPT }];
    if (conversation && conversation.length > 0) {
      const firstUserMsg = conversation[0];
      if (isBase64) {
        input.push({
          role: "user",
          content: [
            { type: "text", text: firstUserMsg.content },
            {
              type: "image_url",
              image_url: { url: `data:application/pdf;base64,${pdfContent}` },
            },
          ],
        });
      } else {
        input.push({
          role: "user",
          content: buildUserMessage(firstUserMsg.content, pdfContent || ""),
        });
      }
      if (conversation.length > 1) {
        input.push({ role: "assistant", content: conversation[1].content });
      }
      for (let i = 2; i < conversation.length; i++) {
        const msg = conversation[i];
        input.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        });
      }
    }

    const payload = { model, input, temperature, stream: true } as any;

    const chunks: string[] = [];
    let delivered = 0;
    let processedLength = 0;
    let partialLine = "";
    let abortError: Error | null = null;
    let gotAnyDelta = false;

    try {
      await Zotero.HTTP.request("POST", apiUrl, {
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
                ztoolkit.log("[AI-Butler] OpenAI HTTP error:", {
                  status,
                  code,
                  msg,
                  response: errorResponse,
                });
                xmlhttp.abort();
              } catch (parseErr) {
                const errorMessage = `HTTP ${status}: 请求失败`;
                abortError = new Error(errorMessage);
                ztoolkit.log("[AI-Butler] OpenAI HTTP error:", {
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
                  if (jsonStr === "[DONE]") continue;
                  if (!jsonStr) continue;
                  try {
                    const json = JSON.parse(jsonStr);
                    const delta = json?.choices?.[0]?.delta?.content;
                    if (delta) {
                      gotAnyDelta = true;
                      chunks.push(delta.replace(/\n+/g, "\n"));
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
              ztoolkit.log("[AI-Butler] OpenAI stream parse error:", err);
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
      let errorMessage = error?.message || "OpenAI 请求失败";
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
      ztoolkit.log("[AI-Butler] OpenAI request error:", {
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
    const apiKey = (options.apiKey || "").trim();
    const apiUrl = (options.apiUrl || "").trim();
    const model = (options.model || "gpt-5").trim();
    if (!apiUrl) throw new Error("API URL 未配置");
    if (!apiKey) throw new Error("API Key 未配置");

    const responsesUrl = /\/v1\/.+$/i.test(apiUrl)
      ? apiUrl.replace(/\/v1\/.+$/i, "/v1/responses")
      : apiUrl.endsWith("/v1/responses")
        ? apiUrl
        : apiUrl.replace(/\/?$/, "/v1/responses");

    const payload = {
      model,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Hello! Please respond with 'OK' to confirm connection.",
            },
          ],
        },
      ],
      stream: false,
    } as any;
    const payloadStr = JSON.stringify(payload, null, 2);

    let response: any;
    const responseHeaders: Record<string, string> = {};
    try {
      response = await Zotero.HTTP.request("POST", responsesUrl, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
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
      let errorMessage = error?.message || "OpenAI 请求失败";
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
        requestUrl: responsesUrl,
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
      const content = json?.output_text || "";
      return `✅ 连接成功!\n模型: ${model}\n响应: ${content}\n\n--- 原始响应 ---\n${typeof rawResponse === "string" ? rawResponse : JSON.stringify(rawResponse, null, 2)}`;
    }

    const { APITestError } = await import("./types");
    throw new APITestError(`HTTP ${status}`, {
      errorName: `HTTP_${status}`,
      errorMessage: `HTTP ${status}: ${response.statusText || "请求失败"}`,
      statusCode: status,
      requestUrl: responsesUrl,
      requestBody: payloadStr,
      responseHeaders,
      responseBody: rawResponse,
    });
  }

  /**
   * 多文件摘要生成
   * 使用 OpenAI Responses API 发送多个 PDF 文件
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
    const apiKey = (options.apiKey || "").trim();
    const apiUrl = (options.apiUrl || "").trim();
    const model = (options.model || "gpt-4o").trim();

    if (!apiUrl) throw new Error("API URL 未配置");
    if (!apiKey) throw new Error("API Key 未配置");
    if (pdfFiles.length === 0) throw new Error("没有要处理的 PDF 文件");

    // 使用 Responses API
    const responsesUrl = /\/v1\/.+$/i.test(apiUrl)
      ? apiUrl.replace(/\/v1\/.+$/i, "/v1/responses")
      : apiUrl.endsWith("/v1/responses")
        ? apiUrl
        : apiUrl.replace(/\/?$/, "/v1/responses");

    // 构建 input_file 部分
    const fileParts: any[] = [];
    for (let i = 0; i < pdfFiles.length; i++) {
      const pdfFile = pdfFiles[i];
      if (pdfFile.base64Content && pdfFile.base64Content.length > 0) {
        fileParts.push({
          type: "input_file",
          filename: pdfFile.displayName || `document_${i + 1}.pdf`,
          file_data: `data:application/pdf;base64,${pdfFile.base64Content}`,
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
      `[AI-Butler] 准备发送 ${fileParts.length} 个 PDF 附件到 OpenAI`,
    );

    const input: any[] = [
      {
        role: "developer",
        content: [{ type: "input_text", text: SYSTEM_ROLE_PROMPT }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: prompt }, ...fileParts],
      },
    ];

    const payload = { model, input, stream: true } as any;

    const chunks: string[] = [];
    let delivered = 0;
    let processedLength = 0;
    let partialLine = "";
    let gotAnyDelta = false;
    let abortError: Error | null = null;

    try {
      await Zotero.HTTP.request("POST", responsesUrl, {
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
                    const t = evt?.type as string;
                    if (
                      t === "response.output_text.delta" &&
                      typeof evt.delta === "string"
                    ) {
                      gotAnyDelta = true;
                      chunks.push(evt.delta.replace(/\n+/g, "\n"));
                      const current = chunks.join("");
                      if (onProgress && current.length > delivered) {
                        const newChunk = current.slice(delivered);
                        delivered = current.length;
                        Promise.resolve(onProgress(newChunk)).catch((err) =>
                          ztoolkit.log(
                            "[AI-Butler] onProgress error (OpenAI multi-PDF):",
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
                "[AI-Butler] OpenAI multi-PDF SSE parse error:",
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
      let errorMessage = error?.message || "OpenAI 多文件请求失败";
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

  private async nonStreamCompletion(
    apiUrl: string,
    apiKey: string,
    payload: any,
    onProgress?: ProgressCb,
  ): Promise<string> {
    const res = await Zotero.HTTP.request("POST", apiUrl, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      responseType: "json",
    });
    const data = res.response || res;
    const text = data?.choices?.[0]?.message?.content || "";
    const result = typeof text === "string" ? text : JSON.stringify(text);
    if (onProgress && result) await onProgress(result);
    return result;
  }
}

// 自注册
import { ProviderRegistry } from "./ProviderRegistry";
ProviderRegistry.register(new OpenAIProvider());

export default OpenAIProvider;
