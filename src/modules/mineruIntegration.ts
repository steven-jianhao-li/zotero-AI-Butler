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
import { PDFExtractor } from "./pdfExtractor";
import {
  MineruMarkdownSaver,
  type MineruMarkdownAsset,
} from "./mineruMarkdownSaver";
import JSZip from "jszip";
import type { PdfExtractionProgressCallback } from "./pdfExtractor";

type MineruModelVersion = "pipeline" | "vlm";
const MINERU_POLL_INTERVAL_MS = 5000;
const DEFAULT_MINERU_TIMEOUT_MS = 300000;

interface MineruExtractedResult {
  markdown: string;
  assets: MineruMarkdownAsset[];
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
  ): Promise<string> {
    const apiKey = (getPref("mineruApiKey") as string) || "";
    if (!apiKey) {
      throw new Error(getString("mineru-error-api-key-missing"));
    }

    if (MineruMarkdownSaver.isSaveEnabled()) {
      const cachedMarkdown = await MineruMarkdownSaver.readCachedMarkdown(item);
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
    if (!pdfAttachments || pdfAttachments.length === 0) {
      throw new Error(getString("mineru-error-no-pdf-attachment"));
    }
    const pdfAttachment = pdfAttachments[0];
    const filePath = await pdfAttachment.getFilePathAsync();
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
    const batchRes = await fetch("https://mineru.net/api/v4/file-urls/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
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

    const batchData = (await batchRes.json()) as any;
    let putUrl = "";
    const batchId = batchData?.data?.batch_id;

    // Dynamic property search, crash if not found
    if (batchData?.data?.file_urls?.[0]) putUrl = batchData.data.file_urls[0];
    else if (batchData?.data?.urls?.[0]) putUrl = batchData.data.urls[0];
    else if (batchData?.data?.urls?.[fileName])
      putUrl = batchData.data.urls[fileName];
    else if (batchData?.data?.items?.[0]?.url)
      putUrl = batchData.data.items[0].url;
    else if (batchData?.data?.upload_url) putUrl = batchData.data.upload_url;

    if (!putUrl || !batchId) {
      throw new Error(
        `MinerU API returned unexpected batch response: ${JSON.stringify(batchData)}`,
      );
    }

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
      method: "PUT",
      body: fileData,
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
    const result = await this.pollStatusAndDownload(apiKey, batchId, timeoutMs);
    if (MineruMarkdownSaver.isSaveEnabled()) {
      progressCallback?.(getString("progress-mineru-save-cache-message"), 39, {
        stage: "mineru-parsing",
        label: getString("progress-mineru-save-cache"),
        detail: getString("progress-mineru-save-cache-detail"),
      });
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

  private static async pollStatusAndDownload(
    apiKey: string,
    batchId: string,
    timeoutMs: number,
    progressCallback?: PdfExtractionProgressCallback,
  ): Promise<MineruExtractedResult> {
    const url = `https://mineru.net/api/v4/extract-results/batch/${batchId}`;
    const startedAt = Date.now();
    let attempt = 0;

    while (Date.now() - startedAt < timeoutMs) {
      if (attempt > 0) {
        const remainingMs = timeoutMs - (Date.now() - startedAt);
        await Zotero.Promise.delay(
          Math.min(MINERU_POLL_INTERVAL_MS, Math.max(remainingMs, 0)),
        );
      }
      attempt += 1;

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
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
        return await this.downloadAndExtractMarkdown(zipUrl, progressCallback);
      } else if (state === "error") {
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
  ): Promise<MineruExtractedResult> {
    ztoolkit.log(`[MineruIntegration] Downloading zip result from ${zipUrl}`);
    const res = await fetch(zipUrl);
    if (!res.ok) {
      throw new Error(
        getString("mineru-error-download-zip-failed", {
          args: { url: zipUrl },
        }),
      );
    }
    const arrayBuffer = await res.arrayBuffer();
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

    const assets = await this.extractMarkdownAssets(zip, mdContent);
    return { markdown: mdContent, assets };
  }

  private static async extractMarkdownAssets(
    zip: JSZip,
    markdown: string,
  ): Promise<MineruMarkdownAsset[]> {
    const referencedPaths = this.extractImagePathsFromMarkdown(markdown);
    if (referencedPaths.size === 0) return [];

    const assets: MineruMarkdownAsset[] = [];
    for (const relativePath of referencedPaths) {
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
