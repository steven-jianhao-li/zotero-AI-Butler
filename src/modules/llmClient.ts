/**
 * ================================================================
 * LLM 客户端模块
 * ================================================================
 *
 * 本模块负责与大语言模型 API 进行通信,支持 OpenAI 兼容接口
 *
 * 主要职责:
 * 1. 调用 OpenAI 兼容的 Chat Completions API
 * 2. 管理流式和非流式两种输出模式
 * 3. 解析 Server-Sent Events (SSE) 格式的流式响应
 * 4. 处理 API 错误和网络异常
 * 5. 提供实时进度回调支持
 *
 * 技术实现:
 * - 使用 Zotero.HTTP.request 进行 HTTP POST 调用
 * - 流式模式: 通过 requestObserver.onprogress 解析 SSE 增量数据
 * - 非流式模式: 一次性返回完整响应
 * - 错误处理: 解析 API 错误响应并友好提示用户
 *
 * 支持的服务:
 * - OpenAI ChatGPT API
 * - DeepSeek API
 * - 其他 OpenAI 兼容的 LLM 服务
 *
 * SSE 数据格式:
 * ```
 * data: {"choices":[{"delta":{"content":"增量文本"}}]}
 * data: [DONE]
 * ```
 *
 * 参考实现:
 * - zoterogpt: Zotero GPT 插件的流式实现
 * - papersgpt: Papers GPT 的 SSE 解析逻辑
 *
 * @module llmClient
 * @author AI-Butler Team
 */

import { getPref } from "../utils/prefs";
import {
  getDefaultSummaryPrompt,
  SYSTEM_ROLE_PROMPT,
  buildUserMessage,
} from "../utils/prompts";

/**
 * 进度回调函数类型定义
 *
 * 用于接收流式输出的增量文本
 *
 * @param chunk 本次接收到的增量文本片段
 * @returns Promise 或 void,支持异步和同步回调
 */
type ProgressCb = (chunk: string) => Promise<void> | void;

/**
 * LLM 客户端类
 *
 * 封装大语言模型 API 调用的核心逻辑
 * 提供静态方法接口,简化外部调用
 */
export class LLMClient {
  /**
   * 获取请求超时配置 (毫秒)
   * @private
   */
  private static getRequestTimeout(): number {
    const timeoutStr = (getPref("requestTimeout") as string) || "300000";
    const timeout = parseInt(timeoutStr) || 300000;
    return Math.max(timeout, 30000); // 最小30秒
  }

  /**
   * 生成文献总结 (核心方法)
   *
   * 这是插件与 AI 模型交互的核心入口,支持流式和非流式两种模式
   *
   * 执行流程:
   * 1. 从用户配置读取 API 参数 (URL, Key, Model 等)
   * 2. 验证必需配置项
   * 3. 构造 Chat Completions 请求消息
   * 4. 根据配置选择流式或非流式调用
   * 5. 解析响应并返回完整总结
   *
   * 流式模式特点:
   * - 通过 SSE (Server-Sent Events) 实时接收增量文本
   * - 每接收到新的 token 立即通过 onProgress 回调
   * - 用户可以看到"打字机效果"的实时生成过程
   * - 适合长文本生成,提升用户体验
   *
   * 非流式模式特点:
   * - 一次性接收完整响应
   * - 等待时间较长,但实现简单
   * - 也会触发 onProgress 回调 (一次性传递完整内容)
   *
   * 配置项说明:
   * - apiUrl: API 端点地址 (必需)
   * - apiKey: API 密钥 (必需,除非服务明确不需要)
   * - model: 模型名称 (默认 gpt-3.5-turbo)
   * - temperature: 生成温度 0-1 (默认 0.7)
   * - summaryPrompt: 自定义提示词 (可选)
   * - stream: 是否启用流式输出 (默认 true)
   *
   * 错误处理:
   * - 配置缺失: 提示用户并抛出异常
   * - HTTP 错误: 解析 API 错误响应并显示友好消息
   * - 网络超时: 300秒超时保护
   * - 解析失败: 记录日志并优雅降级
   *
   * @param fullText 文献全文 (已清理和截断)
   * @param prompt 可选的自定义提示词,未提供则使用配置中的 summaryPrompt
   * @param onProgress 流式输出回调函数,接收增量文本片段
   * @returns 完整的 AI 生成总结文本
   * @throws 配置错误、API 错误或网络异常时抛出
   *
   * @example
   * ```typescript
   * const summary = await LLMClient.generateSummary(
   *   pdfText,
   *   undefined,
   *   (chunk) => {
   *     console.log("接收到增量:", chunk);
   *   }
   * );
   * ```
   */
  static async generateSummary(
    content: string,
    isBase64: boolean = false,
    prompt?: string,
    onProgress?: ProgressCb,
  ): Promise<string> {
    // Provider 分支: 判断使用哪个供应商
    const provider = (
      (getPref("provider" as any) as string) || "openai"
    ).trim();
    
    if (provider === "google" || provider.toLowerCase().includes("gemini")) {
      return await LLMClient.generateWithGemini(
        content,
        isBase64,
        prompt,
        onProgress,
      );
    }
    
    if (provider === "anthropic" || provider.toLowerCase().includes("claude")) {
      return await LLMClient.generateWithAnthropic(
        content,
        isBase64,
        prompt,
        onProgress,
      );
    }

    // OpenAI 模式只支持文本,如果传入Base64则提示错误
    if (isBase64) {
      throw new Error(
        "OpenAI 模式不支持 Base64 PDF 处理,请切换到 Google Gemini/Anthropic 或使用文本提取模式",
      );
    }
    // ⚡ 动态读取配置 - 每次调用都会重新获取最新设置
    // 这确保了用户在设置页面修改后立即生效,无需重启 Zotero
    const apiKey = ((getPref("apiKey" as any) as string) || "").trim();
    const apiUrl = ((getPref("apiUrl" as any) as string) || "").trim();
    const model = (
      (getPref("model" as any) as string) || "gpt-3.5-turbo"
    ).trim();

    const temperatureStr = (getPref("temperature") as string) || "0.7";
    const temperature = parseFloat(temperatureStr) || 0.7;

    // 获取提示词,优先使用参数传入的,其次使用配置的,最后使用默认值
    const savedPrompt = getPref("summaryPrompt") as string;
    const summaryPrompt =
      prompt ||
      (savedPrompt && savedPrompt.trim()
        ? savedPrompt
        : getDefaultSummaryPrompt());
    const streamEnabled = (getPref("stream") as boolean) ?? true;

    // 基本配置验证
    if (!apiUrl) {
      LLMClient.notifyError("API URL 未配置");
      throw new Error("API URL 未配置");
    }
    // 大多数 LLM 服务需要 API Key
    // 如果您的服务不需要,可以在配置界面留空并移除此检查
    if (!apiKey) {
      LLMClient.notifyError("API Key 未配置");
      throw new Error("API Key 未配置");
    }

    // 构造 Chat Completions API 请求消息数组
    const messages = LLMClient.buildMessages(summaryPrompt, content);

    // 构造请求载荷的基础部分
    const basePayload = {
      model,
      messages,
      temperature: Number(temperature),
    } as any;

    // 允许自定义服务直接使用配置的完整 URL（兼容 OpenAI/DeepSeek/OpenAI兼容服务）
    // 如果用户配置错误的末尾斜杠，不做强制修正，保持“照搬”逻辑

    // 累积结果与增量下发
    // 分支：流式 or 非流式
    if (streamEnabled && onProgress) {
      const body = JSON.stringify({ ...basePayload, stream: true });
      const chunks: string[] = [];
      let delivered = 0; // 已下发给 onProgress 的字符长度
      let gotAnyDelta = false;
      let processedLength = 0; // 已处理的响应长度，避免重复解析
      let partialLine = ""; // 进度事件之间可能存在被截断的半行 JSON
      let streamComplete = false; // 流是否正常结束
      let abortedDueToError = false; // 是否因错误而中止
      let errorFromProgress: Error | null = null; // 从 onprogress 中捕获的错误

      try {
        await Zotero.HTTP.request("POST", apiUrl, {
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body,
          responseType: "text",
          timeout: LLMClient.getRequestTimeout(),
          requestObserver: (xmlhttp: XMLHttpRequest) => {
            xmlhttp.onprogress = (e: any) => {
              const status = e.target.status;

              // 检查 HTTP 状态码，如果是错误状态，尝试解析错误信息
              if (status >= 400) {
                try {
                  const errorResponse = e.target.response;
                  if (errorResponse) {
                    // 尝试解析错误 JSON
                    const parsed = JSON.parse(errorResponse);
                    const err = parsed?.error || parsed;
                    const code = err?.code || `HTTP ${status}`;
                    const msg = err?.message || "请求失败";
                    const errorMessage = `${code}: ${msg}`;
                    LLMClient.notifyError(errorMessage);
                    // 设置错误标志
                    abortedDueToError = true;
                    errorFromProgress = new Error(errorMessage);
                    // 中止请求
                    xmlhttp.abort();
                  }
                } catch (parseErr) {
                  const errorMessage = `HTTP ${status}: 请求失败`;
                  LLMClient.notifyError(errorMessage);
                  abortedDueToError = true;
                  errorFromProgress = new Error(errorMessage);
                  xmlhttp.abort();
                }
                return;
              }

              try {
                const resp: string = e.target.response || "";
                if (resp.length > processedLength) {
                  // 仅处理新增的响应文本，拼接上一次遗留的半行
                  const slice = partialLine + resp.slice(processedLength);
                  processedLength = resp.length;
                  const parts = slice.split(/\r?\n/);
                  // 若最后一段不是完整行，则缓存为 partial，下次继续
                  partialLine =
                    parts[parts.length - 1].indexOf("data: ") === 0 &&
                    slice.indexOf("\n", slice.length - 1) === slice.length - 1
                      ? ""
                      : parts.pop() || "";

                  for (const raw of parts) {
                    if (raw.indexOf("data: ") !== 0) continue;
                    const jsonStr = raw.replace(/^data:\s*/, "").trim();

                    if (jsonStr === "[DONE]") {
                      // 收到结束信号：标记完成
                      streamComplete = true;
                      return;
                    }

                    try {
                      const json = JSON.parse(jsonStr);
                      // OpenAI/DeepSeek 兼容：choices[0].delta.content
                      const delta = json?.choices?.[0]?.delta?.content;
                      if (typeof delta === "string" && delta.length > 0) {
                        gotAnyDelta = true;
                        chunks.push(delta.replace(/\n+/g, "\n"));
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
                      // 忽略无法解析的行
                    }
                  }
                }
              } catch (err) {
                ztoolkit.log("[AI-Butler] stream parse error:", err);
              }
            };

            // 网络错误与超时：如果已收到部分增量，则允许在外层以“部分结果”方式返回
            xmlhttp.onerror = () => {
              abortedDueToError = true;
              errorFromProgress = new Error("NetworkError: XHR onerror");
              try {
                xmlhttp.abort();
              } catch {}
            };

            xmlhttp.ontimeout = () => {
              abortedDueToError = true;
              errorFromProgress = new Error(
                `Timeout: 请求超过 ${LLMClient.getRequestTimeout()} ms`,
              );
              try {
                xmlhttp.abort();
              } catch {}
            };

            xmlhttp.onloadend = () => {
              const status = xmlhttp.status;

              // 检查 HTTP 状态码
              if (status >= 400) {
                // 错误会在外层 catch 中处理
                return;
              }
            };
          },
        });
      } catch (error: any) {
        // 检查是否是因为错误而主动中止的
        if (abortedDueToError && errorFromProgress) {
          throw errorFromProgress;
        }

        // 检查是否是正常的流结束（有些API在收到[DONE]后会关闭连接导致"错误"）
        if (streamComplete && gotAnyDelta) {
          return chunks.join("");
        }

        // 如果虽然发生错误，但已经接收到部分内容，则返回已接收内容
        if (gotAnyDelta && chunks.length > 0) {
          return chunks.join("");
        }

        // 真正的错误 - 记录完整错误信息
        ztoolkit.log("[AI-Butler] Stream request failed:", {
          status: error?.xmlhttp?.status,
          statusText: error?.xmlhttp?.statusText,
          response: error?.xmlhttp?.response,
          message: error?.message,
        });

        // 解析并显示错误
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
        } catch (parseError) {
          errorMessage =
            error?.message || error?.xmlhttp?.statusText || String(error);
        }

        LLMClient.notifyError(errorMessage);
        throw new Error(errorMessage);
      }

      const streamed = chunks.join("");
      if (gotAnyDelta && streamed) {
        return streamed;
      }

      // 若未拿到任何增量，回退到非流式
      return await LLMClient.nonStreamCompletion(
        apiUrl,
        apiKey,
        basePayload,
        onProgress,
      );
    } else {
      // 非流式：一次性拿到完整文本（也传递 onProgress 以支持弹出窗口显示）
      return await LLMClient.nonStreamCompletion(
        apiUrl,
        apiKey,
        basePayload,
        onProgress,
      );
    }
  }

  /** 使用 Google Gemini 生成总结(流式优先,SSE) */
  private static async generateWithGemini(
    content: string,
    isBase64: boolean = false,
    prompt?: string,
    onProgress?: ProgressCb,
  ): Promise<string> {
    const baseUrl = (
      (getPref("geminiApiUrl" as any) as string) ||
      "https://generativelanguage.googleapis.com"
    ).replace(/\/$/, "");
    const apiKey = ((getPref("geminiApiKey" as any) as string) || "").trim();
    const model = (
      (getPref("geminiModel" as any) as string) || "gemini-2.5-pro"
    ).trim();

    const temperatureStr = (getPref("temperature") as string) || "0.7";
    const topPStr = (getPref("topP") as string) || "1.0";
    const maxTokensStr = (getPref("maxTokens") as string) || "4096";
    const temperature = parseFloat(temperatureStr) || 0.7;
    const topP = parseFloat(topPStr) || 1.0;
    const maxTokens = parseInt(maxTokensStr) || 4096;

    // 提示词
    const savedPrompt = getPref("summaryPrompt") as string;
    const summaryPrompt =
      prompt ||
      (savedPrompt && savedPrompt.trim()
        ? savedPrompt
        : getDefaultSummaryPrompt());

    if (!baseUrl) {
      LLMClient.notifyError("Gemini API URL 未配置");
      throw new Error("Gemini API URL 未配置");
    }
    if (!apiKey) {
      LLMClient.notifyError("Gemini API Key 未配置");
      throw new Error("Gemini API Key 未配置");
    }

    const endpoint = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

    // 根据是否为 Base64 构造不同的 payload
    let payload: any;

    if (isBase64) {
      // Base64 模式: 使用 inlineData 发送 PDF
      payload = {
        generationConfig: {
          temperature,
          topP,
          maxOutputTokens: maxTokens,
        },
        contents: [
          {
            role: "user",
            parts: [
              { text: summaryPrompt },
              {
                inlineData: {
                  mimeType: "application/pdf",
                  data: content,
                },
              },
            ],
          },
        ],
        systemInstruction: {
          parts: [{ text: SYSTEM_ROLE_PROMPT }],
        },
      };
    } else {
      // 文本模式: 使用文本内容
      const userContent = buildUserMessage(summaryPrompt, content);
      payload = {
        generationConfig: {
          temperature,
          topP,
          maxOutputTokens: maxTokens,
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userContent }],
          },
        ],
        systemInstruction: {
          parts: [{ text: SYSTEM_ROLE_PROMPT }],
        },
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
        timeout: LLMClient.getRequestTimeout(),
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
                LLMClient.notifyError(errorMessage);
                xmlhttp.abort();
              } catch {
                LLMClient.notifyError(`HTTP ${status}: 请求失败`);
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
                  if (!jsonStr) continue;
                  try {
                    const json = JSON.parse(jsonStr);
                    const text = LLMClient.extractGeminiText(json);
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
                  } catch (e) {
                    // 忽略无法解析的 SSE 行，继续处理后续数据
                    continue;
                  }
                }
              }
            } catch (err) {
              ztoolkit.log("[AI-Butler] Gemini stream parse error:", err);
            }
          };
          // 网络错误与超时：如果已收到部分增量，则在外层允许返回部分内容
          xmlhttp.onerror = () => {
            // 让请求失败，外层根据 gotAnyDelta 决定是否返回部分内容
          };
          xmlhttp.ontimeout = () => {
            // 让请求失败，外层根据 gotAnyDelta 决定是否返回部分内容
          };
        },
      });
    } catch (error: any) {
      // 记录错误
      ztoolkit.log("[AI-Butler] Gemini request failed:", {
        status: error?.xmlhttp?.status,
        statusText: error?.xmlhttp?.statusText,
        response: error?.xmlhttp?.response,
        message: error?.message,
      });
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
      } catch (e) {
        // 解析错误响应失败时忽略，保留默认错误消息
        ztoolkit.log("[AI-Butler] Failed to parse Gemini error response");
      }
      // 如果已有增量，优先返回部分内容，避免“状态0”导致整段丢失
      if (gotAnyDelta && chunks.length > 0) {
        return chunks.join("");
      }
      LLMClient.notifyError(errorMessage);
      throw new Error(errorMessage);
    }

    const streamed = chunks.join("");
    if (gotAnyDelta && streamed) return streamed;
    // 若未拿到任何内容，返回空串
    return "";
  }

  /** 提取 Gemini SSE 事件中的文本内容 */
  private static extractGeminiText(json: any): string {
    try {
      // 优先尝试 candidates[0].content.parts[].text
      const cand0 = json?.candidates?.[0];
      if (!cand0) return "";
      // delta 结构
      const deltaParts = cand0?.delta?.content?.parts || cand0?.delta?.parts;
      if (Array.isArray(deltaParts)) {
        return deltaParts.map((p: any) => p?.text || "").join("");
      }
      // content 累积结构
      const parts = cand0?.content?.parts;
      if (Array.isArray(parts)) {
        return parts.map((p: any) => p?.text || "").join("");
      }
      // 部分实现 candidates[0].content?.parts?.[0]?.text
      const text = cand0?.content?.parts?.[0]?.text || cand0?.text;
      return typeof text === "string" ? text : "";
    } catch {
      return "";
    }
  }

  /** 使用 Anthropic Claude 生成总结(流式优先,SSE) */
  private static async generateWithAnthropic(
    content: string,
    isBase64: boolean = false,
    prompt?: string,
    onProgress?: ProgressCb,
  ): Promise<string> {
    const baseUrl = (
      (getPref("anthropicApiUrl" as any) as string) ||
      "https://api.anthropic.com"
    ).replace(/\/$/, "");
    const apiKey = ((getPref("anthropicApiKey" as any) as string) || "").trim();
    const model = (
      (getPref("anthropicModel" as any) as string) || "claude-3-5-sonnet-20241022"
    ).trim();

    const temperatureStr = (getPref("temperature") as string) || "0.7";
    const maxTokensStr = (getPref("maxTokens") as string) || "4096";
    const temperature = parseFloat(temperatureStr) || 0.7;
    const maxTokens = parseInt(maxTokensStr) || 4096;

    // 提示词
    const savedPrompt = getPref("summaryPrompt") as string;
    const summaryPrompt =
      prompt ||
      (savedPrompt && savedPrompt.trim()
        ? savedPrompt
        : getDefaultSummaryPrompt());

    if (!baseUrl) {
      LLMClient.notifyError("Anthropic API URL 未配置");
      throw new Error("Anthropic API URL 未配置");
    }
    if (!apiKey) {
      LLMClient.notifyError("Anthropic API Key 未配置");
      throw new Error("Anthropic API Key 未配置");
    }

    const endpoint = `${baseUrl}/v1/messages`;

    // 根据是否为 Base64 构造不同的 payload
    let payload: any;

    if (isBase64) {
      // Base64 模式: 使用 document 发送 PDF
      payload = {
        model,
        max_tokens: maxTokens,
        temperature,
        system: SYSTEM_ROLE_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: summaryPrompt,
              },
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
      // 文本模式: 使用文本内容
      const userContent = buildUserMessage(summaryPrompt, content);
      payload = {
        model,
        max_tokens: maxTokens,
        temperature,
        system: SYSTEM_ROLE_PROMPT,
        messages: [
          {
            role: "user",
            content: userContent,
          },
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
        timeout: LLMClient.getRequestTimeout(),
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
                LLMClient.notifyError(errorMessage);
                xmlhttp.abort();
              } catch {
                LLMClient.notifyError(`HTTP ${status}: 请求失败`);
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
                    // Anthropic 流式响应: 
                    // event: content_block_delta
                    // data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"增量文本"}}
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
                  } catch (e) {
                    // 忽略无法解析的 SSE 行，继续处理后续数据
                    continue;
                  }
                }
              }
            } catch (err) {
              ztoolkit.log("[AI-Butler] Anthropic stream parse error:", err);
            }
          };
          // 网络错误与超时：如果已收到部分增量，则在外层允许返回部分内容
          xmlhttp.onerror = () => {
            // 让请求失败，外层根据 gotAnyDelta 决定是否返回部分内容
          };
          xmlhttp.ontimeout = () => {
            // 让请求失败，外层根据 gotAnyDelta 决定是否返回部分内容
          };
        },
      });
    } catch (error: any) {
      // 记录错误
      ztoolkit.log("[AI-Butler] Anthropic request failed:", {
        status: error?.xmlhttp?.status,
        statusText: error?.xmlhttp?.statusText,
        response: error?.xmlhttp?.response,
        message: error?.message,
      });
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
      } catch (e) {
        // 解析错误响应失败时忽略，保留默认错误消息
        ztoolkit.log("[AI-Butler] Failed to parse Anthropic error response");
      }
      if (gotAnyDelta && chunks.length > 0) {
        return chunks.join("");
      }
      LLMClient.notifyError(errorMessage);
      throw new Error(errorMessage);
    }

    const streamed = chunks.join("");
    if (gotAnyDelta && streamed) return streamed;
    // 若未拿到任何内容，返回空串
    return "";
  }

  /**
   * 构造 Chat Completions API 消息数组
   *
   * 按照 OpenAI Chat Completions API 规范构造消息列表
   *
   * 消息结构:
   * 1. system 消息: 定义 AI 的角色和行为规范
   * 2. user 消息: 包含提示词和文献全文
   *
   * @param prompt 总结生成的提示词模板
   * @param text 文献全文内容
   * @returns 符合 Chat Completions API 规范的消息数组
   *
   * @private
   */
  private static buildMessages(prompt: string, text: string) {
    return [
      { role: "system", content: SYSTEM_ROLE_PROMPT },
      { role: "user", content: buildUserMessage(prompt, text) },
    ];
  }

  /**
   * 显示错误通知
   *
   * 在 Zotero 界面中弹出进度窗口显示错误消息
   * 使用 ztoolkit.ProgressWindow 实现非阻塞式提示
   *
   * @param message 错误消息文本
   *
   * @private
   */
  private static notifyError(message: string) {
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOtherProgressWindows: false,
    })
      .createLine({ text: message, type: "default" })
      .show();
  }

  /**
   * 非流式模式完成调用
   *
   * 一次性发送请求并等待完整响应返回
   * 适合不需要实时反馈或网络较快的场景
   *
   * 执行流程:
   * 1. 发送 POST 请求到 API 端点
   * 2. 等待完整响应返回
   * 3. 解析 choices[0].message.content
   * 4. 如果有 onProgress 回调,一次性传递完整内容
   * 5. 返回完整文本
   *
   * 错误处理:
   * - 解析 API 返回的错误 JSON
   * - 提取错误码和错误消息
   * - 通过 notifyError 显示给用户
   * - 抛出包含详细信息的异常
   *
   * @param apiUrl API 端点地址
   * @param apiKey API 密钥
   * @param payload 请求载荷对象
   * @param onProgress 可选的进度回调 (会一次性接收完整内容)
   * @returns 完整的 AI 生成文本
   * @throws API 错误或网络异常时抛出
   *
   * @private
   */
  private static async nonStreamCompletion(
    apiUrl: string,
    apiKey: string,
    payload: any,
    onProgress?: ProgressCb,
  ): Promise<string> {
    try {
      // 发送 HTTP POST 请求
      const res = await Zotero.HTTP.request("POST", apiUrl, {
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
        responseType: "json",
      });

      // 解析响应数据
      const data = res.response || res;

      // 提取 AI 生成的文本内容
      // OpenAI 兼容格式: choices[0].message.content
      const text = data?.choices?.[0]?.message?.content || "";
      const result = typeof text === "string" ? text : JSON.stringify(text);

      // 如果提供了 onProgress 回调,传递完整内容
      // 这样即使是非流式模式,输出窗口也能显示结果
      if (onProgress && result) {
        try {
          await onProgress(result);
        } catch (err) {
          ztoolkit.log("[AI Butler] 非流式模式 onProgress 回调错误:", err);
        }
      }

      return result;
    } catch (error: any) {
      // 解析并显示友好的错误消息
      let errorMessage = "未知错误";
      try {
        const responseText =
          error?.xmlhttp?.response || error?.xmlhttp?.responseText;
        if (responseText) {
          // 尝试解析错误响应的 JSON
          const parsed =
            typeof responseText === "string"
              ? JSON.parse(responseText)
              : responseText;
          const err = parsed?.error || parsed;
          const code = err?.code || "Error";
          const msg = err?.message || error?.message || String(error);
          errorMessage = `${code}: ${msg}`;
        } else {
          errorMessage = error?.message || String(error);
        }
      } catch (parseError) {
        // JSON 解析失败,使用原始错误消息
        errorMessage =
          error?.message || error?.xmlhttp?.statusText || String(error);
      }

      // 显示错误通知
      LLMClient.notifyError(errorMessage);
      throw new Error(errorMessage);
    }
  }

  /**
   * 测试 API 连接
   *
   * 用于验证用户配置的 API 是否可用
   * 发送一个简单的测试请求来检查连接性和身份验证
   *
   * @returns 测试结果消息
   * @throws API 错误或网络异常
   */
  static async testConnection(): Promise<string> {
    const provider = (
      (getPref("provider" as any) as string) || "openai"
    ).trim();
    
    if (provider === "google" || provider.toLowerCase().includes("gemini")) {
      const baseUrl = (
        (getPref("geminiApiUrl" as any) as string) ||
        "https://generativelanguage.googleapis.com"
      ).replace(/\/$/, "");
      const apiKey = ((getPref("geminiApiKey" as any) as string) || "").trim();
      const model = (
        (getPref("geminiModel" as any) as string) || "gemini-2.5-pro"
      ).trim();
      if (!baseUrl) throw new Error("Gemini API URL 未配置");
      if (!apiKey) throw new Error("Gemini API Key 未配置");
      const url = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const payload = {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: "Hello! Please respond with 'OK' to confirm connection.",
              },
            ],
          },
        ],
        systemInstruction: { parts: [{ text: SYSTEM_ROLE_PROMPT }] },
        generationConfig: { temperature: 0.1, topP: 1.0, maxOutputTokens: 16 },
      };
      try {
        const response = await Zotero.HTTP.request("POST", url, {
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify(payload),
          responseType: "json",
          timeout: 30000,
        });
        if (response.status === 200) {
          const json =
            typeof response.response === "string"
              ? JSON.parse(response.response)
              : response.response;
          const text =
            json?.candidates?.[0]?.content?.parts
              ?.map((p: any) => p?.text || "")
              .join("") || "";
          return `✅ 连接成功!\n模型: ${model}\n响应: ${text}`;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      } catch (error: any) {
        let errorMessage = error?.message || "连接失败";
        try {
          const errorResponse =
            error?.xmlhttp?.response || error?.xmlhttp?.responseText;
          if (errorResponse) {
            const parsed =
              typeof errorResponse === "string"
                ? JSON.parse(errorResponse)
                : errorResponse;
            const err = parsed?.error || parsed;
            const code =
              err?.code || `HTTP ${error?.xmlhttp?.status || "Unknown"}`;
            const msg = err?.message || "请求失败";
            errorMessage = `${code}: ${msg}`;
          }
        } catch (e) {
          // 忽略错误响应解析失败，使用默认错误信息
          ztoolkit.log("[AI-Butler] Failed to parse testConnection error");
        }
        throw new Error(errorMessage);
      }
    }
    
    if (provider === "anthropic" || provider.toLowerCase().indexOf("claude") !== -1) {
      const baseUrl = (
        (getPref("anthropicApiUrl" as any) as string) ||
        "https://api.anthropic.com"
      ).replace(/\/$/, "");
      const apiKey = ((getPref("anthropicApiKey" as any) as string) || "").trim();
      const model = (
        (getPref("anthropicModel" as any) as string) || "claude-3-5-sonnet-20241022"
      ).trim();
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
      };
      try {
        const response = await Zotero.HTTP.request("POST", url, {
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(payload),
          responseType: "json",
          timeout: 30000,
        });
        if (response.status === 200) {
          const json =
            typeof response.response === "string"
              ? JSON.parse(response.response)
              : response.response;
          const text =
            json?.content?.[0]?.text || "";
          return `✅ 连接成功!\n模型: ${model}\n响应: ${text}`;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      } catch (error: any) {
        let errorMessage = error?.message || "连接失败";
        try {
          const errorResponse =
            error?.xmlhttp?.response || error?.xmlhttp?.responseText;
          if (errorResponse) {
            const parsed =
              typeof errorResponse === "string"
                ? JSON.parse(errorResponse)
                : errorResponse;
            const err = parsed?.error || parsed;
            const code =
              err?.type || `HTTP ${error?.xmlhttp?.status || "Unknown"}`;
            const msg = err?.message || "请求失败";
            errorMessage = `${code}: ${msg}`;
          }
        } catch (e) {
          // 忽略错误响应解析失败，使用默认错误信息
          ztoolkit.log("[AI-Butler] Failed to parse testConnection error");
        }
        throw new Error(errorMessage);
      }
    }

    // OpenAI / 兼容 实现（原有逻辑）
    const apiKey = ((getPref("apiKey" as any) as string) || "").trim();
    const apiUrl = ((getPref("apiUrl" as any) as string) || "").trim();
    const model = (
      (getPref("model" as any) as string) || "gpt-3.5-turbo"
    ).trim();

    if (!apiUrl) throw new Error("API URL 未配置");
    if (!apiKey) throw new Error("API Key 未配置");

    const payload = {
      model,
      messages: [
        {
          role: "user",
          content: "Hello! Please respond with 'OK' to confirm connection.",
        },
      ],
      max_tokens: 10,
      temperature: 0.1,
      stream: false,
    };

    try {
      const response = await Zotero.HTTP.request("POST", apiUrl, {
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
        responseType: "json",
        timeout: 30000,
      });
      if (response.status === 200) {
        const json =
          typeof response.response === "string"
            ? JSON.parse(response.response)
            : response.response;
        const content = json?.choices?.[0]?.message?.content || "";
        return `✅ 连接成功!\n模型: ${model}\n响应: ${content}`;
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error: any) {
      let errorMessage = "连接失败";
      try {
        const errorResponse = error?.xmlhttp?.response;
        if (errorResponse) {
          const parsed =
            typeof errorResponse === "string"
              ? JSON.parse(errorResponse)
              : errorResponse;
          const err = parsed?.error || parsed;
          const code =
            err?.code || `HTTP ${error?.xmlhttp?.status || "Unknown"}`;
          const msg = err?.message || "请求失败";
          errorMessage = `${code}: ${msg}`;
        } else {
          errorMessage = error?.message || String(error);
        }
      } catch (parseError) {
        errorMessage = error?.message || String(error);
      }
      throw new Error(errorMessage);
    }
  }

  /**
   * 多轮对话接口
   * 
   * 用于后续追问功能,支持完整的对话历史和PDF上下文
   * 
   * @param pdfContent PDF内容 (Base64或文本)
   * @param isBase64 是否为Base64编码
   * @param conversationHistory 对话历史 [{role: 'user'|'assistant', content: string}]
   * @param onProgress 流式输出回调
   * @returns AI 的回复
   */
  static async chat(
    pdfContent: string,
    isBase64: boolean,
    conversationHistory: Array<{ role: string; content: string }>,
    onProgress?: ProgressCb,
  ): Promise<string> {
    const provider = (
      (getPref("provider" as any) as string) || "openai"
    ).trim();

    if (provider === "google" || provider.toLowerCase().indexOf("gemini") !== -1) {
      return await LLMClient.chatWithGemini(
        pdfContent,
        isBase64,
        conversationHistory,
        onProgress,
      );
    }

    if (provider === "anthropic" || provider.toLowerCase().indexOf("claude") !== -1) {
      return await LLMClient.chatWithAnthropic(
        pdfContent,
        isBase64,
        conversationHistory,
        onProgress,
      );
    }

    // OpenAI 不支持 Base64 PDF
    if (isBase64) {
      throw new Error(
        "OpenAI 模式不支持 Base64 PDF 处理,请切换到 Google Gemini/Anthropic 或使用文本提取模式",
      );
    }

    return await LLMClient.chatWithOpenAI(
      pdfContent,
      conversationHistory,
      onProgress,
    );
  }

  /**
   * OpenAI 对话实现
   */
  private static async chatWithOpenAI(
    pdfContent: string,
    conversationHistory: Array<{ role: string; content: string }>,
    onProgress?: ProgressCb,
  ): Promise<string> {
    const apiKey = ((getPref("apiKey" as any) as string) || "").trim();
    const apiUrl = ((getPref("apiUrl" as any) as string) || "").trim();
    const model = (
      (getPref("model" as any) as string) || "gpt-3.5-turbo"
    ).trim();
    const temperatureStr = (getPref("temperature") as string) || "0.7";
    const temperature = parseFloat(temperatureStr) || 0.7;

    if (!apiUrl) throw new Error("API URL 未配置");
    if (!apiKey) throw new Error("API Key 未配置");

    const savedPrompt = getPref("summaryPrompt") as string;
    const summaryPrompt = savedPrompt && savedPrompt.trim()
      ? savedPrompt
      : getDefaultSummaryPrompt();

    // 构造消息：始终保证第一条用户消息为“默认提示词+论文内容”，第二条为“AI总结”，其余原样
    const messages: any[] = [
      { role: "system", content: SYSTEM_ROLE_PROMPT },
    ];

    if (conversationHistory && conversationHistory.length > 0) {
      const firstUserMsg = conversationHistory[0];
      messages.push({
        role: "user",
        content: buildUserMessage(firstUserMsg.content, pdfContent || ""),
      });

      if (conversationHistory.length > 1) {
        messages.push({
          role: "assistant",
          content: conversationHistory[1].content,
        });
      }

      for (let i = 2; i < conversationHistory.length; i++) {
        const msg = conversationHistory[i];
        messages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        });
      }
    }

    const payload = {
      model,
      messages,
      temperature,
      stream: true,
    };

    const chunks: string[] = [];
    let delivered = 0;
    let processedLength = 0;
  let partialLine = "";
  let abortError: Error | null = null; // 记录主动中止的错误
  let gotAnyDelta = false; // 是否收到过增量

    try {
      await Zotero.HTTP.request("POST", apiUrl, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        responseType: "text",
        timeout: LLMClient.getRequestTimeout(),
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
                ztoolkit.log("[AI-Butler] OpenAI HTTP error:", { status, code, msg, response: errorResponse });
                xmlhttp.abort();
              } catch (parseErr) {
                const errorMessage = `HTTP ${status}: 请求失败`;
                abortError = new Error(errorMessage);
                ztoolkit.log("[AI-Butler] OpenAI HTTP error:", { status, parseErr });
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
                    continue;
                  }
                }
              }
            } catch (err) {
              ztoolkit.log("[AI-Butler] OpenAI stream parse error:", err);
            }
          };
          xmlhttp.onerror = () => {
            if (!abortError) {
              abortError = new Error("NetworkError: XHR onerror");
            }
          };
          xmlhttp.ontimeout = () => {
            if (!abortError) {
              abortError = new Error(`Timeout: 请求超过 ${LLMClient.getRequestTimeout()} ms`);
            }
          };
        },
      });
    } catch (error: any) {
      // 如果是主动中止的错误,直接抛出
      if (abortError) {
        if (gotAnyDelta && chunks.length > 0) {
          return chunks.join("");
        }
        throw abortError;
      }

      // 否则解析错误响应
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
      } catch (e) {
        // 忽略解析错误
      }
      
      ztoolkit.log("[AI-Butler] OpenAI request error:", {
        status: error?.xmlhttp?.status,
        statusText: error?.xmlhttp?.statusText,
        message: errorMessage,
      });
      
      if (gotAnyDelta && chunks.length > 0) {
        return chunks.join("");
      }
      throw new Error(errorMessage);
    }

    return chunks.join("");
  }

  /**
   * Gemini 对话实现
   */
  private static async chatWithGemini(
    pdfContent: string,
    isBase64: boolean,
    conversationHistory: Array<{ role: string; content: string }>,
    onProgress?: ProgressCb,
  ): Promise<string> {
    const baseUrl = (
      (getPref("geminiApiUrl" as any) as string) ||
      "https://generativelanguage.googleapis.com"
    ).replace(/\/$/, "");
    const apiKey = ((getPref("geminiApiKey" as any) as string) || "").trim();
    const model = (
      (getPref("geminiModel" as any) as string) || "gemini-2.5-pro"
    ).trim();
    const temperatureStr = (getPref("temperature") as string) || "0.7";
    const temperature = parseFloat(temperatureStr) || 0.7;

    if (!baseUrl) throw new Error("Gemini API URL 未配置");
    if (!apiKey) throw new Error("Gemini API Key 未配置");

    const endpoint = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

    const savedPrompt = getPref("summaryPrompt") as string;
    const summaryPrompt = savedPrompt && savedPrompt.trim()
      ? savedPrompt
      : getDefaultSummaryPrompt();

    // Gemini 格式: contents数组,交替user/model
    const contents: any[] = [];

    // 始终保证第一条为“默认提示词+论文”，第二条为“AI总结”，其余原样
    if (conversationHistory && conversationHistory.length > 0) {
      const firstUserMsg = conversationHistory[0];
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
          parts: [{ text: buildUserMessage(firstUserMsg.content, pdfContent || "") }],
        });
      }

      if (conversationHistory.length > 1) {
        contents.push({ role: "model", parts: [{ text: conversationHistory[1].content }] });
      }

      for (let i = 2; i < conversationHistory.length; i++) {
        const msg = conversationHistory[i];
        contents.push({ role: msg.role === "user" ? "user" : "model", parts: [{ text: msg.content }] });
      }
    }

    const payload = {
      generationConfig: { temperature },
      contents,
      systemInstruction: { parts: [{ text: SYSTEM_ROLE_PROMPT }] },
    };

  const chunks: string[] = [];
  let delivered = 0;
  let processedLength = 0;
  let partialLine = "";
  let abortError: Error | null = null; // 记录主动中止的错误
  let gotAnyDelta = false;

    try {
      await Zotero.HTTP.request("POST", endpoint, {
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(payload),
        responseType: "text",
        timeout: LLMClient.getRequestTimeout(),
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
                ztoolkit.log("[AI-Butler] Gemini HTTP error:", { status, code, msg, response: errorResponse });
                xmlhttp.abort();
              } catch (parseErr) {
                const errorMessage = `HTTP ${status}: 请求失败`;
                abortError = new Error(errorMessage);
                ztoolkit.log("[AI-Butler] Gemini HTTP error:", { status, parseErr });
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
                    const text = LLMClient.extractGeminiText(json);
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
                    continue;
                  }
                }
              }
            } catch (err) {
              ztoolkit.log("[AI-Butler] Gemini stream parse error:", err);
            }
          };
          xmlhttp.onerror = () => {
            if (!abortError) abortError = new Error("NetworkError: XHR onerror");
          };
          xmlhttp.ontimeout = () => {
            if (!abortError)
              abortError = new Error(`Timeout: 请求超过 ${LLMClient.getRequestTimeout()} ms`);
          };
        },
      });
    } catch (error: any) {
      // 如果是主动中止的错误,直接抛出
      if (abortError) {
        if (gotAnyDelta && chunks.length > 0) {
          return chunks.join("");
        }
        throw abortError;
      }

      // 否则解析错误响应
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
      } catch (e) {
        // 忽略解析错误
      }
      
      ztoolkit.log("[AI-Butler] Gemini request error:", {
        status: error?.xmlhttp?.status,
        statusText: error?.xmlhttp?.statusText,
        message: errorMessage,
      });
      
      if (gotAnyDelta && chunks.length > 0) {
        return chunks.join("");
      }
      throw new Error(errorMessage);
    }

    return chunks.join("");
  }

  /**
   * Anthropic 对话实现
   */
  private static async chatWithAnthropic(
    pdfContent: string,
    isBase64: boolean,
    conversationHistory: Array<{ role: string; content: string }>,
    onProgress?: ProgressCb,
  ): Promise<string> {
    const baseUrl = (
      (getPref("anthropicApiUrl" as any) as string) ||
      "https://api.anthropic.com"
    ).replace(/\/$/, "");
    const apiKey = ((getPref("anthropicApiKey" as any) as string) || "").trim();
    const model = (
      (getPref("anthropicModel" as any) as string) || "claude-3-5-sonnet-20241022"
    ).trim();
    const temperatureStr = (getPref("temperature") as string) || "0.7";
    const maxTokensStr = (getPref("maxTokens") as string) || "4096";
    const temperature = parseFloat(temperatureStr) || 0.7;
    const maxTokens = parseInt(maxTokensStr) || 4096;

    if (!baseUrl) throw new Error("Anthropic API URL 未配置");
    if (!apiKey) throw new Error("Anthropic API Key 未配置");

    const endpoint = `${baseUrl}/v1/messages`;

    const savedPrompt = getPref("summaryPrompt") as string;
    const summaryPrompt = savedPrompt && savedPrompt.trim()
      ? savedPrompt
      : getDefaultSummaryPrompt();

    // Anthropic 格式: messages数组,交替user/assistant
    const messages: any[] = [];

    // 处理对话历史
    if (conversationHistory.length === 2 && pdfContent) {
      // 第一轮对话:需要在用户消息中添加PDF内容
      const firstUserMsg = conversationHistory[0];
      
      if (isBase64) {
        // Base64模式:使用document类型
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
        // 文本模式:拼接文本
        messages.push({
          role: "user",
          content: buildUserMessage(firstUserMsg.content, pdfContent),
        });
      }
      
      // AI的回复
      messages.push({
        role: "assistant",
        content: conversationHistory[1].content,
      });
    } else {
      // 后续对话:直接转换
      for (const msg of conversationHistory) {
        messages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        });
      }
    }

    const payload = {
      model,
      max_tokens: maxTokens,
      temperature,
      system: SYSTEM_ROLE_PROMPT,
      messages,
      stream: true,
    };

    const chunks: string[] = [];
    let delivered = 0;
    let processedLength = 0;
    let partialLine = "";
    let abortError: Error | null = null; // 记录主动中止的错误

    try {
      await Zotero.HTTP.request("POST", endpoint, {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(payload),
        responseType: "text",
        timeout: LLMClient.getRequestTimeout(),
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
                ztoolkit.log("[AI-Butler] Anthropic HTTP error:", { status, code, msg, response: errorResponse });
                xmlhttp.abort();
              } catch (parseErr) {
                const errorMessage = `HTTP ${status}: 请求失败`;
                abortError = new Error(errorMessage);
                ztoolkit.log("[AI-Butler] Anthropic HTTP error:", { status, parseErr });
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
                    continue;
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
      // 如果是主动中止的错误,直接抛出
      if (abortError) {
        throw abortError;
      }

      // 否则解析错误响应
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
      } catch (e) {
        // 忽略解析错误
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
}

// 导出默认类
export default LLMClient;
