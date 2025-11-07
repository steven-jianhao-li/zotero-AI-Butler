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
import { ProviderRegistry } from "./llmproviders/ProviderRegistry";
// 侧效导入，确保各 Provider 自注册到注册表
import "./llmproviders";
import type {
  LLMOptions,
  ProgressCb as ProviderProgressCb,
  ConversationMessage,
} from "./llmproviders/types";

/**
 * 进度回调函数类型定义
 *
 * 用于接收流式输出的增量文本
 *
 * @param chunk 本次接收到的增量文本片段
 * @returns Promise 或 void,支持异步和同步回调
 */
type ProgressCb = (chunk: string) => Promise<void> | void;
type BaseOpts = Pick<
  LLMOptions,
  "stream" | "temperature" | "topP" | "maxTokens" | "requestTimeoutMs"
>;

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
   * 根据 providerId 读取对应 URL/Key/Model，并合并通用选项
   */
  private static buildOptionsForProvider(
    providerId: string,
    base: BaseOpts,
  ): LLMOptions {
    const id = providerId.toLowerCase();
    if (id === "google" || id.includes("gemini")) {
      return {
        apiUrl: (
          (getPref("geminiApiUrl" as any) as string) ||
          "https://generativelanguage.googleapis.com"
        ).replace(/\/$/, ""),
        apiKey: ((getPref("geminiApiKey" as any) as string) || "").trim(),
        model: (
          (getPref("geminiModel" as any) as string) || "gemini-2.5-pro"
        ).trim(),
        ...base,
      };
    }
    if (id === "anthropic" || id.includes("claude")) {
      return {
        apiUrl: (
          (getPref("anthropicApiUrl" as any) as string) ||
          "https://api.anthropic.com"
        ).replace(/\/$/, ""),
        apiKey: ((getPref("anthropicApiKey" as any) as string) || "").trim(),
        model: (
          (getPref("anthropicModel" as any) as string) ||
          "claude-3-5-sonnet-20241022"
        ).trim(),
        ...base,
      };
    }
    // 默认 openai/兼容
    return {
      apiUrl: ((getPref("apiUrl" as any) as string) || "").trim(),
      apiKey: ((getPref("apiKey" as any) as string) || "").trim(),
      model: ((getPref("model" as any) as string) || "gpt-3.5-turbo").trim(),
      ...base,
    };
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
    const providerId = (
      (getPref("provider" as any) as string) || "openai"
    ).trim();
    const provider =
      ProviderRegistry.get(providerId) || ProviderRegistry.get("openai");
    if (!provider) {
      const list = ProviderRegistry.list().join(", ");
      const msg = `未知的供应商: ${providerId}。请在设置中选择以下之一: ${list}`;
      LLMClient.notifyError(msg);
      throw new Error(msg);
    }

    const savedPrompt = getPref("summaryPrompt") as string;
    const summaryPrompt =
      prompt ||
      (savedPrompt && savedPrompt.trim()
        ? savedPrompt
        : getDefaultSummaryPrompt());

    const stream = (getPref("stream") as boolean) ?? true;
    const temperature =
      parseFloat((getPref("temperature") as string) || "0.7") || 0.7;
    const topP = parseFloat((getPref("topP") as string) || "1.0") || 1.0;
    const maxTokens =
      parseInt((getPref("maxTokens") as string) || "4096") || 4096;

    const opts: LLMOptions = this.buildOptionsForProvider(providerId, {
      stream,
      temperature,
      topP,
      maxTokens,
      requestTimeoutMs: LLMClient.getRequestTimeout(),
    });

    return await provider.generateSummary(
      content,
      isBase64,
      summaryPrompt,
      opts,
      onProgress as ProviderProgressCb,
    );
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
    const enableTemperature = ((getPref("enableTemperature") as any) ??
      true) as boolean;
    const enableTopP = ((getPref("enableTopP") as any) ?? true) as boolean;
    const enableMaxTokens = ((getPref("enableMaxTokens") as any) ??
      true) as boolean;

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
      const generationConfig: any = {};
      if (enableTemperature) generationConfig.temperature = temperature;
      if (enableTopP) generationConfig.topP = topP;
      if (enableMaxTokens) generationConfig.maxOutputTokens = maxTokens;
      payload = {
        generationConfig,
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
      const generationConfig2: any = {};
      if (enableTemperature) generationConfig2.temperature = temperature;
      if (enableTopP) generationConfig2.topP = topP;
      if (enableMaxTokens) generationConfig2.maxOutputTokens = maxTokens;
      payload = {
        generationConfig: generationConfig2,
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
            void 0;
          };
          xmlhttp.ontimeout = () => {
            // 让请求失败，外层根据 gotAnyDelta 决定是否返回部分内容
            void 0;
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
      (getPref("anthropicModel" as any) as string) ||
      "claude-3-5-sonnet-20241022"
    ).trim();

    const temperatureStr = (getPref("temperature") as string) || "0.7";
    const maxTokensStr = (getPref("maxTokens") as string) || "4096";
    const temperature = parseFloat(temperatureStr) || 0.7;
    const maxTokens = parseInt(maxTokensStr) || 4096;
    const enableTemperature = ((getPref("enableTemperature") as any) ??
      true) as boolean;
    const enableMaxTokens = ((getPref("enableMaxTokens") as any) ??
      true) as boolean;

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
        max_tokens: maxTokens, // Anthropic 必填
        ...(enableTemperature ? { temperature } : {}),
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
      // 文本模式: 使用文本内容（以 Anthropic content blocks 明确传递文本，避免服务端丢失 <Paper> 正文）
      const userContent = buildUserMessage(summaryPrompt, content);
      payload = {
        model,
        max_tokens: maxTokens, // Anthropic 必填
        ...(enableTemperature ? { temperature } : {}),
        system: SYSTEM_ROLE_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: userContent,
              },
            ],
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
            void 0;
          };
          xmlhttp.ontimeout = () => {
            // 让请求失败，外层根据 gotAnyDelta 决定是否返回部分内容
            void 0;
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
    const providerId = (
      (getPref("provider" as any) as string) || "openai"
    ).trim();
    const provider =
      ProviderRegistry.get(providerId) || ProviderRegistry.get("openai");
    if (!provider) {
      const list = ProviderRegistry.list().join(", ");
      throw new Error(`未知的供应商: ${providerId}。可用: ${list}`);
    }
    const opts = this.buildOptionsForProvider(providerId, {
      requestTimeoutMs: LLMClient.getRequestTimeout(),
    });
    return provider.testConnection(opts);
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
    const providerId = (
      (getPref("provider" as any) as string) || "openai"
    ).trim();
    const provider =
      ProviderRegistry.get(providerId) || ProviderRegistry.get("openai");
    if (!provider) {
      const list = ProviderRegistry.list().join(", ");
      const msg = `未知的供应商: ${providerId}。请在设置中选择以下之一: ${list}`;
      LLMClient.notifyError(msg);
      throw new Error(msg);
    }
    // 构建通用 options
    const stream = (getPref("stream") as boolean) ?? true;
    const temperature =
      parseFloat((getPref("temperature") as string) || "0.7") || 0.7;
    const topP = parseFloat((getPref("topP") as string) || "1.0") || 1.0;
    const maxTokens =
      parseInt((getPref("maxTokens") as string) || "4096") || 4096;
    const opts: LLMOptions = this.buildOptionsForProvider(providerId, {
      stream,
      temperature,
      topP,
      maxTokens,
      requestTimeoutMs: LLMClient.getRequestTimeout(),
    });

    // 类型对齐
    const convo =
      (conversationHistory as unknown as ConversationMessage[]) || [];
    return provider.chat(
      pdfContent,
      isBase64,
      convo,
      opts,
      onProgress as ProviderProgressCb,
    );
  }

  /**
   * OpenAI 对话实现
   */
  private static async chatWithOpenAI(
    pdfContent: string,
    isBase64: boolean,
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
    const enableTemperature = ((getPref("enableTemperature") as any) ??
      true) as boolean;

    if (!apiUrl) throw new Error("API URL 未配置");
    if (!apiKey) throw new Error("API Key 未配置");

    const savedPrompt = getPref("summaryPrompt") as string;
    const summaryPrompt =
      savedPrompt && savedPrompt.trim()
        ? savedPrompt
        : getDefaultSummaryPrompt();

    // Base64 论文：使用 Responses API（SSE 流式）
    if (isBase64) {
      const responsesUrl = /\/v1\/.+$/i.test(apiUrl)
        ? apiUrl.replace(/\/v1\/.+$/i, "/v1/responses")
        : apiUrl.endsWith("/v1/responses")
          ? apiUrl
          : apiUrl.replace(/\/?$/, "/v1/responses");

      const inputs: any[] = [
        {
          role: "system",
          content: [{ type: "input_text", text: SYSTEM_ROLE_PROMPT }],
        },
      ];

      if (conversationHistory && conversationHistory.length > 0) {
        const firstUser = conversationHistory[0];
        const extraHistoryText = conversationHistory
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
        if (extraHistoryText) {
          userParts.push({
            type: "input_text",
            text: `以下为过往对话供参考：\n${extraHistoryText}`,
          });
        }
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
          timeout: LLMClient.getRequestTimeout(),
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
                      // 忽略解析失败的行
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
                  `Timeout: 请求超过 ${LLMClient.getRequestTimeout()} ms`,
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
          /* ignore parse error */
        }
        if (gotAnyDelta && chunks.length > 0) return chunks.join("");
        throw new Error(errorMessage);
      }

      return chunks.join("");
    }

    // 构造消息：文本模式：始终保证第一条用户消息为“默认提示词+论文内容”，第二条为“AI总结”，其余原样
    const messages: any[] = [{ role: "system", content: SYSTEM_ROLE_PROMPT }];

    if (conversationHistory && conversationHistory.length > 0) {
      const firstUserMsg = conversationHistory[0];
      if (isBase64) {
        messages.push({
          role: "user",
          content: [
            { type: "text", text: firstUserMsg.content },
            {
              type: "image_url",
              image_url: {
                url: `data:application/pdf;base64,${pdfContent}`,
              },
            },
          ],
        });
      } else {
        messages.push({
          role: "user",
          content: buildUserMessage(firstUserMsg.content, pdfContent || ""),
        });
      }

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
              abortError = new Error(
                `Timeout: 请求超过 ${LLMClient.getRequestTimeout()} ms`,
              );
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
    const enableTemperature = ((getPref("enableTemperature") as any) ??
      true) as boolean;

    if (!baseUrl) throw new Error("Gemini API URL 未配置");
    if (!apiKey) throw new Error("Gemini API Key 未配置");

    const endpoint = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

    const savedPrompt = getPref("summaryPrompt") as string;
    const summaryPrompt =
      savedPrompt && savedPrompt.trim()
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
          parts: [
            { text: buildUserMessage(firstUserMsg.content, pdfContent || "") },
          ],
        });
      }

      if (conversationHistory.length > 1) {
        contents.push({
          role: "model",
          parts: [{ text: conversationHistory[1].content }],
        });
      }

      for (let i = 2; i < conversationHistory.length; i++) {
        const msg = conversationHistory[i];
        contents.push({
          role: msg.role === "user" ? "user" : "model",
          parts: [{ text: msg.content }],
        });
      }
    }

    const genCfg: any = {};
    if (enableTemperature) genCfg.temperature = temperature;
    const payload: any = {
      generationConfig: genCfg,
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
            if (!abortError)
              abortError = new Error("NetworkError: XHR onerror");
          };
          xmlhttp.ontimeout = () => {
            if (!abortError)
              abortError = new Error(
                `Timeout: 请求超过 ${LLMClient.getRequestTimeout()} ms`,
              );
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
      (getPref("anthropicModel" as any) as string) ||
      "claude-3-5-sonnet-20241022"
    ).trim();
    const temperatureStr = (getPref("temperature") as string) || "0.7";
    const maxTokensStr = (getPref("maxTokens") as string) || "4096";
    const temperature = parseFloat(temperatureStr) || 0.7;
    const maxTokens = parseInt(maxTokensStr) || 4096;
    const enableTemperature = ((getPref("enableTemperature") as any) ??
      true) as boolean;

    if (!baseUrl) throw new Error("Anthropic API URL 未配置");
    if (!apiKey) throw new Error("Anthropic API Key 未配置");

    const endpoint = `${baseUrl}/v1/messages`;

    const savedPrompt = getPref("summaryPrompt") as string;
    const summaryPrompt =
      savedPrompt && savedPrompt.trim()
        ? savedPrompt
        : getDefaultSummaryPrompt();

    // Anthropic 格式: messages数组,交替user/assistant
    const messages: any[] = [];

    // 始终保证第一条为“提示词+论文内容”
    if (conversationHistory && conversationHistory.length > 0) {
      const firstUserMsg = conversationHistory[0];
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

      // 第二条（如果存在）为 AI 总结
      if (conversationHistory.length > 1) {
        messages.push({
          role: "assistant",
          content: conversationHistory[1].content,
        });
      }

      // 从第三条开始，按原始角色逐条附加
      for (let i = 2; i < conversationHistory.length; i++) {
        const msg = conversationHistory[i];
        messages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        });
      }
    }

    const payload: any = {
      model,
      max_tokens: maxTokens, // Anthropic 必填
      ...(enableTemperature ? { temperature } : {}),
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
