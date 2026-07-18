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

import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import type { LLMAbortSignal } from "./llmproviders/types";
import {
  bindAbortSignal,
  isAbortError,
  normalizeAbortError,
  throwIfAborted,
} from "./llmproviders/shared/requestAbort";

export type ImageSummaryRequestMode = "gemini" | "openai";
export type ImageSummaryCustomHeadersInput =
  | string
  | Record<string, unknown>
  | null
  | undefined;

const DEFAULT_IMAGE_SUMMARY_REQUEST_TIMEOUT_SECONDS = 600;
const MIN_IMAGE_SUMMARY_REQUEST_TIMEOUT_SECONDS = 30;

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
  /**
   * 获取一图总结生图请求超时时间，单位秒，最小 30 秒。
   */
  public static getImageSummaryRequestTimeoutSeconds(value?: unknown): number {
    const raw =
      value !== undefined
        ? value
        : (getPref("imageSummaryRequestTimeoutSeconds" as any) as string) ||
          String(DEFAULT_IMAGE_SUMMARY_REQUEST_TIMEOUT_SECONDS);
    const timeout =
      typeof raw === "number" ? raw : parseInt(String(raw).trim(), 10);

    if (!Number.isFinite(timeout) || timeout <= 0) {
      return DEFAULT_IMAGE_SUMMARY_REQUEST_TIMEOUT_SECONDS;
    }
    return Math.max(timeout, MIN_IMAGE_SUMMARY_REQUEST_TIMEOUT_SECONDS);
  }

  public static getImageSummaryRequestTimeoutMs(seconds?: unknown): number {
    return this.getImageSummaryRequestTimeoutSeconds(seconds) * 1000;
  }

  private static normalizeRequestTimeoutMs(value?: unknown): number {
    if (value === undefined) return this.getImageSummaryRequestTimeoutMs();

    const timeout =
      typeof value === "number" ? value : parseInt(String(value).trim(), 10);
    if (!Number.isFinite(timeout) || timeout <= 0) {
      return this.getImageSummaryRequestTimeoutMs();
    }

    return Math.max(timeout, MIN_IMAGE_SUMMARY_REQUEST_TIMEOUT_SECONDS * 1000);
  }

  private static resolveRequestMode(value: unknown): ImageSummaryRequestMode {
    const raw = String(value || "")
      .trim()
      .toLowerCase();
    if (raw === "openai" || raw === "openai-compat") return "openai";
    return "gemini";
  }

  /**
   * Gecko HTTP/2 workaround for Gemini direct connections.
   *
   * Temporarily disables HTTP/2 to force HTTP/1.1 and raises network
   * timeout prefs to match the configured request timeout.
   *
   * Only used for the Gemini path where the target host has no existing
   * HTTP/2 connection in the pool.  NOT used for OpenAI-compatible
   * proxies — those require server-side proxy_read_timeout tuning.
   */
  private static applyGeckoHttpWorkaround(
    requestTimeoutMs: number,
  ): { key: string; type: "int" | "bool"; val: any }[] {
    const savedPrefs: { key: string; type: "int" | "bool"; val: any }[] = [];

    const tuneIntPref = (key: string, newVal: number) => {
      try {
        let old: number | null = null;
        try {
          old = Services.prefs.getIntPref(key);
        } catch {
          /* pref does not exist */
        }
        savedPrefs.push({ key, type: "int", val: old });
        Services.prefs.setIntPref(key, newVal);
      } catch {
        /* ignore */
      }
    };

    const tuneBoolPref = (key: string, newVal: boolean) => {
      try {
        let old: boolean | null = null;
        try {
          old = Services.prefs.getBoolPref(key);
        } catch {
          /* pref does not exist */
        }
        savedPrefs.push({ key, type: "bool", val: old });
        Services.prefs.setBoolPref(key, newVal);
      } catch {
        /* ignore */
      }
    };

    tuneBoolPref("network.http.http2.enabled", false);
    tuneBoolPref("network.http.spdy.enabled", false);
    const networkTimeoutSeconds = Math.max(
      30,
      Math.ceil(requestTimeoutMs / 1000),
    );
    tuneIntPref("network.http.response.timeout", networkTimeoutSeconds);
    tuneIntPref("network.http.connection-timeout", networkTimeoutSeconds);

    return savedPrefs;
  }

  private static restoreGeckoPrefs(
    savedPrefs: { key: string; type: "int" | "bool"; val: any }[],
  ): void {
    for (const { key, type, val } of savedPrefs) {
      try {
        if (val !== null) {
          if (type === "bool") Services.prefs.setBoolPref(key, val);
          else Services.prefs.setIntPref(key, val);
        } else {
          Services.prefs.clearUserPref(key);
        }
      } catch {
        /* ignore */
      }
    }
  }

  private static normalizeApiUrl(url: string): string {
    return (url || "").trim().replace(/\/$/, "");
  }

  private static parseCustomHeadersText(text: string): unknown {
    const input = text.trim();
    if (!input) return {};

    try {
      return JSON.parse(input);
    } catch {
      /* Try common Python-dict snippets below. */
    }

    let normalized = input.replace(/^\s*headers\s*=\s*/i, "").trim();
    normalized = normalized.replace(/\{\s*\*\*[^,}]+,\s*/g, "{");
    normalized = normalized.replace(/,\s*\*\*[^,}]+(?=,|\})/g, "");
    normalized = normalized
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/\bNone\b/g, "null")
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, value: string) => {
        return JSON.stringify(value.replace(/\\'/g, "'"));
      });

    return JSON.parse(normalized);
  }

  private static parseCustomHeaders(
    rawHeaders: ImageSummaryCustomHeadersInput,
  ): Record<string, string> {
    if (!rawHeaders) return {};

    let parsed: unknown;
    try {
      parsed =
        typeof rawHeaders === "string"
          ? this.parseCustomHeadersText(rawHeaders)
          : rawHeaders;
    } catch (error: any) {
      throw new ImageGenerationError(
        getString("image-client-error-custom-headers-format"),
        {
          errorName: "InvalidCustomHeaders",
          errorMessage:
            error?.message ||
            getString("image-client-error-custom-headers-object"),
        },
      );
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ImageGenerationError(
        getString("image-client-error-custom-headers-format"),
        {
          errorName: "InvalidCustomHeaders",
          errorMessage: getString("image-client-error-custom-headers-object"),
        },
      );
    }

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      const headerName = name.trim();
      if (!headerName) continue;
      if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(headerName)) {
        throw new ImageGenerationError(
          getString("image-client-error-custom-header-name"),
          {
            errorName: "InvalidCustomHeaderName",
            errorMessage: getString(
              "image-client-error-custom-header-name-detail",
              { args: { name: headerName } },
            ),
          },
        );
      }
      if (
        value === null ||
        value === undefined ||
        (typeof value !== "string" &&
          typeof value !== "number" &&
          typeof value !== "boolean")
      ) {
        throw new ImageGenerationError(
          getString("image-client-error-custom-header-value"),
          {
            errorName: "InvalidCustomHeaderValue",
            errorMessage: getString(
              "image-client-error-custom-header-value-type",
              { args: { name: headerName } },
            ),
          },
        );
      }

      const headerValue = String(value).trim();
      if (/[\r\n]/.test(headerValue)) {
        throw new ImageGenerationError(
          getString("image-client-error-custom-header-value"),
          {
            errorName: "InvalidCustomHeaderValue",
            errorMessage: getString(
              "image-client-error-custom-header-value-newline",
              { args: { name: headerName } },
            ),
          },
        );
      }
      headers[headerName] = headerValue;
    }

    return headers;
  }

  private static mergeRequestHeaders(
    baseHeaders: Record<string, string>,
    customHeaders: ImageSummaryCustomHeadersInput,
  ): Record<string, string> {
    const merged = { ...baseHeaders };
    const protectedHeaderNames = new Set(
      Object.keys(baseHeaders).map((name) => name.toLowerCase()),
    );

    for (const [name, value] of Object.entries(
      this.parseCustomHeaders(customHeaders),
    )) {
      if (protectedHeaderNames.has(name.toLowerCase())) continue;
      merged[name] = value;
    }

    return merged;
  }

  private static extractImageFromDataUrl(dataUrl: string): {
    imageBase64: string;
    mimeType: string;
  } | null {
    const m = dataUrl.match(
      /^data:([^;,]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=\s]+)\s*$/i,
    );
    if (!m) return null;

    const imageBase64 = m[2].replace(/\s+/g, "");
    const explicitMime = this.normalizeImageMimeType(m[1]);
    const sniffedMime = this.guessMimeTypeFromBase64(imageBase64);
    const mimeType = explicitMime || sniffedMime;
    if (!mimeType) return null;

    return { mimeType, imageBase64 };
  }

  private static normalizeImageMimeType(value: unknown): string | null {
    const mime = String(value || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!mime) return null;
    if (mime === "image/jpg") return "image/jpeg";
    if (
      mime === "image/png" ||
      mime === "image/jpeg" ||
      mime === "image/webp" ||
      mime === "image/gif"
    ) {
      return mime;
    }
    return null;
  }

  private static guessMimeTypeFromBytes(bytes: Uint8Array): string | null {
    if (bytes.byteLength >= 8) {
      if (
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      ) {
        return "image/png";
      }
    }

    if (
      bytes.byteLength >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    ) {
      return "image/jpeg";
    }

    if (bytes.byteLength >= 6) {
      const signature = String.fromCharCode(
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
      );
      if (signature === "GIF87a" || signature === "GIF89a") {
        return "image/gif";
      }
    }

    if (bytes.byteLength >= 12) {
      const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
      const webp = String.fromCharCode(
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
      );
      if (riff === "RIFF" && webp === "WEBP") {
        return "image/webp";
      }
    }

    return null;
  }

  private static getBytesFromBase64Prefix(base64: string): Uint8Array | null {
    const normalized = (base64 || "").replace(/\s+/g, "");
    if (!normalized) return null;

    const prefixLength = Math.min(normalized.length, 64);
    const alignedLength = Math.max(4, Math.floor(prefixLength / 4) * 4);
    const prefix = normalized.slice(0, alignedLength);

    try {
      const binary = atob(prefix);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    } catch {
      return null;
    }
  }

  private static guessMimeTypeFromBase64(base64: string): string | null {
    const bytes = this.getBytesFromBase64Prefix(base64);
    return bytes ? this.guessMimeTypeFromBytes(bytes) : null;
  }

  private static getMimeTypeFromOpenAIImageObject(
    source: any,
    fallback = "image/png",
  ): string {
    const explicit =
      source?.mime_type ||
      source?.mimeType ||
      source?.media_type ||
      source?.mediaType ||
      source?.data?.mime_type ||
      source?.data?.mimeType;
    const explicitMime = this.normalizeImageMimeType(explicit);
    if (explicitMime) return explicitMime;

    const outputFormat = String(
      source?.output_format ||
        source?.outputFormat ||
        source?.format ||
        source?.data?.output_format ||
        "",
    )
      .trim()
      .toLowerCase();
    if (outputFormat === "jpg") return "image/jpeg";
    if (["png", "jpeg", "webp", "gif"].includes(outputFormat)) {
      return `image/${outputFormat}`;
    }

    return fallback;
  }

  private static extractImageFromOpenAIObject(source: any): {
    imageBase64: string;
    mimeType: string;
  } | null {
    const b64 =
      source?.result ||
      source?.imageBase64 ||
      source?.image_base64 ||
      source?.b64_json ||
      source?.b64 ||
      source?.data?.b64 ||
      source?.data;
    if (typeof b64 !== "string" || !b64.trim()) {
      return null;
    }

    const trimmed = b64.trim();
    const dataUrlImage = this.extractImageFromDataUrl(trimmed);
    if (dataUrlImage) return dataUrlImage;
    if (/^https?:\/\//i.test(trimmed)) return null;

    const normalized = trimmed.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) return null;
    const sniffedMime = this.guessMimeTypeFromBase64(normalized);

    return {
      mimeType: sniffedMime || this.getMimeTypeFromOpenAIImageObject(source),
      imageBase64: normalized,
    };
  }

  private static guessMimeTypeFromUrl(url: string): string | null {
    const clean = (url || "").toLowerCase().split(/[?#]/)[0];
    if (clean.endsWith(".png")) return "image/png";
    if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "image/jpeg";
    if (clean.endsWith(".webp")) return "image/webp";
    if (clean.endsWith(".gif")) return "image/gif";
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

  private static bytesToBase64(bytes: Uint8Array): string {
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

  private static binaryStringToBytes(value: string): Uint8Array {
    const bytes = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i++) {
      bytes[i] = value.charCodeAt(i) & 0xff;
    }
    return bytes;
  }

  private static getImageMimeTypeForDownload(
    headerMime: string,
    endpoint: string,
    bytes: Uint8Array,
  ): string | null {
    return (
      this.normalizeImageMimeType(headerMime) ||
      this.guessMimeTypeFromBytes(bytes) ||
      this.guessMimeTypeFromUrl(endpoint)
    );
  }

  private static toDownloadedImageResult(
    bytes: Uint8Array,
    headerMime: string,
    endpoint: string,
  ): { imageBase64: string; mimeType: string } {
    const mimeType = this.getImageMimeTypeForDownload(
      headerMime,
      endpoint,
      bytes,
    );
    if (!mimeType) {
      throw new ImageGenerationError(
        getString("image-client-error-unsupported-downloaded-image"),
        {
          errorName: "UnsupportedImageMimeType",
          errorMessage: getString(
            "image-client-error-unsupported-downloaded-image-detail",
          ),
          requestUrl: endpoint,
          responseBody: JSON.stringify({
            contentType: headerMime || "",
            byteLength: bytes.byteLength,
            firstBytes: Array.from(bytes.slice(0, 12))
              .map((byte) => byte.toString(16).padStart(2, "0"))
              .join(" "),
          }),
        },
      );
    }

    return { imageBase64: this.bytesToBase64(bytes), mimeType };
  }

  private static async downloadImageUrlAsBase64(
    url: string,
    timeoutMs?: number,
  ): Promise<{ imageBase64: string; mimeType: string }> {
    const endpoint = url.trim();
    if (!endpoint)
      throw new Error(getString("image-client-error-empty-image-url"));
    const requestTimeoutMs = this.normalizeRequestTimeoutMs(timeoutMs);

    let res: any;
    try {
      res = await Zotero.HTTP.request("GET", endpoint, {
        headers: {
          Accept: "image/*,*/*;q=0.8",
        },
        responseType: "arraybuffer",
        timeout: requestTimeoutMs,
      });
    } catch (error: any) {
      const statusCode = error?.xmlhttp?.status;
      const responseBody =
        error?.xmlhttp?.response || error?.xmlhttp?.responseText || "";
      throw new ImageGenerationError(
        getString("image-client-error-download-failed"),
        {
          errorName: "ImageDownloadError",
          errorMessage:
            error?.message || getString("image-client-error-download-resource"),
          statusCode,
          requestUrl: endpoint,
          responseBody:
            typeof responseBody === "string"
              ? responseBody
              : JSON.stringify(responseBody),
        },
      );
    }

    if (res?.status !== 200) {
      const unknownValue = getString("common-unknown-value");
      throw new ImageGenerationError(`HTTP ${res?.status}`, {
        errorName: `HTTP_${res?.status || unknownValue}`,
        errorMessage: `HTTP ${res?.status || unknownValue}: ${res?.statusText || getString("image-client-error-download-status")}`,
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

    const body = res?.response;
    const bodyTag = Object.prototype.toString.call(body);
    if (body instanceof ArrayBuffer) {
      return this.toDownloadedImageResult(
        new Uint8Array(body),
        headerMime,
        endpoint,
      );
    }
    // 跨窗口/跨 realm 的 ArrayBuffer：instanceof 可能失效
    if (bodyTag === "[object ArrayBuffer]") {
      try {
        const bytes = new Uint8Array(body as any);
        if (bytes.byteLength > 0) {
          return this.toDownloadedImageResult(bytes, headerMime, endpoint);
        }
      } catch {
        /* ignore */
      }
    }
    if (body && typeof body === "object" && ArrayBuffer.isView(body)) {
      const view = body as ArrayBufferView;
      const bytes = new Uint8Array(
        view.buffer,
        view.byteOffset,
        view.byteLength,
      );
      return this.toDownloadedImageResult(bytes, headerMime, endpoint);
    }
    if (typeof body === "string" && body) {
      return this.toDownloadedImageResult(
        this.binaryStringToBytes(body),
        headerMime,
        endpoint,
      );
    }

    // 兜底：尝试把“看起来像 ArrayBuffer”的对象转成 Uint8Array
    if (
      body &&
      typeof body === "object" &&
      typeof (body as any).byteLength === "number"
    ) {
      try {
        const bytes = new Uint8Array(body as any);
        if (bytes.byteLength > 0) {
          return this.toDownloadedImageResult(bytes, headerMime, endpoint);
        }
      } catch {
        /* ignore */
      }
    }

    const bodyDebug = {
      bodyType: bodyTag,
      constructorName:
        body && typeof body === "object" ? (body as any).constructor?.name : "",
      byteLength:
        body &&
        typeof body === "object" &&
        typeof (body as any).byteLength === "number"
          ? (body as any).byteLength
          : undefined,
      keys:
        body && typeof body === "object"
          ? Object.keys(body as any).slice(0, 20)
          : undefined,
    };

    throw new ImageGenerationError(
      getString("image-client-error-download-failed"),
      {
        errorName: "EmptyImageBody",
        errorMessage: getString("image-client-error-download-empty-body"),
        requestUrl: endpoint,
        responseBody: JSON.stringify(bodyDebug),
      },
    );
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
          const parsedImage = this.extractImageFromOpenAIObject(parsed);
          if (parsedImage) return parsedImage;
        } catch {
          /* ignore */
        }
      }

      const maybe = this.extractImageFromDataUrl(trimmed);
      if (maybe) return maybe;
      // 尝试从文本中提取 data URL（例如 Markdown/JSON 中夹带）
      const match = content.match(
        /data:[^,;\s]+(?:;[^,]*)?;base64,[A-Za-z0-9+/=]+/i,
      );
      if (match) {
        const matchedImage = this.extractImageFromDataUrl(match[0]);
        if (matchedImage) return matchedImage;
      }

      // 兜底：纯 Base64（没有 data: 前缀）
      const normalized = trimmed.replace(/\s+/g, "");
      if (
        normalized.length > 1024 &&
        /^[A-Za-z0-9+/=]+$/.test(normalized) &&
        normalized.length % 4 === 0
      ) {
        return {
          mimeType: this.guessMimeTypeFromBase64(normalized) || "image/png",
          imageBase64: normalized,
        };
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
        if (
          type === "image" ||
          type === "output_image" ||
          type === "image_generation_call"
        ) {
          const partImage = this.extractImageFromOpenAIObject(part);
          if (partImage) return partImage;
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
        const partImage = this.extractImageFromOpenAIObject(part);
        if (partImage) return partImage;

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
        const directUrl =
          out?.result ||
          out?.url ||
          out?.uri ||
          out?.image_url?.url ||
          out?.image_url?.uri;
        if (
          typeof directUrl === "string" &&
          /^https?:\/\//i.test(directUrl.trim())
        ) {
          return directUrl.trim();
        }

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
      const itemImage = this.extractImageFromOpenAIObject(item);
      if (itemImage) return itemImage;
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
        const outputImage = this.extractImageFromOpenAIObject(out);
        if (outputImage) return outputImage;

        const content = out?.content;
        if (Array.isArray(content)) {
          for (const part of content) {
            const type = String(part?.type || "").toLowerCase();
            if (
              type === "output_image" ||
              type === "image" ||
              type === "image_generation_call"
            ) {
              const partImage = this.extractImageFromOpenAIObject(part);
              if (partImage) return partImage;
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
          mimeType:
            this.normalizeImageMimeType(imagePart.inlineData.mimeType) ||
            this.guessMimeTypeFromBase64(imagePart.inlineData.data) ||
            "image/png",
        };
      }
    }

    return null;
  }

  /**
   * 解析 OpenAI 兼容响应：优先普通 JSON，若上游错误返回 SSE(data: {...}) 则自动聚合为可消费 JSON。
   */
  private static parseOpenAICompatibleResponse(rawResponse: unknown): any {
    if (typeof rawResponse !== "string") {
      return rawResponse;
    }

    const trimmed = rawResponse.trim();
    if (!trimmed) return {};

    // 常规 JSON 响应
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      return JSON.parse(trimmed);
    }

    // 兼容：部分代理会忽略 stream=false，强制返回 SSE
    const sseNormalized = this.parseOpenAISseResponse(rawResponse);
    if (sseNormalized) {
      return sseNormalized;
    }

    // 让调用侧拿到原始 JSON.parse 错误语义（便于定位）
    return JSON.parse(trimmed);
  }

  /**
   * 将 Chat Completions SSE 文本（data: {...}\n\n）聚合为类 JSON 响应。
   * 仅用于 stream=false 但服务端错误返回流式时的容错。
   */
  private static parseOpenAISseResponse(rawResponse: string): any | null {
    if (!/^\s*data\s*:/im.test(rawResponse)) return null;

    const lines = rawResponse.split(/\r?\n/);
    const events: any[] = [];
    let mergedDeltaText = "";
    let lastEvent: any = null;
    let lastFinishReason: string | null = null;
    let finalResponse: any = null;
    const responseOutputItems: any[] = [];

    for (const line of lines) {
      if (!/^\s*data\s*:/i.test(line)) continue;
      const payload = line.replace(/^\s*data\s*:\s*/i, "").trim();
      if (!payload || payload === "[DONE]") continue;

      try {
        const evt = JSON.parse(payload);
        events.push(evt);
        lastEvent = evt;

        if (evt?.response && typeof evt.response === "object") {
          finalResponse = evt.response;
        }
        const responseItem = evt?.item || evt?.output_item;
        if (
          responseItem &&
          typeof responseItem === "object" &&
          typeof responseItem.type === "string"
        ) {
          responseOutputItems.push(responseItem);
        }
        if (
          String(evt?.type || "").includes("image_generation_call") &&
          typeof evt?.result === "string"
        ) {
          responseOutputItems.push({
            ...evt,
            type: "image_generation_call",
          });
        }

        const choices = Array.isArray(evt?.choices) ? evt.choices : [];
        for (const choice of choices) {
          const deltaContent = choice?.delta?.content;
          if (typeof deltaContent === "string" && deltaContent.length > 0) {
            mergedDeltaText += deltaContent;
          }
          if (
            typeof choice?.finish_reason === "string" &&
            choice.finish_reason.trim()
          ) {
            lastFinishReason = choice.finish_reason;
          }
        }
      } catch {
        // 忽略单条脏 chunk（例如上游返回了截断/非法 JSON）
      }
    }

    if (events.length === 0) return null;

    if (finalResponse || responseOutputItems.length > 0) {
      return {
        ...(finalResponse && typeof finalResponse === "object"
          ? finalResponse
          : {}),
        object: finalResponse?.object ?? "response",
        output: Array.isArray(finalResponse?.output)
          ? finalResponse.output
          : responseOutputItems,
      };
    }

    const finalText = mergedDeltaText.trim();
    return {
      ...(lastEvent && typeof lastEvent === "object" ? lastEvent : {}),
      object:
        typeof lastEvent?.object === "string" &&
        lastEvent.object.includes("chunk")
          ? "chat.completion"
          : (lastEvent?.object ?? "chat.completion"),
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: finalText,
          },
          finish_reason: lastFinishReason,
        },
      ],
    };
  }

  private static isGptImageModel(model: string): boolean {
    return /^gpt-image(?:$|[-_.:])/i.test((model || "").trim());
  }

  private static isGptImage2Model(model: string): boolean {
    return /^gpt-image-2(?:$|[-_.:])/i.test((model || "").trim());
  }

  private static isAgnesImageModel(model: string): boolean {
    return /^agnes-image(?:$|[-_.:])/i.test((model || "").trim());
  }

  private static gcd(a: number, b: number): number {
    let x = Math.abs(a);
    let y = Math.abs(b);
    while (y !== 0) {
      const t = y;
      y = x % y;
      x = t;
    }
    return x || 1;
  }

  private static lcm(a: number, b: number): number {
    return Math.abs(a * b) / this.gcd(a, b);
  }

  private static parseOpenAIAspectRatio(
    value: string,
  ): { widthUnits: number; heightUnits: number } | null {
    const raw = (value || "").trim();
    if (!raw) return null;

    const match = raw.match(/^(\d{1,5})\s*[:/xX]\s*(\d{1,5})$/);
    if (!match) return null;

    let widthUnits = parseInt(match[1], 10);
    let heightUnits = parseInt(match[2], 10);
    if (!widthUnits || !heightUnits) return null;

    const ratio =
      Math.max(widthUnits, heightUnits) / Math.min(widthUnits, heightUnits);
    if (ratio > 3) return null;

    const divisor = this.gcd(widthUnits, heightUnits);
    widthUnits = widthUnits / divisor;
    heightUnits = heightUnits / divisor;

    return { widthUnits, heightUnits };
  }

  private static parseOpenAIResolutionTier(
    value: string,
  ): "1K" | "2K" | "4K" | null {
    const raw = (value || "").trim().replace(/\s+/g, "").toUpperCase();
    if (!raw) return null;
    if (raw === "1K" || raw === "1024" || raw === "1024PX") return "1K";
    if (raw === "2K" || raw === "2048" || raw === "2048PX") return "2K";
    if (
      raw === "4K" ||
      raw === "3840" ||
      raw === "3840PX" ||
      raw === "4096" ||
      raw === "4096PX"
    ) {
      return "4K";
    }
    return null;
  }

  private static isValidOpenAIImageSize(
    width: number,
    height: number,
  ): boolean {
    if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
    if (width <= 0 || height <= 0) return false;
    if (width % 16 !== 0 || height % 16 !== 0) return false;
    if (Math.max(width, height) > 3840) return false;
    if (Math.max(width, height) / Math.min(width, height) > 3) return false;

    const pixels = width * height;
    return pixels >= 655360 && pixels <= 8294400;
  }

  private static normalizeOpenAIExplicitSize(value: string): string | null {
    const raw = (value || "").trim().toLowerCase();
    if (!raw) return null;
    if (raw === "auto") return "auto";

    const match = raw.match(/^(\d{2,5})\s*[x×]\s*(\d{2,5})$/i);
    if (!match) return null;

    const width = parseInt(match[1], 10);
    const height = parseInt(match[2], 10);
    if (!this.isValidOpenAIImageSize(width, height)) return null;

    return `${width}x${height}`;
  }

  private static buildFlexibleOpenAIImageSize(
    aspectRatio: string,
    resolution: string,
  ): string | null {
    const explicitSize = this.normalizeOpenAIExplicitSize(resolution);
    if (explicitSize) return explicitSize;

    const hasAspectRatio = !!(aspectRatio || "").trim();
    const parsedRatio = this.parseOpenAIAspectRatio(aspectRatio);
    if (hasAspectRatio && !parsedRatio) return null;

    const ratio = parsedRatio || {
      widthUnits: 1,
      heightUnits: 1,
    };
    const tier = this.parseOpenAIResolutionTier(resolution) || "1K";
    const targetLongEdge = tier === "4K" ? 3840 : tier === "2K" ? 2048 : 1024;

    const widthStep = 16 / this.gcd(ratio.widthUnits, 16);
    const heightStep = 16 / this.gcd(ratio.heightUnits, 16);
    const scaleStep = this.lcm(widthStep, heightStep);
    const longUnits = Math.max(ratio.widthUnits, ratio.heightUnits);
    const unitPixels = ratio.widthUnits * ratio.heightUnits;

    let scale = Math.max(
      scaleStep,
      Math.round(targetLongEdge / longUnits / scaleStep) * scaleStep,
    );

    const minScale =
      Math.ceil(Math.sqrt(655360 / unitPixels) / scaleStep) * scaleStep;
    scale = Math.max(scale, minScale);

    const maxEdgeScale = Math.floor(3840 / longUnits / scaleStep) * scaleStep;
    const maxPixelScale =
      Math.floor(Math.sqrt(8294400 / unitPixels) / scaleStep) * scaleStep;
    scale = Math.min(scale, maxEdgeScale, maxPixelScale);

    const width = ratio.widthUnits * scale;
    const height = ratio.heightUnits * scale;
    if (!this.isValidOpenAIImageSize(width, height)) return null;

    return `${width}x${height}`;
  }

  private static buildLegacyOpenAIImageSize(
    aspectRatio: string,
    resolution: string,
  ): string | null {
    const explicitSize = this.normalizeOpenAIExplicitSize(resolution);
    if (
      explicitSize === "auto" ||
      explicitSize === "1024x1024" ||
      explicitSize === "1536x1024" ||
      explicitSize === "1024x1536"
    ) {
      return explicitSize;
    }

    const hasAspectRatio = !!(aspectRatio || "").trim();
    const ratio = this.parseOpenAIAspectRatio(aspectRatio);
    if (hasAspectRatio && !ratio) return null;
    if (!ratio && !resolution) return null;
    if (!ratio) return "1024x1024";

    if (ratio.widthUnits === ratio.heightUnits) return "1024x1024";
    return ratio.widthUnits > ratio.heightUnits ? "1536x1024" : "1024x1536";
  }

  private static resolveOpenAIImageSize(
    config: {
      model: string;
      aspectRatio: string;
      resolution: string;
    },
    endpointType: "images" | "responses" | "chat",
  ): string | null {
    if (!config.aspectRatio && !config.resolution) {
      return this.isAgnesImageModel(config.model) && endpointType === "images"
        ? "1024x1024"
        : null;
    }

    if (endpointType === "responses" || this.isGptImage2Model(config.model)) {
      return this.buildFlexibleOpenAIImageSize(
        config.aspectRatio,
        config.resolution,
      );
    }

    return this.buildLegacyOpenAIImageSize(
      config.aspectRatio,
      config.resolution,
    );
  }

  private static buildOpenAIImagePayload(
    prompt: string,
    config: {
      model: string;
      aspectRatio: string;
      resolution: string;
    },
    endpointType: "images" | "responses" | "chat",
  ): any {
    const imageSize = this.resolveOpenAIImageSize(config, endpointType);

    if (endpointType === "images") {
      const payload: any = {
        model: config.model,
        prompt,
      };
      if (imageSize) payload.size = imageSize;
      if (this.isAgnesImageModel(config.model)) {
        const explicitSize = this.normalizeOpenAIExplicitSize(
          config.resolution,
        );
        const resolutionTier = this.parseOpenAIResolutionTier(
          config.resolution,
        );
        if (explicitSize && explicitSize !== "auto") {
          payload.size = explicitSize;
        } else if (resolutionTier) {
          payload.size = resolutionTier;
        } else {
          payload.size = payload.size || "1024x1024";
        }
        if (config.aspectRatio && resolutionTier) {
          payload.ratio = config.aspectRatio;
        }
        payload.return_base64 = true;
        return payload;
      }
      if (!this.isGptImageModel(config.model)) {
        payload.response_format = "b64_json";
      }
      return payload;
    }

    // 动态构建 system prompt，只包含非空的参数
    const parts = [
      "You are an image generation model. Return a single image (no text).",
    ];
    if (config.aspectRatio) parts.push(`Aspect ratio: ${config.aspectRatio}.`);
    if (config.resolution) parts.push(`Resolution: ${config.resolution}.`);
    const instruction = parts.join(" ");

    if (endpointType === "responses") {
      const imageTool: Record<string, string> = { type: "image_generation" };
      if (imageSize) imageTool.size = imageSize;
      return {
        model: config.model,
        input: `${instruction}\n\n${prompt}`,
        tools: [imageTool],
      };
    }

    return {
      model: config.model,
      messages: [
        { role: "system", content: instruction },
        { role: "user", content: prompt },
      ],
      temperature: 0.8,
      stream: false,
    };
  }

  private static async generateImageViaOpenAI(
    prompt: string,
    config: {
      apiKey: string;
      apiUrl: string;
      model: string;
      aspectRatio: string;
      resolution: string;
      customHeaders?: ImageSummaryCustomHeadersInput;
      requestTimeoutMs: number;
      abortSignal?: LLMAbortSignal;
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
        ? `${endpoint}/images/generations`
        : `${endpoint}/v1/images/generations`;
    }

    const isImagesEndpoint =
      /\/(v1\/)?images\/generations\b/i.test(endpoint) &&
      !/\/chat\/completions\b/i.test(endpoint);
    const isResponsesEndpoint =
      /\/(v1\/)?responses\b/i.test(endpoint) &&
      !/\/chat\/completions\b/i.test(endpoint);

    const headers = this.mergeRequestHeaders(
      {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      config.customHeaders,
    );

    const payload = this.buildOpenAIImagePayload(
      prompt,
      {
        model,
        aspectRatio: config.aspectRatio,
        resolution: config.resolution,
      },
      isImagesEndpoint ? "images" : isResponsesEndpoint ? "responses" : "chat",
    );

    ztoolkit.log(`[AI-Butler] 调用 OpenAI 兼容生图 API: ${endpoint}`);
    ztoolkit.log(`[AI-Butler] 生图提示词长度: ${prompt.length} 字符`);

    throwIfAborted(config.abortSignal);

    let response: any;
    let abortError: Error | null = null;
    let cleanupAbortSignal: (() => void) | undefined;
    try {
      response = await Zotero.HTTP.request("POST", endpoint, {
        headers,
        body: JSON.stringify(payload),
        responseType: "text",
        timeout: config.requestTimeoutMs,
        requestObserver: (xmlhttp: XMLHttpRequest) => {
          cleanupAbortSignal = bindAbortSignal(
            config.abortSignal,
            xmlhttp,
            (error) => {
              abortError = error;
            },
          );
        },
      });
    } catch (error: any) {
      if (abortError || isAbortError(error, config.abortSignal)) {
        throw normalizeAbortError(abortError || error, config.abortSignal);
      }

      const statusCode = error?.xmlhttp?.status;
      const responseBody =
        error?.xmlhttp?.response || error?.xmlhttp?.responseText || "";

      ztoolkit.log(
        `[AI-Butler] OpenAI 生图请求失败 — ` +
          `status=${statusCode}, ` +
          `name=${error?.name}, ` +
          `message=${error?.message}, ` +
          `result=${error?.result ? "0x" + error.result.toString(16) : "N/A"}`,
      );

      let errorMessage =
        error?.message || getString("image-client-error-openai-request-failed");
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
    } finally {
      cleanupAbortSignal?.();
    }

    ztoolkit.log(
      `[AI-Butler] OpenAI 生图请求完成 — ` +
        `status=${response.status}, ` +
        `responseSize=${response.response?.length ?? 0}`,
    );

    if (response.status !== 200) {
      throw new ImageGenerationError(`HTTP ${response.status}`, {
        errorName: `HTTP_${response.status}`,
        errorMessage: `HTTP ${response.status}: ${response.statusText || getString("image-client-error-request-failed")}`,
        statusCode: response.status,
        requestUrl: endpoint,
        responseBody: response.response,
      });
    }

    try {
      const json = this.parseOpenAICompatibleResponse(response.response);

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
        const downloaded = await this.downloadImageUrlAsBase64(
          remoteUrl,
          config.requestTimeoutMs,
        );
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
        throw new ImageGenerationError(
          getString("image-client-error-no-image-data"),
          {
            errorName: "NoImageData",
            errorMessage: getString("image-client-error-no-image-data-detail"),
            requestUrl: endpoint,
            responseBody: preview,
          },
        );
      }
    } catch (error: any) {
      if (error instanceof ImageGenerationError) throw error;
      throw new ImageGenerationError(
        getString("image-client-error-parse-response"),
        {
          errorName: "ParseError",
          errorMessage:
            error?.message ||
            getString("image-client-error-parse-openai-response"),
          requestUrl: endpoint,
          responseBody: response.response,
        },
      );
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
      customHeaders?: ImageSummaryCustomHeadersInput;
      requestTimeoutMs?: number;
      abortSignal?: LLMAbortSignal;
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
        ? "https://api.openai.com/v1/images/generations"
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
    const customHeaders =
      options?.customHeaders ??
      ((getPref("imageSummaryCustomHeaders" as any) as string) || "");
    const requestTimeoutMs = this.normalizeRequestTimeoutMs(
      options?.requestTimeoutMs,
    );
    // 读取启用/禁用设置（默认禁用以兼容更多 API 代理）
    const aspectRatioEnabled =
      (getPref("imageSummaryAspectRatioEnabled" as any) as boolean) ?? false;
    const resolutionEnabled =
      (getPref("imageSummaryResolutionEnabled" as any) as boolean) ?? false;

    if (!apiKey) {
      throw new ImageGenerationError(
        getString("image-client-error-api-key-missing"),
        {
          errorName: "ConfigurationError",
          errorMessage:
            requestMode === "openai"
              ? getString("image-client-error-openai-key-missing")
              : getString("image-client-error-gemini-key-missing"),
        },
      );
    }

    if (requestMode === "openai") {
      return await this.generateImageViaOpenAI(prompt, {
        apiKey,
        apiUrl,
        model,
        aspectRatio: aspectRatioEnabled ? aspectRatio : "",
        resolution: resolutionEnabled ? resolution : "",
        customHeaders,
        requestTimeoutMs,
        abortSignal: options?.abortSignal,
      });
    }

    const endpoint = `${apiUrl.replace(/\/$/, "")}/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    // 动态构建 imageConfig，只包含启用的参数
    const imageConfig: Record<string, string> = {};
    if (aspectRatioEnabled) {
      imageConfig.aspectRatio = aspectRatio;
    }
    if (resolutionEnabled) {
      imageConfig.imageSize = resolution;
    }

    const payload: any = {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.8, // 稍高的温度以增加创造性
        responseModalities: ["TEXT", "IMAGE"],
      },
    };

    // 只有在有启用的参数时才添加 imageConfig
    if (Object.keys(imageConfig).length > 0) {
      payload.generationConfig.imageConfig = imageConfig;
    }

    const headers = this.mergeRequestHeaders(
      {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      customHeaders,
    );

    ztoolkit.log(
      `[AI-Butler] 调用 Gemini 生图 API: ${endpoint}, 提示词: ${prompt.length} 字符`,
    );
    const requestStartTime = Date.now();

    throwIfAborted(options?.abortSignal);

    const savedPrefs = this.applyGeckoHttpWorkaround(requestTimeoutMs);

    let response: any;
    let abortError: Error | null = null;
    let cleanupAbortSignal: (() => void) | undefined;
    try {
      response = await Zotero.HTTP.request("POST", endpoint, {
        headers,
        body: JSON.stringify(payload),
        responseType: "text",
        timeout: requestTimeoutMs,
        requestObserver: (xmlhttp: XMLHttpRequest) => {
          cleanupAbortSignal = bindAbortSignal(
            options?.abortSignal,
            xmlhttp,
            (error) => {
              abortError = error;
            },
          );
        },
      });
    } catch (error: any) {
      if (abortError || isAbortError(error, options?.abortSignal)) {
        throw normalizeAbortError(abortError || error, options?.abortSignal);
      }

      const statusCode = error?.xmlhttp?.status;
      const responseBody =
        error?.xmlhttp?.response || error?.xmlhttp?.responseText || "";

      let errorMessage =
        error?.message || getString("image-client-gemini-request-failed");
      let errorName = "NetworkError";

      try {
        if (responseBody) {
          const parsed =
            typeof responseBody === "string"
              ? JSON.parse(responseBody)
              : responseBody;

          let err = parsed?.error || parsed;

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
    } finally {
      cleanupAbortSignal?.();
      this.restoreGeckoPrefs(savedPrefs);
    }

    const elapsedSec = ((Date.now() - requestStartTime) / 1000).toFixed(1);

    // 处理 HTTP 错误
    if (response.status !== 200) {
      let errorMessage = `HTTP ${response.status}`;
      let errorName = `HTTP_${response.status}`;

      try {
        if (response.response) {
          const parsed = JSON.parse(response.response);
          let err = parsed?.error || parsed;

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
        statusCode: response.status,
        requestUrl: endpoint,
        responseBody:
          typeof response.response === "string"
            ? response.response.substring(0, 1000)
            : response.response,
      });
    }

    ztoolkit.log(
      `[AI-Butler] 生图响应完成, 耗时 ${elapsedSec}s, 大小: ${Math.round((response.response?.length || 0) / 1024)} KB`,
    );

    // 解析响应
    try {
      const json =
        typeof response.response === "string"
          ? JSON.parse(response.response)
          : response.response;

      const candidates = json?.candidates || [];
      if (candidates.length === 0) {
        throw new ImageGenerationError(
          getString("image-client-error-empty-response"),
          {
            errorName: "EmptyResponse",
            errorMessage: getString(
              "image-client-error-gemini-empty-candidates",
            ),
            requestUrl: endpoint,
            responseBody:
              typeof response.response === "string"
                ? response.response.substring(0, 1000)
                : response.response,
          },
        );
      }

      const parts = candidates[0]?.content?.parts || [];
      const imagePart = parts.find((p: any) => p.inlineData);

      if (!imagePart) {
        const textPart = parts.find((p: any) => p.text);
        if (textPart) {
          throw new ImageGenerationError(
            getString("image-client-error-text-not-image"),
            {
              errorName: "NoImageGenerated",
              errorMessage: getString(
                "image-client-error-text-not-image-detail",
                {
                  args: { text: textPart.text?.substring(0, 200) || "" },
                },
              ),
              requestUrl: endpoint,
              responseBody:
                typeof response.response === "string"
                  ? response.response.substring(0, 1000)
                  : response.response,
            },
          );
        }
        throw new ImageGenerationError(
          getString("image-client-error-no-image-data"),
          {
            errorName: "NoImageData",
            errorMessage: getString("image-client-error-gemini-no-inline-data"),
            requestUrl: endpoint,
            responseBody:
              typeof response.response === "string"
                ? response.response.substring(0, 1000)
                : response.response,
          },
        );
      }

      const imageBase64 = imagePart.inlineData.data;
      const mimeType =
        this.normalizeImageMimeType(imagePart.inlineData.mimeType) ||
        this.guessMimeTypeFromBase64(imageBase64) ||
        "image/png";

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
      throw new ImageGenerationError(
        getString("image-client-error-parse-response"),
        {
          errorName: "ParseError",
          errorMessage:
            error?.message ||
            getString("image-client-error-parse-gemini-response"),
          requestUrl: endpoint,
          responseBody:
            typeof response.response === "string"
              ? response.response.substring(0, 1000)
              : response.response,
        },
      );
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
    requestMode?: ImageSummaryRequestMode;
    customHeaders?: ImageSummaryCustomHeadersInput;
    requestTimeoutMs?: number;
  }): Promise<{ success: boolean; message: string }> {
    try {
      const result = await this.generateImage(
        "Generate a simple test image: a blue circle on white background.",
        options,
      );

      if (result.imageBase64) {
        return {
          success: true,
          message: getString("image-client-test-success", {
            args: {
              mimeType: result.mimeType,
              size: Math.round(result.imageBase64.length / 1024),
            },
          }),
        };
      } else {
        return {
          success: false,
          message: getString("image-client-test-no-image"),
        };
      }
    } catch (error: any) {
      const details =
        error instanceof ImageGenerationError ? error.details : null;
      return {
        success: false,
        message: getString("image-client-test-failed", {
          args: { message: details?.errorMessage || error.message },
        }),
      };
    }
  }

  /**
   * 格式化错误为详细报告 (用于 UI 显示)
   */
  public static formatError(error: any): string {
    if (error instanceof ImageGenerationError) {
      const d = error.details;
      let report = `${getString("image-client-error-name", {
        args: { name: d.errorName },
      })}\n`;
      report += `${getString("image-client-error-message", {
        args: { message: d.errorMessage },
      })}\n`;
      if (d.statusCode) {
        report += `${getString("image-client-error-http-status", {
          args: { status: d.statusCode },
        })}\n`;
      }
      if (d.requestUrl) {
        report += `${getString("image-client-error-request-url", {
          args: { url: d.requestUrl },
        })}\n`;
      }
      if (d.responseBody) {
        report += `\n${getString("image-client-error-response-body")}\n${d.responseBody.substring(0, 1000)}`;
        if (d.responseBody.length > 1000) {
          report += `\n${getString("image-client-error-truncated")}`;
        }
      }
      return report;
    }
    return error?.message || String(error);
  }
}

export default ImageClient;
