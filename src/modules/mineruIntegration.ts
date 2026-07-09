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
      throw new Error("MinerU API Key not configured.");
    }

    if (MineruMarkdownSaver.isSaveEnabled()) {
      const cachedMarkdown = await MineruMarkdownSaver.readCachedMarkdown(item);
      if (cachedMarkdown) {
        ztoolkit.log(
          "[MineruIntegration] Reusing saved MinerU Markdown attachment.",
        );
        progressCallback?.("复用已保存的 MinerU Markdown", 38, {
          stage: "mineru-parsing",
          label: "复用 MinerU 缓存",
          detail: "已找到此前保存的 MinerU Markdown 附件，跳过重新解析",
        });
        return cachedMarkdown;
      }
    }

    // Get PDF file path
    const pdfAttachments = await PDFExtractor.getAllPdfAttachments(item);
    if (!pdfAttachments || pdfAttachments.length === 0) {
      throw new Error("No PDF attachment found.");
    }
    const pdfAttachment = pdfAttachments[0];
    const filePath = await pdfAttachment.getFilePathAsync();
    if (!filePath) {
      throw new Error("PDF file path not found.");
    }

    ztoolkit.log(`[MineruIntegration] Starting MinerU parsing of ${filePath}`);
    progressCallback?.("正在读取 PDF 并准备提交 MinerU...", 12, {
      stage: "mineru-uploading",
      label: "MinerU 准备中",
      detail: `PDF 路径：${filePath}`,
    });

    // Read PDF binary
    const fileData = await IOUtils.read(filePath);
    const modelVersion = getMineruModelVersion();

    // Get Batch & Upload URLs
    // Assuming simple payload for /api/v4/file-urls/batch based on standard implementations
    const fileName = "document.pdf";
    progressCallback?.("正在获取 MinerU 上传地址...", 14, {
      stage: "mineru-uploading",
      label: "MinerU 获取上传地址",
      detail: `模型版本：${modelVersion}`,
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
      throw new Error(`Failed to get upload URL: ${err}`);
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
    progressCallback?.("MinerU 上传中...", 16, {
      stage: "mineru-uploading",
      label: "MinerU 上传中",
      detail: `正在上传 PDF，大小约 ${(fileData.byteLength / 1024 / 1024).toFixed(2)} MB`,
    });
    const putRes = await fetch(putUrl, {
      method: "PUT",
      body: fileData,
    });

    if (!putRes.ok) {
      const errText = await putRes.text();
      throw new Error(
        `Failed to put upload file, status: ${putRes.status}, error: ${errText}`,
      );
    }

    // Poll for task completion
    const timeoutMs = getMineruTimeoutMs();
    ztoolkit.log(
      `[MineruIntegration] Polling for task completion... Batch ID: ${batchId}, timeout: ${timeoutMs}ms`,
    );
    const result = await this.pollStatusAndDownload(apiKey, batchId, timeoutMs);
    if (MineruMarkdownSaver.isSaveEnabled()) {
      progressCallback?.("正在保存 MinerU Markdown 缓存...", 39, {
        stage: "mineru-parsing",
        label: "保存 MinerU 缓存",
        detail: "正在把 MinerU Markdown 和图片资源保存为 Zotero 附件",
      });
      await MineruMarkdownSaver.save(item, result.markdown, result.assets);
    }
    progressCallback?.("MinerU 解析完成", 40, {
      stage: "mineru-parsing",
      label: "MinerU 完成",
      detail: `已提取约 ${result.markdown.length} 个 Markdown 字符`,
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
          `Failed to poll MinerU task, status: ${res.status}, error: ${errText}`,
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
      progressCallback?.("MinerU 解析中...", estimatedProgress, {
        stage: "mineru-processing",
        label: "MinerU 解析中",
        detail: `第 ${attempt} 次轮询；状态：${state || "pending"}；已等待 ${Math.floor(elapsedMs / 1000)} 秒；Batch ID：${batchId}`,
        attempt,
      });

      if (state === "done") {
        const zipUrl = result?.full_zip_url;
        if (!zipUrl) {
          throw new Error(
            "MinerU Task completed but no full_zip_url returned.",
          );
        }
        progressCallback?.("MinerU 解析完成，正在下载结果...", 36, {
          stage: "mineru-downloading",
          label: "MinerU 下载结果",
          detail: "MinerU 已完成解析，正在下载结果压缩包",
        });
        return await this.downloadAndExtractMarkdown(zipUrl, progressCallback);
      } else if (state === "error") {
        throw new Error(`MinerU Task failed processing.`);
      }

      // continue polling...
    }
    throw new Error(`MinerU Task timed out after ${timeoutMs} ms.`);
  }

  private static async downloadAndExtractMarkdown(
    zipUrl: string,
    progressCallback?: PdfExtractionProgressCallback,
  ): Promise<MineruExtractedResult> {
    ztoolkit.log(`[MineruIntegration] Downloading zip result from ${zipUrl}`);
    const res = await fetch(zipUrl);
    if (!res.ok) {
      throw new Error(`Failed to download zip file from ${zipUrl}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    progressCallback?.("正在解压 MinerU Markdown...", 37, {
      stage: "mineru-parsing",
      label: "MinerU 解压结果",
      detail: `结果压缩包大小约 ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`,
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
      throw new Error("No valid Markdown file found in the extracted zip.");
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
