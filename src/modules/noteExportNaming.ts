import type { AiNoteKind } from "./aiNoteService";
import { LLMNoteMetadataService } from "./llmNoteMetadata";
import {
  sanitizePathSegment,
  type CollectionPathInfo,
} from "./noteExportPaths";

export const DEFAULT_NOTE_EXPORT_FILENAME_TEMPLATE =
  "{collectionPath} - {title} - {noteType}";

export const NOTE_EXPORT_FILENAME_FIELDS = [
  "collectionPath",
  "collection",
  "title",
  "firstAuthor",
  "year",
  "itemKey",
  "model",
  "noteType",
] as const;

export type NoteExportFilenameField =
  (typeof NOTE_EXPORT_FILENAME_FIELDS)[number];
export type NoteExportFilenameValues = Record<NoteExportFilenameField, string>;

/** Only named fields are accepted; templates never execute JavaScript. */
export function isValidNoteExportFilenameTemplate(template: string): boolean {
  const remaining = template.replace(/\{([a-zA-Z]+)\}/g, (token, field) =>
    NOTE_EXPORT_FILENAME_FIELDS.includes(field) ? "" : token,
  );
  return !/[{}]/.test(remaining);
}

export function normalizeNoteExportFilenameTemplate(template?: string): string {
  const value = template?.trim() || "";
  return value && isValidNoteExportFilenameTemplate(value)
    ? value
    : DEFAULT_NOTE_EXPORT_FILENAME_TEMPLATE;
}

/** Use the export's collection and the saved note's models, not current UI/API settings. */
export function getNoteExportFilenameValues(options: {
  item: Zotero.Item;
  collectionPath: CollectionPathInfo;
  kind: AiNoteKind;
  html: string;
}): NoteExportFilenameValues {
  const { item, collectionPath, kind, html } = options;
  const creators = item.getCreatorsJSON();
  const author =
    creators.find((creator) => creator.creatorType === "author") || creators[0];
  const models = LLMNoteMetadataService.parseAll(html)
    .map((block) => block.metadata.modelId?.trim())
    .filter((model): model is string => !!model && model !== "unknown");
  return {
    collectionPath: collectionPath.pathSegments.join(" - "),
    collection: collectionPath.name,
    title: item.getDisplayTitle() || String(item.getField("title") || ""),
    firstAuthor: author
      ? author.name || author.lastName || author.firstName || ""
      : "",
    year: String(item.getField("date") || "").match(/\b\d{4}\b/)?.[0] || "",
    itemKey: item.key || String(item.id),
    model: [...new Set(models)].join(" + "),
    noteType: kind === "deepRead" ? "deep-read" : "summary",
  };
}

/** Render a single filename, preserving the note kind even when names are shortened. */
export function formatNoteExportFilename(
  template: string,
  values: NoteExportFilenameValues,
  extension: "md" | "docx",
): string {
  const normalized = normalizeNoteExportFilenameTemplate(template);
  const fallback = `item-${values.itemKey || "untitled"}`;
  let rendered = normalized
    .replace(/\{([a-zA-Z]+)\}/g, (_, field: NoteExportFilenameField) =>
      field === "title" ? values.title || fallback : values[field],
    )
    .replace(/\.(md|docx)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized.includes("{noteType}")) {
    rendered = `${rendered || fallback} - ${values.noteType}`;
  }
  const safe = sanitizePathSegment(rendered, fallback, Number.MAX_SAFE_INTEGER);
  // Leave room for the extension within common 255-byte filesystem limits.
  const maxBytes = 235;
  const encoder = new TextEncoder();
  if (encoder.encode(safe).length <= maxBytes) return `${safe}.${extension}`;

  // A stable digest distinguishes long names sharing the same truncated prefix.
  let hash = 2166136261;
  for (const char of safe) {
    hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  }
  const suffix = ` - ${values.noteType}-${(hash >>> 0).toString(16)}`;
  const budget = maxBytes - encoder.encode(suffix).length;
  let prefix = "";
  let bytes = 0;
  for (const char of safe) {
    bytes += encoder.encode(char).length;
    if (bytes > budget) break;
    prefix += char;
  }
  return `${prefix.trimEnd()}${suffix}.${extension}`;
}
