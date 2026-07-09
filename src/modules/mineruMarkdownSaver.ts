import { getPref } from "../utils/prefs";
import { sanitizePathSegment } from "./noteExportPaths";

const ATTACHMENT_TITLE_PREFIX = "[AI-Butler] MinerU Markdown";
const ATTACHMENT_TAG = "AI-MinerU-Markdown";

type MineruMarkdownFileNameMode = "title" | "citationKey" | "citationKey-title";

export interface MineruMarkdownAsset {
  relativePath: string;
  data: Uint8Array;
}

export interface MineruMarkdownSaveResult {
  attachmentId?: number;
  externalPath?: string;
  assetCount?: number;
}

export class MineruMarkdownSaver {
  public static isSaveEnabled(): boolean {
    return Boolean(getPref("mineruSaveMarkdown" as any));
  }

  public static async readCachedMarkdown(
    item: Zotero.Item,
  ): Promise<string | null> {
    const attachment = await this.findMarkdownAttachment(item);
    if (attachment) {
      try {
        const filePath = await attachment.getFilePathAsync();
        if (filePath && (await IOUtils.exists(filePath))) {
          const content = await Zotero.File.getContentsAsync(filePath, "utf-8");
          if (typeof content === "string" && content.trim()) return content;
        }
      } catch (error) {
        ztoolkit.log(
          "[AI-Butler][MinerU] 读取已保存 Markdown 附件失败:",
          error,
        );
      }
    }

    if (getPref("mineruSyncExternal" as any)) {
      const content = await this.readExternalMarkdown(item);
      if (content) return content;
    }

    return null;
  }

  public static async save(
    item: Zotero.Item,
    markdown: string,
    assets: MineruMarkdownAsset[] = [],
  ): Promise<MineruMarkdownSaveResult> {
    const result: MineruMarkdownSaveResult = {};
    if (!markdown.trim()) return result;

    if (getPref("mineruSaveAsAttachment" as any)) {
      const attachment = await this.saveAsZoteroAttachment(
        item,
        markdown,
        assets,
      );
      if (attachment) result.attachmentId = attachment.id;
    }

    if (getPref("mineruSyncExternal" as any)) {
      const externalPath = await this.saveToExternalFolder(
        item,
        markdown,
        assets,
      );
      if (externalPath) result.externalPath = externalPath;
    }

    result.assetCount = assets.length;
    return result;
  }

  private static async readExternalMarkdown(
    item: Zotero.Item,
  ): Promise<string | null> {
    const rootPath = String(getPref("mineruExternalPath" as any) || "").trim();
    if (!rootPath) return null;

    try {
      for (const filePath of this.getExternalMarkdownCandidatePaths(
        rootPath,
        item,
      )) {
        if (!(await IOUtils.exists(filePath))) continue;
        const content = await Zotero.File.getContentsAsync(filePath, "utf-8");
        if (typeof content === "string" && content.trim()) return content;
      }
    } catch (error) {
      ztoolkit.log("[AI-Butler][MinerU] 读取外部 Markdown 缓存失败:", error);
    }
    return null;
  }

  private static getExternalMarkdownCandidatePaths(
    rootPath: string,
    item: Zotero.Item,
  ): string[] {
    const filename = this.buildMarkdownFilename(item);
    return [
      PathUtils.join(
        rootPath,
        this.buildExternalItemFolderName(item),
        filename,
      ),
      // 兼容早期版本：旧逻辑曾直接写到外部根目录下。
      PathUtils.join(rootPath, filename),
    ];
  }

  private static buildExternalItemFolderName(item: Zotero.Item): string {
    const citationKey = this.getCitationKey(item);
    const title = this.getItemTitle(item);
    const base = citationKey ? `${citationKey}-${title}` : title;
    return sanitizePathSegment(base, `item-${item.id}`, 120);
  }
  private static async saveAsZoteroAttachment(
    item: Zotero.Item,
    markdown: string,
    assets: MineruMarkdownAsset[],
  ): Promise<Zotero.Item | null> {
    const filename = this.buildMarkdownFilename(item);
    const title = `${ATTACHMENT_TITLE_PREFIX}: ${filename}`;
    const existing = await this.findMarkdownAttachment(item);

    try {
      if (existing) {
        const existingPath = await existing.getFilePathAsync();
        if (existingPath) {
          await IOUtils.write(existingPath, new TextEncoder().encode(markdown));
          await this.writeAssetsNextToMarkdown(existingPath, assets);
          existing.setField("title", title);
          existing.addTag(ATTACHMENT_TAG);
          await existing.saveTx();
          return existing;
        }
      }

      const tempPath = await this.writeTempMarkdownFile(filename, markdown);
      const attachment = await Zotero.Attachments.importFromFile({
        file: tempPath,
        parentItemID: item.id,
        title,
        contentType: "text/markdown",
        charset: "utf-8",
      });
      attachment.addTag(ATTACHMENT_TAG);
      await attachment.saveTx();
      const attachmentPath = await attachment.getFilePathAsync();
      if (attachmentPath) {
        await this.writeAssetsNextToMarkdown(attachmentPath, assets);
      }
      await Zotero.File.removeIfExists(tempPath);
      return attachment;
    } catch (error) {
      ztoolkit.log(
        "[AI-Butler][MinerU] 保存 Markdown 为 Zotero 子附件失败:",
        error,
      );
      return null;
    }
  }

  private static async saveToExternalFolder(
    item: Zotero.Item,
    markdown: string,
    assets: MineruMarkdownAsset[],
  ): Promise<string | null> {
    const rootPath = String(getPref("mineruExternalPath" as any) || "").trim();
    if (!rootPath) return null;

    try {
      await IOUtils.makeDirectory(rootPath, {
        ignoreExisting: true,
        createAncestors: true,
      } as any);
      const itemDir = PathUtils.join(
        rootPath,
        this.buildExternalItemFolderName(item),
      );
      await IOUtils.makeDirectory(itemDir, {
        ignoreExisting: true,
        createAncestors: true,
      } as any);
      const targetPath = PathUtils.join(
        itemDir,
        this.buildMarkdownFilename(item),
      );
      await IOUtils.write(targetPath, new TextEncoder().encode(markdown));
      await this.writeAssetsNextToMarkdown(targetPath, assets);
      return targetPath;
    } catch (error) {
      ztoolkit.log("[AI-Butler][MinerU] 同步 Markdown 到外部目录失败:", error);
      return null;
    }
  }

  private static async writeAssetsNextToMarkdown(
    markdownPath: string,
    assets: MineruMarkdownAsset[],
  ): Promise<void> {
    if (assets.length === 0) return;

    const baseDir = PathUtils.parent(markdownPath);
    if (!baseDir) return;

    for (const asset of assets) {
      const safeRelativePath = this.sanitizeRelativeAssetPath(
        asset.relativePath,
      );
      if (!safeRelativePath) continue;

      const segments = safeRelativePath.split("/").filter(Boolean);
      const targetPath = PathUtils.join(baseDir, ...segments);
      const targetDir = PathUtils.parent(targetPath);
      if (!targetDir) continue;
      await IOUtils.makeDirectory(targetDir, {
        ignoreExisting: true,
        createAncestors: true,
      } as any);
      await IOUtils.write(targetPath, asset.data);
    }
  }

  private static sanitizeRelativeAssetPath(path: string): string | null {
    const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length === 0 || parts.some((part) => part === "..")) return null;
    return parts
      .map((part, index) =>
        index === parts.length - 1
          ? sanitizePathSegment(part, "asset", 160)
          : sanitizePathSegment(part, "assets", 80),
      )
      .join("/");
  }

  private static async findMarkdownAttachment(
    item: Zotero.Item,
  ): Promise<Zotero.Item | null> {
    for (const attachmentID of item.getAttachments()) {
      const attachment = await Zotero.Items.getAsync(attachmentID);
      const title = String(attachment.getField("title") || "");
      const contentType = String(attachment.attachmentContentType || "");
      const tags = (attachment.getTags?.() || []).map((tag: any) => tag.tag);

      if (
        title.startsWith(ATTACHMENT_TITLE_PREFIX) ||
        tags.includes(ATTACHMENT_TAG) ||
        (contentType === "text/markdown" && title.includes("MinerU"))
      ) {
        return attachment;
      }
    }
    return null;
  }

  private static async writeTempMarkdownFile(
    filename: string,
    markdown: string,
  ): Promise<string> {
    const tempDir = Services.dirsvc.get("TmpD", Ci.nsIFile).path;
    const dir = PathUtils.join(tempDir, "zotero-ai-butler-mineru");
    await IOUtils.makeDirectory(dir, {
      ignoreExisting: true,
      createAncestors: true,
    } as any);
    const tempPath = PathUtils.join(dir, `${Date.now()}-${filename}`);
    await IOUtils.write(tempPath, new TextEncoder().encode(markdown));
    return tempPath;
  }

  private static buildMarkdownFilename(item: Zotero.Item): string {
    const mode = this.getFilenameMode();
    const title = this.getItemTitle(item);
    const citationKey = this.getCitationKey(item);

    let base = title;
    if (mode === "citationKey" && citationKey) {
      base = citationKey;
    } else if (mode === "citationKey-title" && citationKey) {
      base = `${citationKey}-${title}`;
    }

    return `${sanitizePathSegment(base, `item-${item.id}`, 120)}.md`;
  }

  private static getFilenameMode(): MineruMarkdownFileNameMode {
    const raw = String(
      getPref("mineruFileNameMode" as any) || "citationKey-title",
    );
    if (raw === "title" || raw === "citationKey") return raw;
    return "citationKey-title";
  }

  private static getItemTitle(item: Zotero.Item): string {
    return (
      ((item as any).getDisplayTitle?.() as string | undefined) ||
      (item.getField("title") as string | undefined) ||
      `item-${item.id}`
    ).trim();
  }

  private static getCitationKey(item: Zotero.Item): string {
    const fieldValue = String(
      (item.getField("citationKey" as any) as string) || "",
    ).trim();
    if (fieldValue) return fieldValue;

    const directValue = String(
      ((item as any).citationKey as string) || "",
    ).trim();
    if (directValue) return directValue;

    const extra = String((item.getField("extra" as any) as string) || "");
    const match = extra.match(/^Citation Key:\s*(.+)$/im);
    return match ? match[1].trim() : "";
  }
}
