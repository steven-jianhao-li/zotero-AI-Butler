import { getString } from "../utils/locale";
import type { NoteExportConflictStrategy } from "./noteExportConfig";

export interface ExportWriteResult {
  written: boolean;
  skipped: boolean;
  path: string;
}

export interface CollectionPathInfo {
  id: number;
  name: string;
  pathSegments: string[];
  depth: number;
}

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function sanitizePathSegment(
  value: string,
  fallback: string,
  maxLength: number = 80,
): string {
  const normalized = (value || fallback)
    .replace(/[<>:"/\\|?*]/g, "_")
    .split("")
    .map((char) => (char.charCodeAt(0) < 32 ? "_" : char))
    .join("")
    .replace(/[\s.]+$/g, "")
    .trim();
  const safe = normalized || fallback;
  const withReservedPrefix = WINDOWS_RESERVED_NAMES.test(safe)
    ? `_${safe}`
    : safe;
  return withReservedPrefix.slice(0, maxLength);
}

export function getItemFolderName(item: Zotero.Item): string {
  const title =
    ((item as any).getDisplayTitle?.() as string | undefined) ||
    (item.getField("title") as string | undefined) ||
    "";
  return sanitizePathSegment(title, `item-${item.id}`, 80);
}

export async function ensureDirectory(path: string): Promise<void> {
  await IOUtils.makeDirectory(path, {
    ignoreExisting: true,
    createAncestors: true,
  } as any);
}

export async function writeTextFile(
  path: string,
  text: string,
  strategy: NoteExportConflictStrategy,
): Promise<ExportWriteResult> {
  if (strategy === "skip" && (await IOUtils.exists(path))) {
    return { path, written: false, skipped: true };
  }
  await IOUtils.write(path, new TextEncoder().encode(text));
  return { path, written: true, skipped: false };
}

export async function writeBinaryFile(
  path: string,
  bytes: Uint8Array,
  strategy: NoteExportConflictStrategy,
): Promise<ExportWriteResult> {
  if (strategy === "skip" && (await IOUtils.exists(path))) {
    return { path, written: false, skipped: true };
  }
  await IOUtils.write(path, bytes);
  return { path, written: true, skipped: false };
}

export async function copyFile(
  sourcePath: string,
  targetPath: string,
  strategy: NoteExportConflictStrategy,
): Promise<ExportWriteResult> {
  if (strategy === "skip" && (await IOUtils.exists(targetPath))) {
    return { path: targetPath, written: false, skipped: true };
  }

  try {
    await IOUtils.copy(sourcePath, targetPath, { noOverwrite: false });
  } catch {
    const bytes = await IOUtils.read(sourcePath);
    await IOUtils.write(targetPath, bytes);
  }
  return { path: targetPath, written: true, skipped: false };
}

export function getCollectionPathInfo(
  collection: Zotero.Collection,
): CollectionPathInfo {
  const pathSegments: string[] = [];
  let current: Zotero.Collection | false | undefined = collection;

  while (current) {
    pathSegments.unshift(
      sanitizePathSegment(
        (current as any).name || getString("note-export-untitled-collection"),
        `collection-${current.id}`,
      ),
    );
    const parentId: number | undefined = (current as any).parentID;
    current = parentId ? (Zotero.Collections.get(parentId) as any) : false;
  }

  return {
    id: collection.id,
    name: (collection as any).name || `collection-${collection.id}`,
    pathSegments,
    depth: pathSegments.length,
  };
}

export function getCollectionPathById(
  collectionId: number,
): CollectionPathInfo | null {
  const collection = Zotero.Collections.get(collectionId) as Zotero.Collection;
  return collection ? getCollectionPathInfo(collection) : null;
}

export function joinExportPath(...segments: string[]): string {
  return PathUtils.join(...segments.filter((segment) => !!segment));
}

export function getFilenameFromPath(path: string, fallback: string): string {
  const normalized = path.replace(/\\/g, "/");
  const filename = normalized.split("/").pop() || fallback;
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex <= 0) return sanitizePathSegment(filename, fallback, 90);
  const name = sanitizePathSegment(filename.slice(0, dotIndex), fallback, 80);
  const ext = filename
    .slice(dotIndex)
    .replace(/[<>:"/\\|?*]/g, "_")
    .split("")
    .map((char) => (char.charCodeAt(0) < 32 ? "_" : char))
    .join("");
  return `${name}${ext}`;
}

export async function getUniqueChildPath(
  directory: string,
  filename: string,
): Promise<string> {
  let candidate = joinExportPath(directory, filename);
  if (!(await IOUtils.exists(candidate))) return candidate;

  const dotIndex = filename.lastIndexOf(".");
  const base = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  const ext = dotIndex > 0 ? filename.slice(dotIndex) : "";
  for (let index = 2; index < 1000; index++) {
    candidate = joinExportPath(directory, `${base} (${index})${ext}`);
    if (!(await IOUtils.exists(candidate))) return candidate;
  }
  return joinExportPath(directory, `${base}-${Date.now()}${ext}`);
}

export async function getStableItemDirectory(options: {
  rootPath: string;
  collectionPath: CollectionPathInfo;
  item: Zotero.Item;
}): Promise<string> {
  const base = joinExportPath(
    options.rootPath,
    ...options.collectionPath.pathSegments,
    getItemFolderName(options.item),
  );
  if (!(await IOUtils.exists(base))) return base;

  const withId = `${base} [${options.item.id}]`;
  if (await IOUtils.exists(withId)) return withId;
  return base;
}
