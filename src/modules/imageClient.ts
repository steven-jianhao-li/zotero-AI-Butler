/**
 * ================================================================
 * 一图总结图片生成客户端
 * ================================================================
 *
 * 使用 Gemini API (Nano Banana Pro) 生成学术概念海报图片
 *
 * 主要功能:
 * 1. 调用 Gemini 生图 API 生成图片
 * 2. 处理 API 响应并提取 Base64 图片数据
 * 3. 提供详细的错误报告
 *
 * API 说明:
 * - 使用 gemini-3-pro-image-preview 模型
 * - 返回格式为 Base64 编码的图片
 *
 * @module imageClient
 * @author AI-Butler Team
 */

import { getPref } from "../utils/prefs";

export type ImageSummaryRequestMode = "gemini" | "openai";

/**
 * 图片生成结果接口
 */
export interface ImageGenerationResult {
  /** Base64 编码的图片数据 */
  imageBase64: string;
  /** 图片 MIME 类型 */
  mimeType: string;
}

/**
 * 图片生成错误类
 */
export class ImageGenerationError extends Error {
  /** 详细错误信息 */
  public details: {
    errorName: string;
    errorMessage: string;
    statusCode?: number;
    requestUrl?: string;
    responseBody?: string;
  };

  constructor(message: string, details: ImageGenerationError["details"]) {
    super(message);
    this.name = "ImageGenerationError";
    this.details = details;
  }
}

/**
 * 图片生成客户端类
 */
export class ImageClient {
  private static resolveRequestMode(value: unknown): ImageSummaryRequestMode {
    const raw = String(value || "")
      .trim()
      .toLowerCase();
    if (raw === "openai" || raw === "openai-compat") return "openai";
    return "gemini";
  }

  private static normalizeApiUrl(url: string): string {
    return (url || "").trim().replace(/\/$/, "");
  }

  private static extractImageFromDataUrl(dataUrl: string): {
    imageBase64: string;
    mimeType: string;
  } | null {
    const m = dataUrl.match(
      /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)\s*$/i,
    );
    if (!m) return null;
    return { mimeType: m[1], imageBase64: m[2] };
  }

  private static guessMimeTypeFromUrl(url: string): string | null {
    const clean = (url || "").toLowerCase().split(/[?#]/)[0];
    if (clean.endsWith(".png")) return "image/png";
    if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "image/jpeg";
    if (clean.endsWith(".webp")) return "image/webp";
    if (clean.endsWith(".gif")) return "image/gif";
    if (clean.endsWith(".svg")) return "image/svg+xml";
    return null;
  }

  private static extractHttpImageUrlFromText(text: string): string | null {
    const t = (text || "").trim();
    if (!t) return null;

    // Markdown image: ![alt](https://...)
    const md = t.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/i);
    if (md?.[1]) return md[1];

    // HTML img src="https://..."
    const html = t.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
    if (html?.[1]) return html[1];

    // Plain URL
    const plain = t.match(/https?:\/\/[^\s<>()]+/i);
    if (plain?.[0]) return plain[0];

    return null;
  }

  private static arrayBufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    const chunkSize = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(
        null,
        bytes.subarray(i, i + chunkSize) as unknown as number[],
      );
    }
    return btoa(binary);
  }

  private static async downloadImageUrlAsBase64(
    url: string,
  ): Promise<{ imageBase64: string; mimeType: string }> {
    const endpoint = url.trim();
    if (!endpoint) throw new Error("Empty image URL");

    let res: any;
    try {
      res = await Zotero.HTTP.request("GET", endpoint, {
        headers: {
          Accept: "image/*,*/*;q=0.8",
        },
        responseType: "arraybuffer",
        timeout: 180000,
      });
    } catch (error: any) {
      const statusCode = error?.xmlhttp?.status;
      const responseBody =
        error?.xmlhttp?.response || error?.xmlhttp?.responseText || "";
      throw new ImageGenerationError("下载图片失败", {
        errorName: "ImageDownloadError",
        errorMessage: error?.message || "无法下载图片资源",
        statusCode,
        requestUrl: endpoint,
        responseBody:
          typeof responseBody === "string"
            ? responseBody
            : JSON.stringify(responseBody),
      });
    }

    if (res?.status !== 200) {
      throw new ImageGenerationError(`HTTP ${res?.status}`, {
        errorName: `HTTP_${res?.status || "Unknown"}`,
        errorMessage: `HTTP ${res?.status || "Unknown"}: ${res?.statusText || "下载失败"}`,
        statusCode: res?.status,
        requestUrl: endpoint,
        responseBody: res?.response,
      });
    }

    const contentTypeHeader =
      (typeof res?.getResponseHeader === "function"
        ? res.getResponseHeader("Content-Type")
        : null) || "";
    const headerMime =
      typeof contentTypeHeader === "string" && contentTypeHeader
        ? contentTypeHeader.split(";")[0].trim()
        : "";
    const mimeType =
      headerMime || this.guessMimeTypeFromUrl(endpoint) || "image/jpeg";

    const body = res?.response;
    if (body instanceof ArrayBuffer) {
      return { imageBase64: this.arrayBufferToBase64(body), mimeType };
    }
    if (typeof body === "string" && body) {
      // 兜底：某些环境可能返回二进制字符串
      return { imageBase64: btoa(body), mimeType };
    }

    throw new ImageGenerationError("下载图片失败", {
      errorName: "EmptyImageBody",
      errorMessage: "图片下载成功但响应体为空或无法解析",
      requestUrl: endpoint,
      responseBody: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  private static extractImageFromOpenAIChatMessage(message: any): {
    imageBase64: string;
    mimeType: string;
  } | null {
    const content = message?.content;
    const images = message?.images;

    // content 可能是 string
    if (typeof content === "string" && content.trim()) {
      const trimmed = content.trim();

      // JSON 字符串直出（部分兼容服务会这么返回）
      if (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
      ) {
        try {
          const parsed = JSON.parse(trimmed);
          const b64 =
            parsed?.imageBase64 ||
            parsed?.image_base64 ||
            parsed?.b64_json ||
            parsed?.b64 ||
            parsed?.data?.b64 ||
            parsed?.data;
          if (typeof b64 === "string" && b64.trim()) {
            const mime = parsed?.mimeType || parsed?.mime_type;
            return { mimeType: mime || "image/png", imageBase64: b64.trim() };
          }
        } catch {
          /* ignore */
        }
      }

      const maybe = this.extractImageFromDataUrl(trimmed);
      if (maybe) return maybe;
      // 尝试从文本中提取 data URL（例如 Markdown/JSON 中夹带）
      const match = content.match(
        /data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/i,
      );
      if (match) {
        return { mimeType: match[1], imageBase64: match[2] };
      }

      // 兜底：纯 Base64（没有 data: 前缀）
      const normalized = trimmed.replace(/\s+/g, "");
      if (
        normalized.length > 1024 &&
        /^[A-Za-z0-9+/=]+$/.test(normalized) &&
        normalized.length % 4 === 0
      ) {
        return { mimeType: "image/png", imageBase64: normalized };
      }
    }

    // content 也可能是多模态数组
    if (Array.isArray(content)) {
      for (const part of content) {
        const type = String(part?.type || "").toLowerCase();

        // 常见: { type: "image_url", image_url: { url: "data:image/png;base64,..." } }
        if (type === "image_url") {
          const url = part?.image_url?.url || part?.image_url?.uri;
          if (typeof url === "string") {
            const maybe = this.extractImageFromDataUrl(url.trim());
            if (maybe) return maybe;
          }
        }

        // 兼容: { type: "image", image_base64: "...", mime_type: "image/png" }
        if (type === "image" || type === "output_image") {
          const b64 =
            part?.image_base64 ||
            part?.b64_json ||
            part?.b64 ||
            part?.data?.b64 ||
            part?.data;
          if (typeof b64 === "string" && b64.trim()) {
            const mime =
              part?.mime_type || part?.mimeType || part?.data?.mime_type;
            return { mimeType: mime || "image/png", imageBase64: b64.trim() };
          }
        }

        // 兜底: 任何字段里出现 data URL
        const url =
          part?.url ||
          part?.image?.url ||
          part?.image_url?.url ||
          part?.imageUrl?.url;
        if (typeof url === "string") {
          const maybe = this.extractImageFromDataUrl(url.trim());
          if (maybe) return maybe;
        }
      }
    }

    // 一些 OpenAI 兼容服务会把图片放在 message.images 里
    if (Array.isArray(images)) {
      for (const part of images) {
        const type = String(part?.type || "").toLowerCase();

        if (type === "image_url") {
          const url = part?.image_url?.url || part?.image_url?.uri;
          if (typeof url === "string") {
            const maybe = this.extractImageFromDataUrl(url.trim());
            if (maybe) return maybe;
          }
        }

        const url =
          part?.url ||
          part?.image?.url ||
          part?.image_url?.url ||
          part?.imageUrl?.url;
        if (typeof url === "string") {
          const maybe = this.extractImageFromDataUrl(url.trim());
          if (maybe) return maybe;
        }
      }
    }

    return null;
  }

  private static extractHttpImageUrlFromOpenAIChatMessage(
    message: any,
  ): string | null {
    // 1) message.images（某些兼容服务）
    const images = message?.images;
    if (Array.isArray(images)) {
      for (const part of images) {
        const url = part?.image_url?.url || part?.image_url?.uri || part?.url;
        if (typeof url === "string" && /^https?:\/\//i.test(url.trim())) {
          return url.trim();
        }
      }
    }

    // 2) 多模态 content 数组
    const content = message?.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        const url =
          part?.image_url?.url ||
          part?.image_url?.uri ||
          part?.url ||
          part?.uri;
        if (typeof url === "string" && /^https?:\/\//i.test(url.trim())) {
          return url.trim();
        }
      }
    }

    // 3) 文本 content（Markdown / HTML / 纯链接）
    if (typeof content === "string" && content.trim()) {
      const u = this.extractHttpImageUrlFromText(content);
      if (u && /^https?:\/\//i.test(u)) return u;
    }

    return null;
  }

  private static extractHttpImageUrlFromOpenAIResponseJson(
    json: any,
  ): string | null {
    // Images API: { data: [{ url }] }
    if (Array.isArray(json?.data) && json.data.length > 0) {
      const item = json.data.find((d: any) => d?.url) || json.data[0];
      const url = item?.url;
      if (typeof url === "string" && /^https?:\/\//i.test(url.trim())) {
        return url.trim();
      }
    }

    // Chat Completions: choices[].message
    if (Array.isArray(json?.choices) && json.choices.length > 0) {
      for (const choice of json.choices) {
        const msg = choice?.message || choice?.delta || choice;
        const url = this.extractHttpImageUrlFromOpenAIChatMessage(msg);
        if (url) return url;
      }
    }

    // Responses API: output[].content
    if (Array.isArray(json?.output) && json.output.length > 0) {
      for (const out of json.output) {
        const url = this.extractHttpImageUrlFromOpenAIChatMessage(out);
        if (url) return url;
        const content = out?.content;
        if (Array.isArray(content)) {
          for (const part of content) {
            const u =
              part?.image_url?.url ||
              part?.image_url?.uri ||
              part?.url ||
              part?.uri;
            if (typeof u === "string" && /^https?:\/\//i.test(u.trim())) {
              return u.trim();
            }
          }
        }
      }
    }

    return null;
  }

  private static extractImageFromOpenAIResponseJson(json: any): {
    imageBase64: string;
    mimeType: string;
  } | null {
    // 1) OpenAI Images API: { data: [{ b64_json }] }
    if (Array.isArray(json?.data) && json.data.length > 0) {
      const item =
        json.data.find((d: any) => d?.b64_json || d?.b64) || json.data[0];
      const b64 = item?.b64_json || item?.b64;
      if (typeof b64 === "string" && b64.trim()) {
        return { mimeType: "image/png", imageBase64: b64.trim() };
      }
      const url = item?.url;
      if (typeof url === "string") {
        const maybe = this.extractImageFromDataUrl(url.trim());
        if (maybe) return maybe;
      }
    }

    // 2) Chat Completions: { choices: [{ message: { content } }] }
    if (Array.isArray(json?.choices) && json.choices.length > 0) {
      for (const choice of json.choices) {
        const msg = choice?.message || choice?.delta || choice;
        const maybe = this.extractImageFromOpenAIChatMessage(msg);
        if (maybe) return maybe;
      }
    }

    // 3) Responses API: { output: [{ content: [...] }] }
    if (Array.isArray(json?.output) && json.output.length > 0) {
      for (const out of json.output) {
        const content = out?.content;
        if (Array.isArray(content)) {
          for (const part of content) {
            const type = String(part?.type || "").toLowerCase();
            if (type === "output_image" || type === "image") {
              const b64 = part?.image_base64 || part?.b64_json || part?.data;
              if (typeof b64 === "string" && b64.trim()) {
                const mime = part?.mime_type || part?.mimeType;
                return {
                  mimeType: mime || "image/png",
                  imageBase64: b64.trim(),
                };
              }
            }
            const url = part?.image_url?.url || part?.url;
            if (typeof url === "string") {
              const maybe = this.extractImageFromDataUrl(url.trim());
              if (maybe) return maybe;
            }
          }
        }
      }
    }

    // 4) 有些代理会直接返回 Gemini 格式
    if (Array.isArray(json?.candidates) && json.candidates.length > 0) {
      const parts = json?.candidates?.[0]?.content?.parts || [];
      const imagePart = parts.find((p: any) => p.inlineData);
      if (imagePart?.inlineData?.data) {
        return {
          imageBase64: imagePart.inlineData.data,
          mimeType: imagePart.inlineData.mimeType || "image/png",
        };
      }
    }

    return null;
  }

  private static async generateImageViaOpenAI(
    prompt: string,
    config: {
      apiKey: string;
      apiUrl: string;
      model: string;
      aspectRatio: string;
      resolution: string;
    },
  ): Promise<ImageGenerationResult> {
    const apiUrl = this.normalizeApiUrl(config.apiUrl);
    const model = (config.model || "").trim();
    let endpoint = apiUrl;
    if (
      !/(\/v1\/(chat\/completions|responses|images\/generations)\b|\/(chat\/completions|responses|images\/generations)\b)/i.test(
        endpoint,
      )
    ) {
      endpoint = /\/v1$/i.test(endpoint)
        ? `${endpoint}/chat/completions`
        : `${endpoint}/v1/chat/completions`;
    }

    const isImagesEndpoint =
      /\/(v1\/)?images\/generations\b/i.test(endpoint) &&
      !/\/chat\/completions\b/i.test(endpoint);
    const isResponsesEndpoint =
      /\/(v1\/)?responses\b/i.test(endpoint) &&
      !/\/chat\/completions\b/i.test(endpoint);

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    } as Record<string, string>;

    const payload: any = isImagesEndpoint
      ? {
          model,
          prompt,
          response_format: "b64_json",
        }
      : isResponsesEndpoint
        ? {
            model,
            input: [
              {
                role: "system",
                content: `You are an image generation model. Return a single image (no text). Aspect ratio: ${config.aspectRatio}; Resolution: ${config.resolution}.`,
              },
              { role: "user", content: prompt },
            ],
          }
        : {
            model,
            messages: [
              {
                role: "system",
                content: `You are an image generation model. Return a single image (no text). Aspect ratio: ${config.aspectRatio}; Resolution: ${config.resolution}.`,
              },
              { role: "user", content: prompt },
            ],
            temperature: 0.8,
            stream: false,
          };

    ztoolkit.log(`[AI-Butler] 调用 OpenAI 兼容生图 API: ${endpoint}`);
    ztoolkit.log(`[AI-Butler] 生图提示词长度: ${prompt.length} 字符`);

    let response: any;
    try {
      response = await Zotero.HTTP.request("POST", endpoint, {
        headers,
        body: JSON.stringify(payload),
        responseType: "text",
        timeout: 300000,
      });
    } catch (error: any) {
      const statusCode = error?.xmlhttp?.status;
      const responseBody =
        error?.xmlhttp?.response || error?.xmlhttp?.responseText || "";

      let errorMessage = error?.message || "OpenAI 兼容生图请求失败";
      let errorName = "NetworkError";

      try {
        if (responseBody) {
          const parsed =
            typeof responseBody === "string"
              ? JSON.parse(responseBody)
              : responseBody;

          // 处理标准 OpenAI 错误格式
          let err = parsed?.error || parsed;

          // 处理代理服务器返回的嵌套错误 (如 {"detail": "...JSON..."})
          if (parsed?.detail && typeof parsed.detail === "string") {
            const detailMatch = parsed.detail.match(/\{[\s\S]*\}/);
            if (detailMatch) {
              try {
                const nestedJson = JSON.parse(detailMatch[0]);
                err = nestedJson?.error || nestedJson;
              } catch {
                errorMessage = parsed.detail;
              }
            } else {
              errorMessage = parsed.detail;
            }
          }

          errorName =
            err?.code ||
            err?.type ||
            err?.status ||
            err?.errorName ||
            "APIError";
          if (err?.message) {
            errorMessage = err.message;
          }
        }
      } catch {
        /* ignore parse error */
      }

      throw new ImageGenerationError(errorMessage, {
        errorName,
        errorMessage,
        statusCode,
        requestUrl: endpoint,
        responseBody:
          typeof responseBody === "string"
            ? responseBody
            : JSON.stringify(responseBody),
      });
    }

    if (response.status !== 200) {
      throw new ImageGenerationError(`HTTP ${response.status}`, {
        errorName: `HTTP_${response.status}`,
        errorMessage: `HTTP ${response.status}: ${response.statusText || "请求失败"}`,
        statusCode: response.status,
        requestUrl: endpoint,
        responseBody: response.response,
      });
    }

    try {
      const json =
        typeof response.response === "string"
          ? JSON.parse(response.response)
          : response.response;

      const extracted = this.extractImageFromOpenAIResponseJson(json);
      if (extracted) {
        ztoolkit.log(
          `[AI-Butler] 成功生成图片，MIME: ${extracted.mimeType}, 大小: ${Math.round(extracted.imageBase64.length / 1024)} KB`,
        );
        return extracted;
      }

      // 兼容：模型可能返回一个可下载的图片 URL（Markdown / JSON url）
      const remoteUrl = this.extractHttpImageUrlFromOpenAIResponseJson(json);
      if (remoteUrl) {
        const downloaded = await this.downloadImageUrlAsBase64(remoteUrl);
        ztoolkit.log(
          `[AI-Butler] 成功下载图片，MIME: ${downloaded.mimeType}, 大小: ${Math.round(downloaded.imageBase64.length / 1024)} KB`,
        );
        return downloaded;
      }

      {
        const preview =
          typeof response.response === "string"
            ? response.response.substring(0, 800)
            : JSON.stringify(response.response).substring(0, 800);
        throw new ImageGenerationError("API 未返回图片数据", {
          errorName: "NoImageData",
          errorMessage:
            "OpenAI 兼容接口响应中未识别到图片数据。请确认接口是否支持图片输出，或尝试将 API 地址设置为完整端点（如 /v1/chat/completions 或 /v1/images/generations）。",
          requestUrl: endpoint,
          responseBody: preview,
        });
      }
    } catch (error: any) {
      if (error instanceof ImageGenerationError) throw error;
      throw new ImageGenerationError("解析 API 响应失败", {
        errorName: "ParseError",
        errorMessage: error?.message || "无法解析 OpenAI 兼容接口响应",
        requestUrl: endpoint,
        responseBody: response.response,
      });
    }
  }

  /**
   * 生成学术概念海报图片
   *
   * @param prompt 生图提示词 (已经过变量替换)
   * @param options 可选配置覆盖
   * @returns 包含 Base64 图片数据和 MIME 类型的结果
   */
  public static async generateImage(
    prompt: string,
    options?: {
      apiKey?: string;
      apiUrl?: string;
      model?: string;
      aspectRatio?: string;
      resolution?: string;
      requestMode?: ImageSummaryRequestMode;
    },
  ): Promise<ImageGenerationResult> {
    const requestMode = this.resolveRequestMode(
      options?.requestMode ||
        (getPref("imageSummaryRequestMode" as any) as string) ||
        "gemini",
    );

    // 从设置中获取 API 配置
    const apiKey =
      options?.apiKey || (getPref("imageSummaryApiKey" as any) as string) || "";
    const apiUrlPref = (getPref("imageSummaryApiUrl" as any) as string) || "";
    const apiUrl =
      options?.apiUrl ||
      apiUrlPref ||
      (requestMode === "openai"
        ? "https://api.openai.com/v1/chat/completions"
        : "https://generativelanguage.googleapis.com");
    const model =
      options?.model ||
      (getPref("imageSummaryModel" as any) as string) ||
      "gemini-3-pro-image-preview";
    const aspectRatio =
      options?.aspectRatio ||
      (getPref("imageSummaryAspectRatio" as any) as string) ||
      "16:9";
    const resolution =
      options?.resolution ||
      (getPref("imageSummaryResolution" as any) as string) ||
      "1K";

    if (!apiKey) {
      throw new ImageGenerationError("一图总结 API Key 未配置", {
        errorName: "ConfigurationError",
        errorMessage:
          requestMode === "openai"
            ? "请在设置页面配置一图总结的 OpenAI API Key"
            : "请在设置页面配置一图总结的 Gemini API Key",
      });
    }

    if (requestMode === "openai") {
      return await this.generateImageViaOpenAI(prompt, {
        apiKey,
        apiUrl,
        model,
        aspectRatio,
        resolution,
      });
    }

    const endpoint = `${apiUrl.replace(/\/$/, "")}/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const payload = {
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.8, // 稍高的温度以增加创造性
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: aspectRatio,
          imageSize: resolution,
        },
      },
    };

    ztoolkit.log(`[AI-Butler] 调用 Gemini 生图 API: ${endpoint}`);
    ztoolkit.log(`[AI-Butler] 生图提示词长度: ${prompt.length} 字符`);

    let response: any;
    try {
      response = await Zotero.HTTP.request("POST", endpoint, {
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(payload),
        responseType: "text",
        timeout: 300000, // 5 分钟超时，生图可能较慢
      });
    } catch (error: any) {
      const statusCode = error?.xmlhttp?.status;
      const responseBody =
        error?.xmlhttp?.response || error?.xmlhttp?.responseText || "";

      let errorMessage = error?.message || "Gemini 生图请求失败";
      let errorName = "NetworkError";

      try {
        if (responseBody) {
          const parsed =
            typeof responseBody === "string"
              ? JSON.parse(responseBody)
              : responseBody;

          // 处理标准 Gemini 错误格式
          let err = parsed?.error || parsed;

          // 处理代理服务器返回的嵌套错误 (如 {"detail": "...JSON..."})
          if (parsed?.detail && typeof parsed.detail === "string") {
            // detail 字段可能包含嵌套的 JSON 字符串
            const detailMatch = parsed.detail.match(/\{[\s\S]*\}/);
            if (detailMatch) {
              try {
                const nestedJson = JSON.parse(detailMatch[0]);
                err = nestedJson?.error || nestedJson;
              } catch {
                // 如果解析失败，使用原始 detail 作为错误信息
                errorMessage = parsed.detail;
              }
            } else {
              errorMessage = parsed.detail;
            }
          }

          errorName = err?.code || err?.status || "APIError";
          if (err?.message) {
            errorMessage = err.message;
          }
        }
      } catch {
        /* ignore parse error */
      }

      throw new ImageGenerationError(errorMessage, {
        errorName,
        errorMessage,
        statusCode,
        requestUrl: endpoint,
        responseBody:
          typeof responseBody === "string"
            ? responseBody
            : JSON.stringify(responseBody),
      });
    }

    // 解析响应
    if (response.status !== 200) {
      throw new ImageGenerationError(`HTTP ${response.status}`, {
        errorName: `HTTP_${response.status}`,
        errorMessage: `HTTP ${response.status}: ${response.statusText || "请求失败"}`,
        statusCode: response.status,
        requestUrl: endpoint,
        responseBody: response.response,
      });
    }

    try {
      const json =
        typeof response.response === "string"
          ? JSON.parse(response.response)
          : response.response;

      // 从响应中提取图片数据
      const candidates = json?.candidates || [];
      if (candidates.length === 0) {
        throw new ImageGenerationError("API 未返回任何结果", {
          errorName: "EmptyResponse",
          errorMessage: "Gemini API 返回了空的 candidates 数组",
          requestUrl: endpoint,
          responseBody: response.response,
        });
      }

      const parts = candidates[0]?.content?.parts || [];
      const imagePart = parts.find((p: any) => p.inlineData);

      if (!imagePart) {
        // 检查是否返回了文本而非图片
        const textPart = parts.find((p: any) => p.text);
        if (textPart) {
          throw new ImageGenerationError("API 返回了文本而非图片", {
            errorName: "NoImageGenerated",
            errorMessage: `模型返回了文本内容而非图片。请检查模型是否支持图片生成。\n\n返回内容: ${textPart.text?.substring(0, 200)}...`,
            requestUrl: endpoint,
            responseBody: response.response,
          });
        }
        throw new ImageGenerationError("API 未返回图片数据", {
          errorName: "NoImageData",
          errorMessage: "Gemini API 响应中未包含 inlineData 图片数据",
          requestUrl: endpoint,
          responseBody: response.response,
        });
      }

      const imageBase64 = imagePart.inlineData.data;
      const mimeType = imagePart.inlineData.mimeType || "image/png";

      ztoolkit.log(
        `[AI-Butler] 成功生成图片，MIME: ${mimeType}, 大小: ${Math.round(imageBase64.length / 1024)} KB`,
      );

      return {
        imageBase64,
        mimeType,
      };
    } catch (error: any) {
      if (error instanceof ImageGenerationError) {
        throw error;
      }
      throw new ImageGenerationError("解析 API 响应失败", {
        errorName: "ParseError",
        errorMessage: error?.message || "无法解析 Gemini API 响应",
        requestUrl: endpoint,
        responseBody: response.response,
      });
    }
  }

  /**
   * 测试 API 连接
   *
   * @param options 可选配置覆盖
   * @returns 测试结果
   */
  public static async testConnection(options?: {
    apiKey?: string;
    apiUrl?: string;
    model?: string;
  }): Promise<{ success: boolean; message: string }> {
    try {
      const result = await this.generateImage(
        "Generate a simple test image: a blue circle on white background.",
        options,
      );

      if (result.imageBase64) {
        return {
          success: true,
          message: `✅ 连接成功！生成了 ${result.mimeType} 格式的图片 (${Math.round(result.imageBase64.length / 1024)} KB)`,
        };
      } else {
        return {
          success: false,
          message: "⚠️ 连接成功但未返回图片数据",
        };
      }
    } catch (error: any) {
      const details =
        error instanceof ImageGenerationError ? error.details : null;
      return {
        success: false,
        message: `❌ 连接失败: ${details?.errorMessage || error.message}`,
      };
    }
  }

  /**
   * 格式化错误为详细报告 (用于 UI 显示)
   */
  public static formatError(error: any): string {
    if (error instanceof ImageGenerationError) {
      const d = error.details;
      let report = `错误名称: ${d.errorName}\n`;
      report += `错误信息: ${d.errorMessage}\n`;
      if (d.statusCode) {
        report += `HTTP 状态码: ${d.statusCode}\n`;
      }
      if (d.requestUrl) {
        report += `请求地址: ${d.requestUrl}\n`;
      }
      if (d.responseBody) {
        report += `\n响应内容:\n${d.responseBody.substring(0, 1000)}`;
        if (d.responseBody.length > 1000) {
          report += "\n... (已截断)";
        }
      }
      return report;
    }
    return error?.message || String(error);
  }
}

export default ImageClient;
