/**
 * ================================================================
 * MinerU OCR 交互模块
 * ================================================================
 *
 * 本模块提供与 MinerU API 的交互功能
 *
 * 主要职责: 利用 MinerU OCR API 从PDF文件中提取文本
 *
 * 技术实现:
 * - 使用 MinerU API 进行 PDF OCR 提取
 * - 通过 API 返回的 zip 文件提取 Markdown 内容
 *
 * @module mineruIntegration
 * @author AI-Butler Team
 */

import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import {
  getMineruServiceConfig,
  getMineruRequestHeaders,
  resolveMineruResultUrl,
  type MineruServiceConfig,
} from "./mineruConfig";
import { PDFExtractor } from "./pdfExtractor";
import {
  MineruMarkdownSaver,
  type MineruMarkdownAsset,
} from "./mineruMarkdownSaver";
import JSZip from "jszip";
import type { PdfExtractionProgressCallback } from "./pdfExtractor";
import type { LLMAbortSignal } from "./llmproviders/types";
import {
  createAbortError,
  isAbortError,
  normalizeAbortError,
  throwIfAborted,
} from "./llmproviders/shared/requestAbort";

type MineruModelVersion = "pipeline" | "vlm";
const MINERU_POLL_INTERVAL_MS = 5000;
const DEFAULT_MINERU_TIMEOUT_MS = 300000;

interface MineruExtractedResult {
  markdown: string;
  assets: MineruMarkdownAsset[];
}

interface MineruV4BatchResponse {
  data?: {
    batch_id?: string;
    file_urls?: string[];
    urls?: string[] | Record<string, string>;
    items?: Array<{ url?: string }>;
    upload_url?: string;
  };
}

interface MineruV1Upload {
  id?: string;
  status?: string;
  file?: { id?: string };
  upload_url?: string;
  upload_method?: string;
  upload_headers?: Record<string, string>;
}

interface MineruV1Job {
  job_id?: string;
  status?: string;
  files?: Array<{
    status?: string;
    output_files?: { zip?: { file_id?: string } };
  }>;
}

function getMineruModelVersion(): MineruModelVersion {
  const raw = String(getPref("mineruModelVersion") || "vlm")
    .trim()
    .toLowerCase();
  return raw === "pipeline" ? "pipeline" : "vlm";
}

function getMineruTimeoutMs(): number {
  const raw = String(getPref("requestTimeout") || DEFAULT_MINERU_TIMEOUT_MS);
  const timeout = parseInt(raw, 10);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    return DEFAULT_MINERU_TIMEOUT_MS;
  }
  return Math.max(timeout, 30000);
}

/**
 * MinerU Wrapper
 *
 * 调用逻辑
 * 1. 构建OCR上传路径
 * 2. 上传PDF文件
 * 3. 获取并下载解析结果
 * 4. 提取Markdown
 *
 * 错误处理：
 * - API 调用失败: 包含 API 错误详情
 * - PDF 提取失败: 抛出明确的错误信息
 *
 * @param item Zotero Item
 * @returns Markdown content
 * @throws 当任何步骤失败时抛出错误
 */
export class MineruClient {
  /**
   * Main entry to extract markdown from a Zotero PDF item using MinerU
   */
  public static async extractMarkdown(
    item: Zotero.Item,
    progressCallback?: PdfExtractionProgressCallback,
    options: { persist?: boolean; abortSignal?: LLMAbortSignal } = {},
  ): Promise<string> {
    const signal = options.abortSignal;
    throwIfAborted(signal);
    // A native signal works with fetch even when the caller uses a structural
    // signal from a different Zotero window or the Agent runner.
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    const timeoutMs = getMineruTimeoutMs();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    signal?.addEventListener?.("abort", abort, { once: true });
    try {
      throwIfAborted(signal);
      return await this.extractMarkdownWithSignal(item, progressCallback, {
        persist: options.persist,
        abortSignal: controller.signal,
      });
    } catch (error) {
      if (timedOut && !signal?.aborted) {
        throw new Error(
          getString("mineru-error-task-timeout", { args: { timeoutMs } }),
          { cause: error },
        );
      }
      if (isAbortError(error, signal)) {
        throw normalizeAbortError(error, signal);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", abort);
    }
  }

  private static async extractMarkdownWithSignal(
    item: Zotero.Item,
    progressCallback: PdfExtractionProgressCallback | undefined,
    options: { persist?: boolean; abortSignal: AbortSignal },
  ): Promise<string> {
    const signal = options.abortSignal;
    throwIfAborted(signal);
    const service = getMineruServiceConfig();

    if (options.persist === false || MineruMarkdownSaver.isSaveEnabled()) {
      const cachedMarkdown = await MineruMarkdownSaver.readCachedMarkdown(item);
      throwIfAborted(signal);
      if (cachedMarkdown) {
        ztoolkit.log(
          "[MineruIntegration] Reusing saved MinerU Markdown attachment.",
        );
        progressCallback?.(getString("progress-mineru-cache-message"), 38, {
          stage: "mineru-parsing",
          label: getString("progress-mineru-cache"),
          detail: getString("progress-mineru-cache-detail"),
        });
        return cachedMarkdown;
      }
    }

    // Get PDF file path
    const pdfAttachments = await PDFExtractor.getAllPdfAttachments(item);
    throwIfAborted(signal);
    if (!pdfAttachments || pdfAttachments.length === 0) {
      throw new Error(getString("mineru-error-no-pdf-attachment"));
    }
    const pdfAttachment = pdfAttachments[0];
    const filePath = await pdfAttachment.getFilePathAsync();
    throwIfAborted(signal);
    if (!filePath) {
      throw new Error(getString("mineru-error-pdf-path-not-found"));
    }

    ztoolkit.log(`[MineruIntegration] Starting MinerU parsing of ${filePath}`);
    progressCallback?.(getString("progress-mineru-preparing-message"), 12, {
      stage: "mineru-uploading",
      label: getString("progress-mineru-preparing"),
      detail: getString("progress-mineru-pdf-path-detail", {
        args: { path: filePath },
      }),
    });

    // Read PDF binary
    const fileData = await IOUtils.read(filePath);
    throwIfAborted(signal);

    const result =
      service.apiFormat === "file-parse"
        ? await this.extractViaFileParse(
            fileData,
            service,
            progressCallback,
            signal,
          )
        : service.apiFormat === "v1"
          ? await this.extractViaV1(fileData, service, progressCallback, signal)
          : await this.extractViaV4(
              fileData,
              service,
              progressCallback,
              signal,
            );
    throwIfAborted(signal);
    if (options.persist !== false && MineruMarkdownSaver.isSaveEnabled()) {
      progressCallback?.(getString("progress-mineru-save-cache-message"), 39, {
        stage: "mineru-parsing",
        label: getString("progress-mineru-save-cache"),
        detail: getString("progress-mineru-save-cache-detail"),
      });
      throwIfAborted(signal);
      await MineruMarkdownSaver.save(item, result.markdown, result.assets);
    }
    progressCallback?.(getString("progress-mineru-complete-message"), 40, {
      stage: "mineru-parsing",
      label: getString("progress-mineru-complete"),
      detail: getString("progress-mineru-extracted-detail", {
        args: { count: result.markdown.length },
      }),
    });
    return result.markdown;
  }

  private static async extractViaV4(
    fileData: Uint8Array,
    service: MineruServiceConfig,
    progressCallback: PdfExtractionProgressCallback | undefined,
    signal: AbortSignal,
  ): Promise<MineruExtractedResult> {
    const modelVersion = getMineruModelVersion();

    // Get Batch & Upload URLs
    // Assuming simple payload for /api/v4/file-urls/batch based on standard implementations
    const fileName = "document.pdf";
    progressCallback?.(getString("progress-mineru-upload-url-message"), 14, {
      stage: "mineru-uploading",
      label: getString("progress-mineru-upload-url"),
      detail: getString("progress-mineru-model-detail", {
        args: { model: modelVersion },
      }),
    });
    const batchRes = await fetch(`${service.apiUrl}/file-urls/batch`, {
      signal,
      method: "POST",
      headers: {
        ...getMineruRequestHeaders(service),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        files: [{ name: fileName }],
        model_version: modelVersion,
      }),
    });

    if (!batchRes.ok) {
      const err = await batchRes.text();
      throw new Error(
        getString("mineru-error-upload-url-failed", { args: { message: err } }),
      );
    }

    const batchData = (await batchRes.json()) as MineruV4BatchResponse;
    let putUrl = "";
    const batchId = batchData?.data?.batch_id;

    // Dynamic property search, crash if not found
    if (batchData?.data?.file_urls?.[0]) putUrl = batchData.data.file_urls[0];
    else if (Array.isArray(batchData?.data?.urls))
      putUrl = batchData.data.urls[0] || "";
    else if (batchData?.data?.urls?.[fileName])
      putUrl = batchData.data.urls[fileName];
    else if (batchData?.data?.items?.[0]?.url)
      putUrl = batchData.data.items[0].url;
    else if (batchData?.data?.upload_url) putUrl = batchData.data.upload_url;

    if (
      typeof putUrl !== "string" ||
      !putUrl ||
      typeof batchId !== "string" ||
      !batchId
    ) {
      throw new Error(
        `MinerU API returned unexpected batch response: ${JSON.stringify(batchData)}`,
      );
    }
    putUrl = resolveMineruResultUrl(service, putUrl);

    // Upload file content to the presigned URL
    ztoolkit.log(`[MineruIntegration] Uploading PDF to Mineru PUT URL...`);
    progressCallback?.(getString("progress-mineru-uploading-message"), 16, {
      stage: "mineru-uploading",
      label: getString("progress-mineru-uploading"),
      detail: getString("progress-mineru-upload-size-detail", {
        args: { size: (fileData.byteLength / 1024 / 1024).toFixed(2) },
      }),
    });
    const putRes = await fetch(putUrl, {
      signal,
      method: "PUT",
      headers: getMineruRequestHeaders(service, putUrl),
      body: new Uint8Array(fileData),
    });

    if (!putRes.ok) {
      const errText = await putRes.text();
      throw new Error(
        getString("mineru-error-upload-file-failed", {
          args: { status: putRes.status, message: errText },
        }),
      );
    }

    // Poll for task completion
    const timeoutMs = getMineruTimeoutMs();
    ztoolkit.log(
      `[MineruIntegration] Polling for task completion... Batch ID: ${batchId}, timeout: ${timeoutMs}ms`,
    );
    return await this.pollStatusAndDownload(
      service,
      batchId,
      timeoutMs,
      progressCallback,
      signal,
    );
  }

  private static async extractViaFileParse(
    fileData: Uint8Array,
    service: MineruServiceConfig,
    progressCallback: PdfExtractionProgressCallback | undefined,
    signal: AbortSignal,
  ): Promise<MineruExtractedResult> {
    // The local HTTP API uses multipart uploads and its own default backend.
    const FormDataCtor =
      typeof FormData === "undefined"
        ? ztoolkit.getGlobal("FormData")
        : FormData;
    const BlobCtor =
      typeof Blob === "undefined" ? ztoolkit.getGlobal("Blob") : Blob;
    const body = new FormDataCtor();
    body.append(
      "files",
      new BlobCtor([new Uint8Array(fileData)], { type: "application/pdf" }),
      "document.pdf",
    );
    body.append("return_md", "true");
    body.append("return_images", "true");
    body.append("response_format_zip", "true");
    progressCallback?.(getString("progress-mineru-processing-message"), 20, {
      stage: "mineru-processing",
      label: getString("progress-mineru-processing"),
    });
    const res = await fetch(`${service.apiUrl}/file_parse`, {
      signal,
      method: "POST",
      headers: getMineruRequestHeaders(service),
      body,
    });
    if (!res.ok) {
      throw new Error(
        getString("mineru-error-parse-failed", {
          args: { status: res.status, message: await res.text() },
        }),
      );
    }
    return await this.extractMarkdownFromZip(
      await res.arrayBuffer(),
      progressCallback,
      signal,
    );
  }

  private static async requestV1Json<T>(
    service: MineruServiceConfig,
    path: string,
    signal: AbortSignal,
    body?: unknown,
  ): Promise<T> {
    throwIfAborted(signal);
    const res = await fetch(`${service.apiUrl}${path}`, {
      signal,
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...getMineruRequestHeaders(service),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(
        getString("mineru-error-parse-failed", {
          args: { status: res.status, message: await res.text() },
        }),
      );
    }
    const result = await res.json();
    throwIfAborted(signal);
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error(getString("mineru-error-invalid-response"));
    }
    return result as T;
  }

  private static async extractViaV1(
    fileData: Uint8Array,
    service: MineruServiceConfig,
    progressCallback: PdfExtractionProgressCallback | undefined,
    signal: AbortSignal,
  ): Promise<MineruExtractedResult> {
    progressCallback?.(getString("progress-mineru-uploading-message"), 16, {
      stage: "mineru-uploading",
      label: getString("progress-mineru-uploading"),
    });
    let upload = await this.requestV1Json<MineruV1Upload>(
      service,
      "/uploads",
      signal,
      {
        filename: "document.pdf",
        bytes: fileData.byteLength,
        mime_type: "application/pdf",
        purpose: "parse",
      },
    );
    if (upload.status === "pending") {
      if (
        typeof upload.id !== "string" ||
        !upload.id ||
        typeof upload.upload_url !== "string" ||
        !upload.upload_url ||
        upload.upload_method !== "PUT"
      ) {
        throw new Error(getString("mineru-error-invalid-response"));
      }
      const putUrl = resolveMineruResultUrl(service, upload.upload_url);
      const uploadHeaders = { ...upload.upload_headers };
      for (const [key, value] of Object.entries(
        getMineruRequestHeaders(service, putUrl),
      )) {
        if (
          !Object.keys(uploadHeaders).some(
            (name) => name.toLowerCase() === key.toLowerCase(),
          )
        ) {
          uploadHeaders[key] = value;
        }
      }
      const res = await fetch(putUrl, {
        signal,
        method: "PUT",
        headers: uploadHeaders,
        body: new Uint8Array(fileData),
      });
      if (!res.ok) {
        throw new Error(
          getString("mineru-error-upload-file-failed", {
            args: { status: res.status, message: await res.text() },
          }),
        );
      }
      upload = await this.requestV1Json<MineruV1Upload>(
        service,
        `/uploads/${encodeURIComponent(upload.id)}/complete`,
        signal,
        {},
      );
    }
    const fileId = upload.file?.id;
    if (
      upload.status !== "completed" ||
      typeof fileId !== "string" ||
      !fileId
    ) {
      throw new Error(getString("mineru-error-invalid-response"));
    }
    const job = await this.requestV1Json<MineruV1Job>(
      service,
      "/parse/jobs",
      signal,
      {
        files: [{ source: { type: "file_id", file_id: fileId } }],
        output_formats: ["markdown", "zip"],
      },
    );
    if (typeof job.job_id !== "string" || !job.job_id) {
      throw new Error(getString("mineru-error-invalid-response"));
    }
    const startedAt = Date.now();
    const timeoutMs = getMineruTimeoutMs();
    let attempt = 0;
    while (Date.now() - startedAt < timeoutMs) {
      if (attempt > 0) await this.waitForPoll(MINERU_POLL_INTERVAL_MS, signal);
      const result = await this.requestV1Json<MineruV1Job>(
        service,
        `/parse/jobs/${encodeURIComponent(job.job_id)}`,
        signal,
      );
      attempt += 1;
      progressCallback?.(getString("progress-mineru-processing-message"), 25, {
        stage: "mineru-processing",
        label: getString("progress-mineru-processing"),
        detail: getString("progress-mineru-poll-detail", {
          args: {
            attempt,
            state: result.status || "pending",
            seconds: Math.floor((Date.now() - startedAt) / 1000),
            batchId: job.job_id,
          },
        }),
        attempt,
      });
      if (result.status === "completed" || result.status === "partial") {
        const file = result.files?.[0];
        if (file?.status !== "completed") {
          throw new Error(getString("mineru-error-task-failed"));
        }
        const zipId = file.output_files?.zip?.file_id;
        if (typeof zipId !== "string" || !zipId) {
          throw new Error(getString("mineru-error-invalid-response"));
        }
        return await this.downloadAndExtractMarkdown(
          `${service.apiUrl}/files/${encodeURIComponent(zipId)}/content`,
          progressCallback,
          signal,
          service,
        );
      }
      if (result.status === "failed" || result.status === "canceled") {
        throw new Error(getString("mineru-error-task-failed"));
      }
      if (result.status !== "queued" && result.status !== "running") {
        throw new Error(getString("mineru-error-invalid-response"));
      }
    }
    throw new Error(
      getString("mineru-error-task-timeout", { args: { timeoutMs } }),
    );
  }

  private static async pollStatusAndDownload(
    service: MineruServiceConfig,
    batchId: string,
    timeoutMs: number,
    progressCallback?: PdfExtractionProgressCallback,
    signal?: AbortSignal,
  ): Promise<MineruExtractedResult> {
    const url = `${service.apiUrl}/extract-results/batch/${encodeURIComponent(batchId)}`;
    const startedAt = Date.now();
    let attempt = 0;

    while (Date.now() - startedAt < timeoutMs) {
      throwIfAborted(signal);
      if (attempt > 0) {
        const remainingMs = timeoutMs - (Date.now() - startedAt);
        await this.waitForPoll(
          Math.min(MINERU_POLL_INTERVAL_MS, Math.max(remainingMs, 0)),
          signal,
        );
      }
      attempt += 1;

      const res = await fetch(url, {
        signal,
        headers: getMineruRequestHeaders(service),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(
          getString("mineru-error-poll-failed", {
            args: { status: res.status, message: errText },
          }),
        );
      }
      const data = (await res.json()) as any;
      throwIfAborted(signal);

      // Batch result usually returns an array under extract_result
      const result = data?.data?.extract_result?.[0] || data?.data;
      const state = result?.state;

      const elapsedMs = Date.now() - startedAt;
      const estimatedProgress = Math.min(
        35,
        20 + Math.floor((elapsedMs / timeoutMs) * 15),
      );
      progressCallback?.(
        getString("progress-mineru-processing-message"),
        estimatedProgress,
        {
          stage: "mineru-processing",
          label: getString("progress-mineru-processing"),
          detail: getString("progress-mineru-poll-detail", {
            args: {
              attempt,
              state: state || "pending",
              seconds: Math.floor(elapsedMs / 1000),
              batchId,
            },
          }),
          attempt,
        },
      );

      if (state === "done") {
        const zipUrl = result?.full_zip_url;
        if (!zipUrl) {
          throw new Error(getString("mineru-error-missing-result-url"));
        }
        progressCallback?.(
          getString("progress-mineru-downloading-message"),
          36,
          {
            stage: "mineru-downloading",
            label: getString("progress-mineru-downloading"),
            detail: getString("progress-mineru-download-ready-detail"),
          },
        );
        return await this.downloadAndExtractMarkdown(
          resolveMineruResultUrl(service, zipUrl),
          progressCallback,
          signal,
          service,
        );
      } else if (state === "error" || state === "failed") {
        throw new Error(getString("mineru-error-task-failed"));
      }

      // continue polling...
    }
    throw new Error(
      getString("mineru-error-task-timeout", { args: { timeoutMs } }),
    );
  }

  private static async downloadAndExtractMarkdown(
    zipUrl: string,
    progressCallback?: PdfExtractionProgressCallback,
    signal?: AbortSignal,
    service?: MineruServiceConfig,
  ): Promise<MineruExtractedResult> {
    throwIfAborted(signal);
    ztoolkit.log(`[MineruIntegration] Downloading zip result from ${zipUrl}`);
    const res = await fetch(zipUrl, {
      signal,
      headers: service ? getMineruRequestHeaders(service, zipUrl) : {},
    });
    if (!res.ok) {
      throw new Error(
        getString("mineru-error-download-zip-failed", {
          args: { url: zipUrl },
        }),
      );
    }
    const arrayBuffer = await res.arrayBuffer();
    return await this.extractMarkdownFromZip(
      arrayBuffer,
      progressCallback,
      signal,
    );
  }

  private static async extractMarkdownFromZip(
    arrayBuffer: ArrayBuffer,
    progressCallback?: PdfExtractionProgressCallback,
    signal?: AbortSignal,
  ): Promise<MineruExtractedResult> {
    throwIfAborted(signal);
    progressCallback?.(getString("progress-mineru-unzipping-message"), 37, {
      stage: "mineru-parsing",
      label: getString("progress-mineru-unzipping"),
      detail: getString("progress-mineru-zip-size-detail", {
        args: { size: (arrayBuffer.byteLength / 1024 / 1024).toFixed(2) },
      }),
    });

    // Extract using JSZip
    // Zotero/Firefox extension environment does not natively provide setImmediate which JSZip needs
    if (typeof (globalThis as any).setImmediate === "undefined") {
      (globalThis as any).setImmediate = (fn: (...args: any[]) => void) =>
        setTimeout(fn, 0);
    }

    const zip = new JSZip();
    await zip.loadAsync(arrayBuffer);
    throwIfAborted(signal);

    let mdContent = "";

    // Find the first valid markdown file
    const mdFiles = Object.values(zip.files).filter(
      (file) => file.name.endsWith(".md") && !file.name.includes("__MACOSX"),
    );

    if (mdFiles.length > 0) {
      mdContent = await mdFiles[0].async("string");
    }

    if (!mdContent) {
      throw new Error(getString("mineru-error-no-valid-markdown"));
    }

    throwIfAborted(signal);
    const assets = await this.extractMarkdownAssets(zip, mdContent, signal);
    throwIfAborted(signal);
    return { markdown: mdContent, assets };
  }

  private static async extractMarkdownAssets(
    zip: JSZip,
    markdown: string,
    signal?: AbortSignal,
  ): Promise<MineruMarkdownAsset[]> {
    const referencedPaths = this.extractImagePathsFromMarkdown(markdown);
    if (referencedPaths.size === 0) return [];

    const assets: MineruMarkdownAsset[] = [];
    for (const relativePath of referencedPaths) {
      throwIfAborted(signal);
      const zipFile = this.findZipFileByRelativePath(zip, relativePath);
      if (!zipFile) {
        ztoolkit.log(
          `[MineruIntegration] Image referenced in Markdown not found in zip: ${relativePath}`,
        );
        continue;
      }
      const data = await zipFile.async("uint8array");
      assets.push({ relativePath, data });
    }
    return assets;
  }

  private static async waitForPoll(
    delayMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(createAbortError(signal));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, delayMs);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }

  private static extractImagePathsFromMarkdown(markdown: string): Set<string> {
    const paths = new Set<string>();
    const imagePattern = /!\[[^\]]*\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = imagePattern.exec(markdown)) !== null) {
      const raw = match[1].trim().replace(/^<|>$/g, "");
      if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("#")) {
        continue;
      }
      const withoutQuery = raw.split(/[?#]/)[0];
      try {
        paths.add(decodeURIComponent(withoutQuery));
      } catch (_error) {
        paths.add(withoutQuery);
      }
    }
    return paths;
  }

  private static findZipFileByRelativePath(
    zip: JSZip,
    relativePath: string,
  ): JSZip.JSZipObject | null {
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    const files = Object.values(zip.files).filter(
      (file) => !file.dir && !file.name.includes("__MACOSX"),
    );
    return (
      files.find((file) => file.name.replace(/\\/g, "/") === normalized) ||
      files.find((file) =>
        file.name.replace(/\\/g, "/").endsWith(`/${normalized}`),
      ) ||
      null
    );
  }
}
