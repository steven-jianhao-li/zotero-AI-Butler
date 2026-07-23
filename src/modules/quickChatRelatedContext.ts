import { getString } from "../utils/locale";
import { AiNoteService } from "./aiNoteService";
import { ContentExtractor } from "./contentExtractor";
import { LLMNoteMetadataService } from "./llmNoteMetadata";

export type QuickChatRelatedMode = "summary" | "fullText";

export interface QuickChatRelatedItemRef {
  itemId: number;
  libraryID?: number;
  key?: string;
  title: string;
}

export interface QuickChatRelatedContextItem {
  ref: QuickChatRelatedItemRef;
  content: string;
  originalLength: number;
  truncated: boolean;
}

export type QuickChatRelatedSkipReason =
  | "missing-item"
  | "missing-summary"
  | "extract-failed";

export interface QuickChatRelatedContextSkip {
  ref: QuickChatRelatedItemRef;
  reason: QuickChatRelatedSkipReason;
  message?: string;
}

export interface QuickChatRelatedContextResult {
  mode: QuickChatRelatedMode;
  signature: string;
  included: QuickChatRelatedContextItem[];
  skipped: QuickChatRelatedContextSkip[];
  totalChars: number;
  truncated: boolean;
}

export interface QuickChatRelatedLimit {
  maxItems: number;
  maxCharsPerItem: number;
  maxTotalChars: number;
}

export interface QuickChatRelatedValidation {
  ok: boolean;
  reason?: "too-many-items";
  count: number;
  limit: QuickChatRelatedLimit;
}

export interface QuickChatRelatedContextDeps {
  getItemById?: (itemId: number) => Promise<Zotero.Item | null>;
  getSummaryMarkdown?: (item: Zotero.Item) => Promise<string | null>;
  getFullText?: (item: Zotero.Item) => Promise<string>;
}

export const QUICK_CHAT_RELATED_LIMITS: Record<
  QuickChatRelatedMode,
  QuickChatRelatedLimit
> = {
  summary: {
    maxItems: 20,
    maxCharsPerItem: 4000,
    maxTotalChars: 80000,
  },
  fullText: {
    maxItems: 5,
    maxCharsPerItem: 25000,
    maxTotalChars: 100000,
  },
};

export function normalizeQuickChatRelatedMode(
  value: unknown,
): QuickChatRelatedMode {
  return value === "fullText" ? "fullText" : "summary";
}

export function getQuickChatRelatedLimit(
  mode: QuickChatRelatedMode,
): QuickChatRelatedLimit {
  return QUICK_CHAT_RELATED_LIMITS[normalizeQuickChatRelatedMode(mode)];
}

export function createQuickChatRelatedItemRef(
  item: Zotero.Item,
  currentItemId?: number,
): QuickChatRelatedItemRef | null {
  if (!isQuickChatRelatedCandidateItem(item)) return null;
  if (typeof currentItemId === "number" && item.id === currentItemId) {
    return null;
  }

  const title =
    String(item.getDisplayTitle?.() || "").trim() ||
    String(item.getField?.("title") || "").trim() ||
    getString("common-paper-title");
  return {
    itemId: item.id,
    libraryID: item.libraryID,
    key: String((item as any).key || ""),
    title,
  };
}

export function isQuickChatRelatedCandidateItem(item: Zotero.Item): boolean {
  if (!item) return false;
  if (typeof item.isRegularItem === "function") {
    return item.isRegularItem();
  }
  return !item.isNote?.() && !item.isAttachment?.() && !item.parentID;
}

export function mergeQuickChatRelatedItemRefs(
  existing: QuickChatRelatedItemRef[],
  candidates: QuickChatRelatedItemRef[],
  currentItemId?: number,
): {
  items: QuickChatRelatedItemRef[];
  added: QuickChatRelatedItemRef[];
  skippedCurrent: number;
  skippedDuplicate: number;
} {
  const items: QuickChatRelatedItemRef[] = [];
  const added: QuickChatRelatedItemRef[] = [];
  const seen = new Set<number>();
  let skippedCurrent = 0;
  let skippedDuplicate = 0;

  const append = (ref: QuickChatRelatedItemRef, isNew: boolean): void => {
    if (typeof currentItemId === "number" && ref.itemId === currentItemId) {
      skippedCurrent++;
      return;
    }
    if (seen.has(ref.itemId)) {
      if (isNew) skippedDuplicate++;
      return;
    }
    seen.add(ref.itemId);
    items.push(ref);
    if (isNew) added.push(ref);
  };

  existing.forEach((ref) => append(ref, false));
  candidates.forEach((ref) => append(ref, true));

  return { items, added, skippedCurrent, skippedDuplicate };
}

export function validateQuickChatRelatedSelection(
  refs: QuickChatRelatedItemRef[],
  mode: QuickChatRelatedMode,
): QuickChatRelatedValidation {
  const limit = getQuickChatRelatedLimit(mode);
  if (refs.length > limit.maxItems) {
    return {
      ok: false,
      reason: "too-many-items",
      count: refs.length,
      limit,
    };
  }
  return { ok: true, count: refs.length, limit };
}

export function createQuickChatRelatedContextSignature(
  mode: QuickChatRelatedMode,
  refs: QuickChatRelatedItemRef[],
): string {
  return `${normalizeQuickChatRelatedMode(mode)}:${refs
    .map((ref) => ref.itemId)
    .join(",")}`;
}

export async function resolveQuickChatRelatedContext(
  refs: QuickChatRelatedItemRef[],
  mode: QuickChatRelatedMode,
  deps: QuickChatRelatedContextDeps = {},
): Promise<QuickChatRelatedContextResult> {
  const normalizedMode = normalizeQuickChatRelatedMode(mode);
  const limit = getQuickChatRelatedLimit(normalizedMode);
  const uniqueRefs = mergeQuickChatRelatedItemRefs([], refs).items.slice(
    0,
    limit.maxItems,
  );
  const included: QuickChatRelatedContextItem[] = [];
  const skipped: QuickChatRelatedContextSkip[] = [];
  let totalChars = 0;
  let truncated = false;

  for (const ref of uniqueRefs) {
    const remainingTotal = limit.maxTotalChars - totalChars;
    if (remainingTotal <= 0) {
      truncated = true;
      break;
    }

    const item = await getRelatedItem(ref.itemId, deps);
    if (!item) {
      skipped.push({ ref, reason: "missing-item" });
      continue;
    }

    let rawContent: string | null = null;
    try {
      rawContent =
        normalizedMode === "summary"
          ? await getSummaryMarkdown(item, deps)
          : await getFullText(item, deps);
    } catch (error) {
      skipped.push({
        ref,
        reason: "extract-failed",
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const cleaned = normalizeContextText(rawContent || "");
    if (!cleaned) {
      skipped.push({
        ref,
        reason:
          normalizedMode === "summary" ? "missing-summary" : "extract-failed",
      });
      continue;
    }

    const maxForItem = Math.min(limit.maxCharsPerItem, remainingTotal);
    const content = truncateContextText(cleaned, maxForItem);
    const itemTruncated = content.length < cleaned.length;
    truncated = truncated || itemTruncated;
    included.push({
      ref,
      content,
      originalLength: cleaned.length,
      truncated: itemTruncated,
    });
    totalChars += content.length;
  }

  return {
    mode: normalizedMode,
    signature: createQuickChatRelatedContextSignature(
      normalizedMode,
      uniqueRefs,
    ),
    included,
    skipped,
    totalChars,
    truncated,
  };
}

export function buildQuickChatQuestionWithRelatedContext(
  question: string,
  context: QuickChatRelatedContextResult,
): string {
  if (context.included.length === 0) return question;
  return `${question}\n\n${buildQuickChatRelatedContextBlock(context)}`;
}

export function buildQuickChatRelatedContextBlock(
  context: QuickChatRelatedContextResult,
): string {
  const modeLabel =
    context.mode === "summary" ? "AI summary notes" : "full-text excerpts";
  const papers = context.included.map((entry, index) => {
    const ref = entry.ref;
    return [
      `<RelatedPaper index="${index + 1}" itemId="${ref.itemId}">`,
      `<Title>${escapeXml(ref.title)}</Title>`,
      `<Source>${modeLabel}</Source>`,
      "<Content><![CDATA[",
      escapeCdata(entry.content),
      "]]></Content>",
      "</RelatedPaper>",
    ].join("\n");
  });

  return [
    `<RelatedPapers mode="${context.mode}">`,
    ...papers,
    "</RelatedPapers>",
  ].join("\n");
}

async function getRelatedItem(
  itemId: number,
  deps: QuickChatRelatedContextDeps,
): Promise<Zotero.Item | null> {
  if (deps.getItemById) return deps.getItemById(itemId);
  try {
    return ((await Zotero.Items.getAsync(itemId)) as Zotero.Item) || null;
  } catch {
    return null;
  }
}

async function getSummaryMarkdown(
  item: Zotero.Item,
  deps: QuickChatRelatedContextDeps,
): Promise<string | null> {
  if (deps.getSummaryMarkdown) return deps.getSummaryMarkdown(item);

  const record = await AiNoteService.findNoteRecord(item, "summary");
  if (!record) return null;

  const blocks = LLMNoteMetadataService.parseSummaryBlocks(record.rawHtml);
  const displayBlocks = blocks.filter((block) =>
    hasRenderableHtml(block.content),
  );
  const selected =
    [...displayBlocks].reverse().find((block) => block.kind === "metadata") ||
    displayBlocks[displayBlocks.length - 1] ||
    null;
  const html = LLMNoteMetadataService.stripSidebarMetadata(
    selected ? selected.content : record.rawHtml,
  );
  return htmlToMarkdown(html);
}

async function getFullText(
  item: Zotero.Item,
  deps: QuickChatRelatedContextDeps,
): Promise<string> {
  if (deps.getFullText) return deps.getFullText(item);
  return ContentExtractor.extractTextFromItem(item, "text");
}

function hasRenderableHtml(html: string): boolean {
  return (
    html
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<!--[^]*?-->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/\s+/g, "")
      .trim().length > 0
  );
}

function htmlToMarkdown(html: string): string {
  let result = html;
  result = result.replace(/<style[^>]*>.*?<\/style>/gis, "");
  result = result.replace(/<script[^>]*>.*?<\/script>/gis, "");
  result = result.replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n");
  result = result.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n");
  result = result.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n");
  result = result.replace(/<h4[^>]*>(.*?)<\/h4>/gi, "#### $1\n\n");
  result = result.replace(/<h5[^>]*>(.*?)<\/h5>/gi, "##### $1\n\n");
  result = result.replace(/<h6[^>]*>(.*?)<\/h6>/gi, "###### $1\n\n");
  result = result.replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**");
  result = result.replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**");
  result = result.replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*");
  result = result.replace(/<i[^>]*>(.*?)<\/i>/gi, "*$1*");
  result = result.replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`");
  result = result.replace(/<pre[^>]*>(.*?)<\/pre>/gis, "```\n$1\n```\n");
  result = result.replace(
    /<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi,
    "[$2]($1)",
  );
  result = result.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n");
  result = result.replace(/<ul[^>]*>(.*?)<\/ul>/gis, "$1\n");
  result = result.replace(/<ol[^>]*>(.*?)<\/ol>/gis, "$1\n");
  result = result.replace(/<p[^>]*>(.*?)<\/p>/gis, "$1\n\n");
  result = result.replace(/<br\s*\/?>/gi, "\n");
  result = result.replace(/<hr\s*\/?>/gi, "\n---\n\n");
  result = result.replace(/<div[^>]*>(.*?)<\/div>/gis, "$1\n");
  result = result.replace(/<[^>]+>/g, "");
  result = decodeHtmlEntities(result);
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeContextText(text: string): string {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateContextText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, Math.max(0, maxLength - 3));
  const lastSentence = Math.max(
    truncated.lastIndexOf("."),
    truncated.lastIndexOf("。"),
    truncated.lastIndexOf("!"),
    truncated.lastIndexOf("?"),
  );
  if (lastSentence > maxLength * 0.8) {
    return truncated.slice(0, lastSentence + 1);
  }
  return `${truncated}...`;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeCdata(value: string): string {
  return value.replace(/\]\]>/g, "]]]]><![CDATA[>");
}
