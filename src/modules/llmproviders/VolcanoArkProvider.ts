import { SYSTEM_ROLE_PROMPT, buildUserMessage } from "../../utils/prompts";
import { ILlmProvider, PdfFileInfo } from "./ILlmProvider";
import {
  formatConnectionTestSuccess,
  getConnectionTestInput,
} from "./shared/connectionTest";
import {
  providerMissingApiKey,
  providerMissingApiUrl,
  providerNoPdfFiles,
  providerNoPdfProcessed,
  providerRequestFailed,
} from "./shared/localizedErrors";
import {
  deriveVersionedModelsUrl,
  parseModelListResponse,
  requestModelListJson,
} from "./shared/modelList";
import { throwIfAborted } from "./shared/requestAbort";
import { mergeRequestHeaders } from "./shared/requestHeaders";
import { requestLLMText } from "./shared/textTransport";
import type { LLMProviderResult } from "./types";
import {
  ConversationMessage,
  LLMModelInfo,
  LLMOptions,
  LLMProviderCapabilities,
  ProgressCb,
} from "./types";

/**
 * 火山引擎 Ark Provider
 * 使用 Response API 接口
 * 文档: https://www.volcengine.com/docs/82379/1902647
 */
export class VolcanoArkProvider implements ILlmProvider {
  readonly id = "volcanoark";
  readonly capabilities: LLMProviderCapabilities = {
    supportsText: true,
    supportsStreaming: true,
    supportsPdfBase64: true,
    maxPdfFiles: 20,
    supportsSystemPrompt: true,
    supportedParams: ["temperature", "maxTokens", "stream"],
  };

  async generateSummary(
    content: string,
    isBase64: boolean,
    prompt: string | undefined,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<LLMProviderResult> {
    const baseUrl = (
      options.apiUrl || "https://ark.cn-beijing.volces.com/api/v3/responses"
    ).replace(/\/$/, "");
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "doubao-seed-1-6-251015").trim();
    const temperature = options.temperature ?? 0.7;
    const maxTokens = options.maxTokens;

    if (!baseUrl) throw new Error(providerMissingApiUrl("Volcano Ark"));
    if (!apiKey) throw new Error(providerMissingApiKey("Volcano Ark"));
    throwIfAborted(options.abortSignal);

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

    return requestLLMText({
      protocol: "responses",
      provider: this.id,
      url: endpoint,
      headers: mergeRequestHeaders(
        {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        options.customHeaders,
      ),
      payload: payload,
      options,
      onProgress,
    });
  }

  async chat(
    pdfContent: string,
    isBase64: boolean,
    conversation: ConversationMessage[],
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<LLMProviderResult> {
    const baseUrl = (
      options.apiUrl || "https://ark.cn-beijing.volces.com/api/v3/responses"
    ).replace(/\/$/, "");
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "doubao-seed-1-6-251015").trim();
    const temperature = options.temperature ?? 0.7;

    if (!baseUrl) throw new Error(providerMissingApiUrl("Volcano Ark"));
    if (!apiKey) throw new Error(providerMissingApiKey("Volcano Ark"));
    throwIfAborted(options.abortSignal);

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
      max_output_tokens: options.maxTokens,
    };

    return requestLLMText({
      protocol: "responses",
      provider: this.id,
      url: endpoint,
      headers: mergeRequestHeaders(
        {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        options.customHeaders,
      ),
      payload: payload,
      options,
      onProgress,
    });
  }

  async testConnection(options: LLMOptions): Promise<string> {
    const baseUrl = (
      options.apiUrl || "https://ark.cn-beijing.volces.com/api/v3/responses"
    ).replace(/\/$/, "");
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "doubao-seed-1-6-251015").trim();
    if (!baseUrl) throw new Error(providerMissingApiUrl("Volcano Ark"));
    if (!apiKey) throw new Error(providerMissingApiKey("Volcano Ark"));

    // 如果 baseUrl 已经以 /responses 结尾，直接使用；否则追加
    const url = baseUrl.endsWith("/responses")
      ? baseUrl
      : `${baseUrl}/responses`;
    const testInput = getConnectionTestInput(options);
    const userContent = testInput.isBase64
      ? [
          {
            type: "input_file",
            file_data: `data:application/pdf;base64,${testInput.pdfBase64 || ""}`,
            filename: "connection-test.pdf",
          },
          {
            type: "input_text",
            text: testInput.text,
          },
        ]
      : testInput.text;
    const payload = {
      model,
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
      max_output_tokens: 16,
      temperature: 0.1,
    };
    const payloadStr = JSON.stringify(payload, null, 2);

    let response: any;
    const responseHeaders: Record<string, string> = {};
    try {
      response = await Zotero.HTTP.request("POST", url, {
        headers: mergeRequestHeaders(
          {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          options.customHeaders,
        ),
        body: JSON.stringify(payload),
        responseType: "text",
        timeout: 30000,
        errorDelayMax: 0,
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
      let errorMessage = error?.message || providerRequestFailed("Volcano Ark");
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
      return formatConnectionTestSuccess({
        mode: testInput.mode,
        model,
        response: text,
        rawResponse,
      });
    }

    // 非 200 但未抛出异常的情况
    const { APITestError } = await import("./types");
    throw new APITestError(`HTTP ${status}`, {
      errorName: `HTTP_${status}`,
      errorMessage: `HTTP ${status}: ${response.statusText || providerRequestFailed("API")}`,
      statusCode: status,
      requestUrl: url,
      requestBody: payloadStr,
      responseHeaders,
      responseBody: rawResponse,
    });
  }

  async listModels(options: LLMOptions): Promise<LLMModelInfo[]> {
    const baseUrl = (
      options.apiUrl || "https://ark.cn-beijing.volces.com/api/v3/responses"
    ).replace(/\/+$/, "");
    const apiKey = (options.apiKey || "").trim();
    if (!baseUrl) throw new Error(providerMissingApiUrl("Volcano Ark"));
    if (!apiKey) throw new Error(providerMissingApiKey("Volcano Ark"));

    const url = deriveVersionedModelsUrl(
      baseUrl,
      "https://ark.cn-beijing.volces.com/api/v3/responses",
      "/api/v3",
    );
    const data = await requestModelListJson(
      url,
      { Authorization: `Bearer ${apiKey}` },
      options.requestTimeoutMs ?? 30000,
      options.customHeaders,
    );
    return parseModelListResponse(data);
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
    history: ConversationMessage[] = [],
  ): Promise<LLMProviderResult> {
    const baseUrl = (
      options.apiUrl || "https://ark.cn-beijing.volces.com/api/v3/responses"
    ).replace(/\/$/, "");
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "doubao-seed-1-6-251015").trim();
    const temperature = options.temperature ?? 0.7;
    const maxTokens = options.maxTokens;

    if (!baseUrl) throw new Error(providerMissingApiUrl("Volcano Ark"));
    if (!apiKey) throw new Error(providerMissingApiKey("Volcano Ark"));
    if (pdfFiles.length === 0) throw new Error(providerNoPdfFiles());
    throwIfAborted(options.abortSignal);

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
      throw new Error(providerNoPdfProcessed());
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
    payload.input.push(...history);
    return requestLLMText({
      protocol: "responses",
      provider: this.id,
      url: endpoint,
      headers: mergeRequestHeaders(
        {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        options.customHeaders,
      ),
      payload: payload,
      options,
      onProgress,
    });
  }
}

// 自注册
import { ProviderRegistry } from "./ProviderRegistry";
ProviderRegistry.register(new VolcanoArkProvider());

export default VolcanoArkProvider;
