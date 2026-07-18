import { AiNoteService, type AiNoteKind } from "./aiNoteService";
import {
  getNoteExportConfig,
  type NoteExportConfig,
  type NoteExportConflictStrategy,
} from "./noteExportConfig";
import { noteHtmlToDocxBytes } from "./noteExportDocxConverter";
import { noteHtmlToMarkdown } from "./noteExportMarkdown";
import { hasIncompleteDeepReadContent } from "./deepReadEngine";
import {
  copyFile,
  ensureDirectory,
  getCollectionPathById,
  getCollectionPathInfo,
  getFilenameFromPath,
  getStableItemDirectory,
  getUniqueChildPath,
  joinExportPath,
  type CollectionPathInfo,
  writeBinaryFile,
  writeTextFile,
} from "./noteExportPaths";
import { getString } from "../utils/locale";

export interface NoteExportItemResult {
  itemId: number;
  title: string;
  directory: string;
  exportedFiles: number;
  skippedFiles: number;
  warnings: string[];
  success: boolean;
}

export interface NoteExportBatchResult {
  totalItems: number;
  exportedItems: number;
  skippedItems: number;
  failedItems: number;
  exportedFiles: number;
  skippedFiles: number;
  warnings: string[];
  itemResults: NoteExportItemResult[];
}

export interface NoteExportCollectionOptions {
  collection: Zotero.Collection;
  config?: NoteExportConfig;
  rootPath?: string;
  conflictStrategy?: NoteExportConflictStrategy;
  includeSubcollections?: boolean;
  onProgress?: (message: string, progress: number) => void;
}

type NoteArtifacts = Partial<
  Record<AiNoteKind, { html: string; note: Zotero.Item }>
>;

const NOTE_OUTPUT_META: Record<
  AiNoteKind,
  { labelKey: string; docxName: string; markdownName: string }
> = {
  summary: {
    labelKey: "note-export-kind-summary",
    docxName: "summary.docx",
    markdownName: "summary.md",
  },
  deepRead: {
    labelKey: "note-export-kind-deep-read",
    docxName: "deep-read.docx",
    markdownName: "deep-read.md",
  },
};

export class NoteExportService {
  public static async exportCollection(
    options: NoteExportCollectionOptions,
  ): Promise<NoteExportBatchResult> {
    const config = options.config || getNoteExportConfig();
    const rootPath = (options.rootPath || config.rootPath).trim();
    if (!rootPath)
      throw new Error(getString("note-export-error-select-directory"));

    const includeSubcollections =
      options.includeSubcollections ?? config.includeSubcollections;
    const conflictStrategy =
      options.conflictStrategy || config.conflictStrategy;
    const entries = await this.collectCollectionItems(
      options.collection,
      includeSubcollections,
    );
    const result = createEmptyBatchResult(entries.length);
    await ensureDirectory(rootPath);

    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      const progress = entries.length
        ? Math.round(((index + 1) / entries.length) * 100)
        : 100;
      options.onProgress?.(
        getString("note-export-progress-exporting", {
          args: { title: getItemTitle(entry.item) },
        }),
        progress,
      );
      try {
        const itemResult = await this.exportItem({
          item: entry.item,
          collectionPath: entry.collectionPath,
          config: { ...config, rootPath, conflictStrategy },
          requireBothNotes: false,
        });
        mergeItemResult(result, itemResult);
      } catch (error: any) {
        ztoolkit.log("[AI-Butler][NoteExport] 单篇论文导出失败:", {
          itemId: entry.item.id,
          title: getItemTitle(entry.item),
          error,
        });
        result.failedItems++;
        result.warnings.push(
          getString("note-export-warning-item-failed", {
            args: {
              title: getItemTitle(entry.item),
              message: error?.message || error,
            },
          }),
        );
      }
    }

    return result;
  }

  public static async exportItem(options: {
    item: Zotero.Item;
    collectionPath: CollectionPathInfo;
    config?: NoteExportConfig;
    requireBothNotes?: boolean;
  }): Promise<NoteExportItemResult> {
    const config = options.config || getNoteExportConfig();
    if (!config.rootPath.trim())
      throw new Error(getString("note-export-error-select-directory"));

    const item = options.item;
    const title = getItemTitle(item);
    const directory = await getStableItemDirectory({
      rootPath: config.rootPath,
      collectionPath: options.collectionPath,
      item,
    });
    const attachmentsDir = joinExportPath(directory, "attachments");
    const result: NoteExportItemResult = {
      itemId: item.id,
      title,
      directory,
      exportedFiles: 0,
      skippedFiles: 0,
      warnings: [],
      success: false,
    };

    const notes = await this.resolveNotes(item);
    if (options.requireBothNotes && (!notes.summary || !notes.deepRead)) {
      return result;
    }

    await ensureDirectory(directory);
    await ensureDirectory(attachmentsDir);

    await this.exportAttachments({
      item,
      attachmentsDir,
      strategy: config.conflictStrategy,
      result,
    });

    await this.exportNoteArtifacts({
      notes,
      directory,
      title,
      config,
      result,
    });

    result.success = result.exportedFiles > 0 || result.skippedFiles > 0;
    return result;
  }

  public static async findWatchedCollectionPathForItem(
    item: Zotero.Item,
    config: NoteExportConfig = getNoteExportConfig(),
  ): Promise<CollectionPathInfo | null> {
    if (!config.watchedCollectionIds.length) return null;
    const watchedIds = new Set<number>();
    for (const collectionId of config.watchedCollectionIds) {
      watchedIds.add(collectionId);
      if (config.includeSubcollections) {
        for (const childId of getDescendantCollectionIds(collectionId)) {
          watchedIds.add(childId);
        }
      }
    }

    const itemCollectionIds = ((item as any).getCollections?.() ||
      []) as number[];
    const candidates = itemCollectionIds
      .filter((id) => watchedIds.has(id))
      .map((id) => getCollectionPathById(id))
      .filter((info): info is CollectionPathInfo => !!info)
      .sort((a, b) => b.depth - a.depth);
    return candidates[0] || null;
  }

  public static async isReadyForAutomaticExport(
    item: Zotero.Item,
  ): Promise<boolean> {
    const notes = await this.resolveNotes(item);
    return (
      !!notes.summary &&
      !!notes.deepRead &&
      !hasIncompleteDeepReadContent(notes.deepRead.html)
    );
  }

  private static async resolveNotes(item: Zotero.Item): Promise<NoteArtifacts> {
    const summary = await AiNoteService.findNoteRecord(item, "summary");
    const deepRead = await AiNoteService.findNoteRecord(item, "deepRead");
    return {
      summary: summary
        ? {
            note: summary.note,
            html: summary.rawHtml || getNoteHtml(summary.note),
          }
        : undefined,
      deepRead: deepRead
        ? {
            note: deepRead.note,
            html: deepRead.rawHtml || getNoteHtml(deepRead.note),
          }
        : undefined,
    };
  }

  private static async exportNoteArtifacts(options: {
    notes: NoteArtifacts;
    directory: string;
    title: string;
    config: NoteExportConfig;
    result: NoteExportItemResult;
  }): Promise<void> {
    const { notes, directory, title, config, result } = options;
    await this.exportOneNote({
      kind: "summary",
      artifact: notes.summary,
      exportDocx: config.formats.summaryDocx,
      exportMarkdown: config.formats.summaryMd,
      directory,
      title,
      strategy: config.conflictStrategy,
      result,
    });
    await this.exportOneNote({
      kind: "deepRead",
      artifact: notes.deepRead,
      exportDocx: config.formats.deepReadDocx,
      exportMarkdown: config.formats.deepReadMd,
      directory,
      title,
      strategy: config.conflictStrategy,
      result,
    });
  }

  private static async exportOneNote(options: {
    kind: AiNoteKind;
    artifact: { html: string; note: Zotero.Item } | undefined;
    exportDocx: boolean;
    exportMarkdown: boolean;
    directory: string;
    title: string;
    strategy: NoteExportConflictStrategy;
    result: NoteExportItemResult;
  }): Promise<void> {
    const meta = NOTE_OUTPUT_META[options.kind];
    const kindLabel = getString(meta.labelKey);
    if (!options.exportDocx && !options.exportMarkdown) return;
    if (!options.artifact) return;

    if (options.exportDocx) {
      try {
        const bytes = await noteHtmlToDocxBytes({
          html: options.artifact.html,
          title: options.title,
          kindLabel: kindLabel,
        });
        addWriteResult(
          options.result,
          await writeBinaryFile(
            joinExportPath(options.directory, meta.docxName),
            bytes,
            options.strategy,
          ),
        );
      } catch (error: any) {
        options.result.warnings.push(
          getString("note-export-warning-docx-failed", {
            args: { kind: kindLabel, message: error?.message || error },
          }),
        );
      }
    }

    if (options.exportMarkdown) {
      try {
        const markdown = await noteHtmlToMarkdown(options.artifact.html);
        addWriteResult(
          options.result,
          await writeTextFile(
            joinExportPath(options.directory, meta.markdownName),
            markdown,
            options.strategy,
          ),
        );
      } catch (error: any) {
        options.result.warnings.push(
          getString("note-export-warning-markdown-failed", {
            args: { kind: kindLabel, message: error?.message || error },
          }),
        );
      }
    }
  }

  private static async exportAttachments(options: {
    item: Zotero.Item;
    attachmentsDir: string;
    strategy: NoteExportConflictStrategy;
    result: NoteExportItemResult;
  }): Promise<void> {
    const attachmentIds = ((options.item as any).getAttachments?.() ||
      []) as number[];
    for (const attachmentId of attachmentIds) {
      try {
        const attachment = await Zotero.Items.getAsync(attachmentId);
        if (!attachment) continue;
        const sourcePath = await (attachment as any).getFilePathAsync?.();
        if (!sourcePath || !(await IOUtils.exists(sourcePath))) {
          options.result.warnings.push(
            getString("note-export-warning-attachment-unreadable", {
              args: { title: getItemTitle(attachment as Zotero.Item) },
            }),
          );
          continue;
        }
        const filename = getFilenameFromPath(
          sourcePath,
          `attachment-${attachmentId}`,
        );
        const targetPath =
          options.strategy === "skip"
            ? await getUniqueChildPath(options.attachmentsDir, filename)
            : joinExportPath(options.attachmentsDir, filename);
        addWriteResult(
          options.result,
          await copyFile(sourcePath, targetPath, options.strategy),
        );
      } catch (error: any) {
        options.result.warnings.push(
          getString("note-export-warning-attachment-failed", {
            args: { id: attachmentId, message: error?.message || error },
          }),
        );
      }
    }
  }

  private static async collectCollectionItems(
    collection: Zotero.Collection,
    includeSubcollections: boolean,
  ): Promise<Array<{ item: Zotero.Item; collectionPath: CollectionPathInfo }>> {
    const result: Array<{
      item: Zotero.Item;
      collectionPath: CollectionPathInfo;
    }> = [];
    const seen = new Set<number>();
    const collections = includeSubcollections
      ? [collection, ...getDescendantCollections(collection.id)]
      : [collection];

    for (const current of collections) {
      const path = getCollectionPathInfo(current);
      const itemIds = ((current as any).getChildItems?.(true) ||
        []) as number[];
      for (const itemId of itemIds) {
        if (seen.has(itemId)) continue;
        const item = await Zotero.Items.getAsync(itemId);
        if (!item || !(item as any).isRegularItem?.()) continue;
        seen.add(itemId);
        result.push({ item: item as Zotero.Item, collectionPath: path });
      }
    }

    return result;
  }
}

function getDescendantCollections(collectionId: number): Zotero.Collection[] {
  const result: Zotero.Collection[] = [];
  const children = (Zotero.Collections.getByParent(collectionId) ||
    []) as Zotero.Collection[];
  for (const child of children) {
    result.push(child, ...getDescendantCollections(child.id));
  }
  return result;
}

function getDescendantCollectionIds(collectionId: number): number[] {
  return getDescendantCollections(collectionId).map(
    (collection) => collection.id,
  );
}

function getItemTitle(item: Zotero.Item): string {
  return (
    ((item as any).getDisplayTitle?.() as string | undefined) ||
    (item.getField?.("title") as string | undefined) ||
    `item-${item.id}`
  );
}

function getNoteHtml(note: Zotero.Item): string {
  return ((note as any).getNote?.() as string | undefined) || "";
}

function createEmptyBatchResult(totalItems: number): NoteExportBatchResult {
  return {
    totalItems,
    exportedItems: 0,
    skippedItems: 0,
    failedItems: 0,
    exportedFiles: 0,
    skippedFiles: 0,
    warnings: [],
    itemResults: [],
  };
}

function mergeItemResult(
  batch: NoteExportBatchResult,
  item: NoteExportItemResult,
): void {
  batch.itemResults.push(item);
  batch.exportedFiles += item.exportedFiles;
  batch.skippedFiles += item.skippedFiles;
  batch.warnings.push(
    ...item.warnings.map((warning) => `${item.title}: ${warning}`),
  );
  if (item.success) batch.exportedItems++;
  else batch.skippedItems++;
}

function addWriteResult(
  result: NoteExportItemResult,
  writeResult: { written: boolean; skipped: boolean },
): void {
  if (writeResult.written) result.exportedFiles++;
  if (writeResult.skipped) result.skippedFiles++;
}
