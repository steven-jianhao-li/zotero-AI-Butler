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
import JSZip from "jszip";

type MineruModelVersion = "pipeline" | "vlm";
const MINERU_POLL_INTERVAL_MS = 5000;
const DEFAULT_MINERU_TIMEOUT_MS = 300000;

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
  public static async extractMarkdown(item: Zotero.Item): Promise<string> {
    const apiKey = (getPref("mineruApiKey") as string) || "";
    if (!apiKey) {
      throw new Error("MinerU API Key not configured.");
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

    // Read PDF binary
    const fileData = await IOUtils.read(filePath);
    const modelVersion = getMineruModelVersion();

    // Get Batch & Upload URLs
    // Assuming simple payload for /api/v4/file-urls/batch based on standard implementations
    const fileName = "document.pdf";
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
    return await this.pollStatusAndDownload(apiKey, batchId, timeoutMs);
  }

  private static async pollStatusAndDownload(
    apiKey: string,
    batchId: string,
    timeoutMs: number,
  ): Promise<string> {
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

      if (state === "done") {
        const zipUrl = result?.full_zip_url;
        if (!zipUrl) {
          throw new Error(
            "MinerU Task completed but no full_zip_url returned.",
          );
        }
        return await this.downloadAndExtractMarkdown(zipUrl);
      } else if (state === "error") {
        throw new Error(`MinerU Task failed processing.`);
      }

      // continue polling...
    }
    throw new Error(`MinerU Task timed out after ${timeoutMs} ms.`);
  }

  private static async downloadAndExtractMarkdown(
    zipUrl: string,
  ): Promise<string> {
    ztoolkit.log(`[MineruIntegration] Downloading zip result from ${zipUrl}`);
    const res = await fetch(zipUrl);
    if (!res.ok) {
      throw new Error(`Failed to download zip file from ${zipUrl}`);
    }
    const arrayBuffer = await res.arrayBuffer();

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

    return mdContent;
  }
}
