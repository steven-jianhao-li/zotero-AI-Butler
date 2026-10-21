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
  providerStreamUnexpectedEnd,
} from "./shared/localizedErrors";
import {
  deriveGeminiModelsUrl,
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

export class GeminiProvider implements ILlmProvider {
  readonly id = "google"; // 同步现有 provider 识别：google/gemini
  readonly capabilities: LLMProviderCapabilities = {
    supportsText: true,
    supportsStreaming: true,
    supportsPdfBase64: true,
    maxPdfFiles: 20,
    supportsSystemPrompt: true,
    supportedParams: ["temperature", "topP", "maxTokens", "stream"],
  };

  async generateSummary(
    content: string,
    isBase64: boolean,
    prompt: string | undefined,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<LLMProviderResult> {
    const baseUrl = (
      options.apiUrl || "https://generativelanguage.googleapis.com"
    ).replace(/\/$/, "");
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "gemini-2.5-pro").trim();
    const temperature = options.temperature ?? 0.7;
    const topP = options.topP ?? 1.0;
    const maxTokens = options.maxTokens ?? 4096;

    if (!baseUrl) throw new Error(providerMissingApiUrl("Gemini"));
    if (!apiKey) throw new Error(providerMissingApiKey("Gemini"));
    throwIfAborted(options.abortSignal);

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

    return requestLLMText({
      protocol: "gemini",
      provider: this.id,
      url: endpoint,
      headers: mergeRequestHeaders(
        { "Content-Type": "application/json", "x-goog-api-key": apiKey },
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
      options.apiUrl || "https://generativelanguage.googleapis.com"
    ).replace(/\/$/, "");
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "gemini-2.5-pro").trim();
    const temperature = options.temperature ?? 0.7;

    if (!baseUrl) throw new Error(providerMissingApiUrl("Gemini"));
    if (!apiKey) throw new Error(providerMissingApiKey("Gemini"));
    throwIfAborted(options.abortSignal);

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
    if (options.maxTokens !== undefined)
      genCfg.maxOutputTokens = options.maxTokens;
    if (options.topP !== undefined) genCfg.topP = options.topP;
    const payload: any = {
      generationConfig: genCfg,
      contents,
      systemInstruction: { parts: [{ text: SYSTEM_ROLE_PROMPT }] },
    };

    return requestLLMText({
      protocol: "gemini",
      provider: this.id,
      url: endpoint,
      headers: mergeRequestHeaders(
        { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        options.customHeaders,
      ),
      payload: payload,
      options,
      onProgress,
    });
  }

  async listModels(options: LLMOptions): Promise<LLMModelInfo[]> {
    const baseUrl = (
      options.apiUrl || "https://generativelanguage.googleapis.com"
    ).replace(/\/+$/, "");
    const apiKey = (options.apiKey || "").trim();
    if (!baseUrl) throw new Error(providerMissingApiUrl("Gemini"));
    if (!apiKey) throw new Error(providerMissingApiKey("Gemini"));

    const url = deriveGeminiModelsUrl(baseUrl);
    const data = await requestModelListJson(
      url,
      { "x-goog-api-key": apiKey },
      options.requestTimeoutMs ?? 30000,
      options.customHeaders,
    );
    return parseModelListResponse(data, { stripModelsPrefix: true });
  }

  async testConnection(options: LLMOptions): Promise<string> {
    const baseUrl = (
      options.apiUrl || "https://generativelanguage.googleapis.com"
    ).replace(/\/$/, "");
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "gemini-2.5-pro").trim();
    if (!baseUrl) throw new Error(providerMissingApiUrl("Gemini"));
    if (!apiKey) throw new Error(providerMissingApiKey("Gemini"));

    const url = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const testInput = getConnectionTestInput(options);
    const parts: any[] = [{ text: testInput.text }];
    if (testInput.isBase64) {
      parts.push({
        inlineData: {
          mimeType: "application/pdf",
          data: testInput.pdfBase64 || "",
        },
      });
    }
    const payload = {
      contents: [
        {
          role: "user",
          parts,
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
        headers: mergeRequestHeaders(
          {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
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
      let errorMessage = error?.message || providerRequestFailed("Gemini");
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

  private extractGeminiText(json: any): string {
    try {
      const cand0 = json?.candidates?.[0];
      if (!cand0) return "";

      // 提取文本时过滤掉 thought: true 的 parts（Gemini 思考模式的思考过程）
      const extractTextFromParts = (parts: any[]): string => {
        if (!Array.isArray(parts)) return "";
        return parts
          .filter((p: any) => !p?.thought) // 过滤掉思考内容
          .map((p: any) => p?.text || "")
          .join("");
      };

      const deltaParts = cand0?.delta?.content?.parts || cand0?.delta?.parts;
      if (Array.isArray(deltaParts)) return extractTextFromParts(deltaParts);

      const parts = cand0?.content?.parts;
      if (Array.isArray(parts)) return extractTextFromParts(parts);

      // 单个 part 的情况，检查是否是思考内容
      const singlePart = cand0?.content?.parts?.[0];
      if (singlePart?.thought) return "";
      const text = singlePart?.text || cand0?.text;
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
    customHeaders?: Record<string, string>,
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
        headers: mergeRequestHeaders(
          {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": String(numBytes),
            "X-Goog-Upload-Header-Content-Type": mimeType,
          },
          customHeaders,
        ),
        body: JSON.stringify({
          file: { display_name: displayName },
        }),
        responseType: "text",
        timeout: 60000,
        errorDelayMax: 0,
      });

      // 从响应头获取上传 URL
      const headers = startResponse.getAllResponseHeaders?.() || "";
      const urlMatch = headers.match(/x-goog-upload-url:\s*(.+?)(?:\r?\n|$)/i);
      if (!urlMatch) {
        throw new Error(providerRequestFailed("Gemini file upload"));
      }
      uploadUrl = urlMatch[1].trim();
    } catch (error: any) {
      ztoolkit.log("[AI-Butler] Gemini 文件上传初始化失败:", error);
      throw new Error(
        providerStreamUnexpectedEnd(
          "Gemini file upload initialization",
          error.message,
        ),
        { cause: error },
      );
    }

    // 步骤 2: 上传文件内容
    try {
      const uploadResponse = await Zotero.HTTP.request("POST", uploadUrl, {
        headers: mergeRequestHeaders(
          {
            "Content-Length": String(numBytes),
            "X-Goog-Upload-Offset": "0",
            "X-Goog-Upload-Command": "upload, finalize",
          },
          customHeaders,
        ),
        body: new Uint8Array(fileData),
        responseType: "json",
        timeout: 120000, // 文件上传可能需要更长时间
        errorDelayMax: 0,
      });

      const fileInfo = uploadResponse.response;
      const fileUri = fileInfo?.file?.uri;
      if (!fileUri) {
        throw new Error(providerRequestFailed("Gemini file URI"));
      }

      ztoolkit.log(`[AI-Butler] 文件上传成功: ${displayName} -> ${fileUri}`);
      return fileUri;
    } catch (error: any) {
      ztoolkit.log("[AI-Butler] Gemini 文件上传失败:", error);
      throw new Error(
        providerStreamUnexpectedEnd("Gemini file upload", error.message),
        { cause: error },
      );
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
    history: ConversationMessage[] = [],
  ): Promise<LLMProviderResult> {
    const baseUrl = (
      options.apiUrl || "https://generativelanguage.googleapis.com"
    ).replace(/\/$/, "");
    const apiKey = (options.apiKey || "").trim();
    const model = (options.model || "gemini-2.5-pro").trim();
    const temperature = options.temperature ?? 0.7;
    const topP = options.topP ?? 1.0;
    const maxTokens = options.maxTokens ?? 8192;

    if (!baseUrl) throw new Error(providerMissingApiUrl("Gemini"));
    if (!apiKey) throw new Error(providerMissingApiKey("Gemini"));
    if (pdfFiles.length === 0) throw new Error(providerNoPdfFiles());
    throwIfAborted(options.abortSignal);

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
      throw new Error(providerNoPdfProcessed());
    }

    ztoolkit.log(
      `[AI-Butler] 准备发送 ${fileParts.length} 个 PDF 附件到 Gemini`,
    );

    // 构建请求
    const endpoint = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

    // 条件性地添加配置参数（与 generateSummary 保持一致）
    const generationConfig: any = {};
    if (options.temperature !== undefined)
      generationConfig.temperature = temperature;
    if (options.topP !== undefined) generationConfig.topP = topP;
    if (options.maxTokens !== undefined)
      generationConfig.maxOutputTokens = maxTokens;

    const payload = {
      generationConfig,
      contents: [
        {
          role: "user",
          parts: [{ text: prompt || "" }, ...fileParts],
        },
      ],
      systemInstruction: { parts: [{ text: SYSTEM_ROLE_PROMPT }] },
    };

    // 发送请求并处理流式响应
    payload.contents.push(
      ...history.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
    );
    return requestLLMText({
      protocol: "gemini",
      provider: this.id,
      url: endpoint,
      headers: mergeRequestHeaders(
        { "Content-Type": "application/json", "x-goog-api-key": apiKey },
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
ProviderRegistry.register(new GeminiProvider());

export default GeminiProvider;
