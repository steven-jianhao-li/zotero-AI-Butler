import { getPref, setPref } from "../utils/prefs";

export type NoteExportConflictStrategy = "skip" | "overwrite";

export interface NoteExportFormats {
  summaryDocx: boolean;
  deepReadDocx: boolean;
  summaryMd: boolean;
  deepReadMd: boolean;
}

export interface NoteExportConfig {
  enabled: boolean;
  rootPath: string;
  watchedCollectionIds: number[];
  includeSubcollections: boolean;
  formats: NoteExportFormats;
  conflictStrategy: NoteExportConflictStrategy;
  suppressDirectoryPrompt: boolean;
}

export const DEFAULT_NOTE_EXPORT_FORMATS: NoteExportFormats = {
  summaryDocx: true,
  deepReadDocx: true,
  summaryMd: true,
  deepReadMd: true,
};

export const DEFAULT_NOTE_EXPORT_FORMATS_PREF = JSON.stringify(
  DEFAULT_NOTE_EXPORT_FORMATS,
);

export function getNoteExportConfig(): NoteExportConfig {
  return {
    enabled: !!getPref("noteExportEnabled" as any),
    rootPath: ((getPref("noteExportRootPath" as any) as string) || "").trim(),
    watchedCollectionIds: parseCollectionIds(
      getPref("noteExportWatchedCollections" as any) as string,
    ),
    includeSubcollections:
      (getPref("noteExportIncludeSubcollections" as any) as boolean) !== false,
    formats: parseFormats(getPref("noteExportFormats" as any) as string),
    conflictStrategy: parseConflictStrategy(
      getPref("noteExportConflictStrategy" as any) as string,
    ),
    suppressDirectoryPrompt: !!getPref(
      "noteExportSuppressDirectoryPrompt" as any,
    ),
  };
}

export function setNoteExportConfig(config: Partial<NoteExportConfig>): void {
  if (typeof config.enabled === "boolean") {
    setPref("noteExportEnabled" as any, config.enabled as any);
  }
  if (typeof config.rootPath === "string") {
    setPref("noteExportRootPath" as any, config.rootPath.trim() as any);
  }
  if (Array.isArray(config.watchedCollectionIds)) {
    setPref(
      "noteExportWatchedCollections" as any,
      JSON.stringify(
        normalizeCollectionIds(config.watchedCollectionIds),
      ) as any,
    );
  }
  if (typeof config.includeSubcollections === "boolean") {
    setPref(
      "noteExportIncludeSubcollections" as any,
      config.includeSubcollections as any,
    );
  }
  if (config.formats) {
    setPref(
      "noteExportFormats" as any,
      JSON.stringify(normalizeFormats(config.formats)) as any,
    );
  }
  if (config.conflictStrategy) {
    setPref(
      "noteExportConflictStrategy" as any,
      parseConflictStrategy(config.conflictStrategy) as any,
    );
  }
  if (typeof config.suppressDirectoryPrompt === "boolean") {
    setPref(
      "noteExportSuppressDirectoryPrompt" as any,
      config.suppressDirectoryPrompt as any,
    );
  }
}

export function addWatchedCollection(collectionId: number): number[] {
  const config = getNoteExportConfig();
  const next = normalizeCollectionIds([
    ...config.watchedCollectionIds,
    collectionId,
  ]);
  setPref("noteExportWatchedCollections" as any, JSON.stringify(next) as any);
  return next;
}

export function removeWatchedCollection(collectionId: number): number[] {
  const next = getNoteExportConfig().watchedCollectionIds.filter(
    (id) => id !== collectionId,
  );
  setPref("noteExportWatchedCollections" as any, JSON.stringify(next) as any);
  return next;
}

export function normalizeFormats(
  source: Partial<NoteExportFormats>,
): NoteExportFormats {
  return {
    summaryDocx:
      typeof source.summaryDocx === "boolean"
        ? source.summaryDocx
        : DEFAULT_NOTE_EXPORT_FORMATS.summaryDocx,
    deepReadDocx:
      typeof source.deepReadDocx === "boolean"
        ? source.deepReadDocx
        : DEFAULT_NOTE_EXPORT_FORMATS.deepReadDocx,
    summaryMd:
      typeof source.summaryMd === "boolean"
        ? source.summaryMd
        : DEFAULT_NOTE_EXPORT_FORMATS.summaryMd,
    deepReadMd:
      typeof source.deepReadMd === "boolean"
        ? source.deepReadMd
        : DEFAULT_NOTE_EXPORT_FORMATS.deepReadMd,
  };
}

function parseFormats(raw: string | undefined): NoteExportFormats {
  if (!raw) return { ...DEFAULT_NOTE_EXPORT_FORMATS };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_NOTE_EXPORT_FORMATS };
    }
    return normalizeFormats(parsed as Partial<NoteExportFormats>);
  } catch (error) {
    ztoolkit.log("[AI-Butler][NoteExport] 解析导出格式配置失败:", error);
    return { ...DEFAULT_NOTE_EXPORT_FORMATS };
  }
}

function parseCollectionIds(raw: string | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeCollectionIds(parsed) : [];
  } catch (error) {
    ztoolkit.log("[AI-Butler][NoteExport] 解析监听分类配置失败:", error);
    return [];
  }
}

function normalizeCollectionIds(source: unknown[]): number[] {
  const result: number[] = [];
  for (const value of source) {
    const id = Number(value);
    if (Number.isInteger(id) && id > 0 && !result.includes(id)) {
      result.push(id);
    }
  }
  return result;
}

function parseConflictStrategy(value: string): NoteExportConflictStrategy {
  return value === "overwrite" ? "overwrite" : "skip";
}
