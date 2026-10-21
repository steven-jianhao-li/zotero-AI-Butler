import { SYSTEM_ROLE_PROMPT, buildUserMessage } from "../../utils/prompts";
import { ILlmProvider } from "./ILlmProvider";
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
import { parseOpenAIResponsesText } from "./shared/openaiResponses";
import { resolveOpenAIReasoningEffort } from "./shared/reasoning";
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

function getResponsesUrl(apiUrl: string): string {
  const base = apiUrl.replace(/\/+$/, "");
  if (/\/responses$/i.test(base)) return base;
  if (/\/v1(?:\/.*)?$/i.test(base))
    return base.replace(/\/v1(?:\/.*)?$/i, "/v1/responses");
  return `${base}/v1/responses`;
}

export class OpenAIProvider implements ILlmProvider {
  readonly id = "openai";
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

  async generateSummary(
    content: string,
    isBase64: boolean,
    prompt: string | undefined,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<LLMProviderResult> {
    return this.chat(
      content,
      isBase64,
      [{ role: "user", content: prompt || "" }],
      options,
      onProgress,
    );
  }

  async chat(
    pdfContent: string,
    isBase64: boolean,
    conversation: ConversationMessage[],
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<LLMProviderResult> {
    const apiKey = (options.apiKey || "").trim();
    const apiUrl = (options.apiUrl || "").trim();
    const model = (options.model || "gpt-4o").trim();
    if (!apiUrl) throw new Error(providerMissingApiUrl());
    if (!apiKey) throw new Error(providerMissingApiKey());
    const responses = isBase64 || /\/responses\/?$/i.test(apiUrl);
    const messages: Array<Record<string, unknown>> = [
      { role: "developer", content: SYSTEM_ROLE_PROMPT },
    ];
    conversation.forEach((message, index) => {
      if (index === 0 && message.role === "user") {
        messages.push({
          role: "user",
          content: isBase64
            ? [
                { type: "input_text", text: message.content },
                {
                  type: "input_file",
                  filename: "paper.pdf",
                  file_data: `data:application/pdf;base64,${pdfContent}`,
                },
              ]
            : buildUserMessage(message.content, pdfContent),
        });
      } else messages.push({ role: message.role, content: message.content });
    });
    const payload: Record<string, unknown> = responses
      ? { model, input: messages }
      : { model, messages };
    if (options.temperature !== undefined)
      payload.temperature = options.temperature;
    if (options.topP !== undefined) payload.top_p = options.topP;
    if (options.maxTokens !== undefined)
      payload[responses ? "max_output_tokens" : "max_tokens"] =
        options.maxTokens;
    if (responses) this.applyResponsesReasoning(payload, model, options);
    else this.applyChatReasoning(payload, model, options);
    return requestLLMText({
      protocol: responses ? "responses" : "chat",
      provider: this.id,
      url: responses ? getResponsesUrl(apiUrl) : apiUrl,
      headers: mergeRequestHeaders(
        {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        options.customHeaders,
      ),
      payload,
      options,
      onProgress,
    });
  }

  async listModels(options: LLMOptions): Promise<LLMModelInfo[]> {
    const apiKey = (options.apiKey || "").trim();
    const apiUrl = (options.apiUrl || "https://api.openai.com/v1/responses")
      .trim()
      .replace(/\/+$/, "");
    if (!apiUrl) throw new Error(providerMissingApiUrl());
    if (!apiKey) throw new Error(providerMissingApiKey());

    const url = deriveVersionedModelsUrl(
      apiUrl,
      "https://api.openai.com/v1/responses",
    );
    const data = await requestModelListJson(
      url,
      { Authorization: `Bearer ${apiKey}` },
      options.requestTimeoutMs ?? 30000,
      options.customHeaders,
    );
    return parseModelListResponse(data);
  }

  async testConnection(options: LLMOptions): Promise<string> {
    const apiKey = (options.apiKey || "").trim();
    const apiUrl = (options.apiUrl || "").trim();
    const model = (options.model || "gpt-5").trim();
    if (!apiUrl) throw new Error(providerMissingApiUrl());
    if (!apiKey) throw new Error(providerMissingApiKey());

    const responsesUrl = getResponsesUrl(apiUrl);
    const testInput = getConnectionTestInput(options);
    const userContent = testInput.isBase64
      ? [
          {
            type: "input_text",
            text: testInput.text,
          },
          {
            type: "input_file",
            filename: "connection-test.pdf",
            file_data: `data:application/pdf;base64,${testInput.pdfBase64 || ""}`,
          },
        ]
      : [
          {
            type: "input_text",
            text: testInput.text,
          },
        ];

    const payload = {
      model,
      input: [
        {
          role: "user",
          content: userContent,
        },
      ],
      max_output_tokens: options.maxTokens ?? 16,
      stream: false,
    } as any;
    this.applyResponsesReasoning(payload, model, options);
    const payloadStr = JSON.stringify(payload, null, 2);

    let response: any;
    const responseHeaders: Record<string, string> = {};
    try {
      response = await Zotero.HTTP.request("POST", responsesUrl, {
        headers: mergeRequestHeaders(
          {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          options.customHeaders,
        ),
        body: JSON.stringify(payload),
        errorDelayMax: 0,
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
      let errorMessage = error?.message || providerRequestFailed("OpenAI");
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
      const content = parseOpenAIResponsesText(json);
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
    history: ConversationMessage[] = [],
  ): Promise<LLMProviderResult> {
    const apiKey = (options.apiKey || "").trim();
    const apiUrl = (options.apiUrl || "").trim();
    const model = (options.model || "gpt-4o").trim();

    if (!apiUrl) throw new Error(providerMissingApiUrl());
    if (!apiKey) throw new Error(providerMissingApiKey());
    if (pdfFiles.length === 0) throw new Error(providerNoPdfFiles());
    throwIfAborted(options.abortSignal);

    // 使用 Responses API
    const responsesUrl = getResponsesUrl(apiUrl);

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
      throw new Error(providerNoPdfProcessed());
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
    this.applyResponsesReasoning(payload, model, options);

    if (options.temperature !== undefined)
      payload.temperature = options.temperature;
    if (options.topP !== undefined) payload.top_p = options.topP;
    if (options.maxTokens !== undefined)
      payload.max_output_tokens = options.maxTokens;
    payload.input.push(...history);
    return requestLLMText({
      protocol: "responses",
      provider: this.id,
      url: responsesUrl,
      headers: mergeRequestHeaders(
        {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        options.customHeaders,
      ),
      payload,
      options,
      onProgress,
    });
  }

  private applyResponsesReasoning(
    payload: Record<string, unknown>,
    model: string,
    options: LLMOptions,
  ): void {
    const effort = resolveOpenAIReasoningEffort(model, options.reasoningEffort);
    if (effort) {
      payload.reasoning = { effort };
    }
  }

  private applyChatReasoning(
    payload: Record<string, unknown>,
    model: string,
    options: LLMOptions,
  ): void {
    const effort = resolveOpenAIReasoningEffort(model, options.reasoningEffort);
    if (effort) {
      payload.reasoning_effort = effort;
    }
  }
}

// 自注册
import { ProviderRegistry } from "./ProviderRegistry";
ProviderRegistry.register(new OpenAIProvider());

export default OpenAIProvider;
