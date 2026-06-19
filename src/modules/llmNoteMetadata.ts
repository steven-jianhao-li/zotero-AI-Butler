import type { LLMResponse } from "./llmproviders/types";
import type { LLMTask } from "./llmService";

export interface LLMNoteMetadata {
  schema: "AI_BUTLER_LLM_NOTE_BLOCK";
  version: 1;
  blockId: string;
  task: LLMTask | "chat";
  endpointId?: string;
  providerId: string;
  providerName: string;
  modelId?: string;
  generatedAt: string;
  warnings?: string[];
}

export interface ParsedLLMNoteBlock {
  metadata: LLMNoteMetadata;
  content: string;
  blockId: string;
  rawHtml?: string;
  startIndex?: number;
  endIndex?: number;
}

export type ParsedLLMNoteSummaryBlockKind = "metadata" | "legacy";

export interface ParsedLLMNoteSummaryBlock {
  kind: ParsedLLMNoteSummaryBlockKind;
  blockId: string;
  metadata: LLMNoteMetadata | null;
  content: string;
  rawHtml?: string;
  startIndex?: number;
  endIndex?: number;
}

const BEGIN_PREFIX = "AI_BUTLER_LLM_BLOCK_BEGIN::v1::";
const META_PREFIX = "AI_BUTLER_LLM_META_B64URL::v1::";
const END_PREFIX = "AI_BUTLER_LLM_BLOCK_END::v1::";
export const LEGACY_SUMMARY_BLOCK_ID = "__ai_butler_legacy_summary__";

function randomToken(): string {
  return Math.random().toString(36).slice(2, 12);
}

function makeBlockId(task: string): string {
  return `llm-${task}-${Date.now().toString(36)}-${randomToken()}`;
}

function htmlComment(value: string): string {
  return `<!-- ${value} -->`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function unescapeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripHtmlTags(value: string): string {
  return unescapeHtml(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function formatGeneratedAt(value: string): string {
  const generated = new Date(value);
  return Number.isNaN(generated.getTime()) ? value : generated.toLocaleString();
}

function renderVisibleMetadata(
  metadata: LLMNoteMetadata,
  encodedMetadata: string,
): string {
  const providerName = escapeHtml(metadata.providerName || "Unknown provider");
  const modelId = escapeHtml(metadata.modelId || "(unknown)");
  const generatedAt = escapeHtml(formatGeneratedAt(metadata.generatedAt));
  const generatedAtRaw = escapeHtml(metadata.generatedAt);
  const blockId = escapeHtml(metadata.blockId);
  const encoded = escapeHtml(encodedMetadata);
  const warnings = (metadata.warnings || [])
    .map((warning) => warning.trim())
    .filter((warning) => warning.length > 0);
  const warningHtml =
    warnings.length > 0 ? ` · 提示：${escapeHtml(warnings.join("；"))}` : "";
  return [
    `<p data-ai-butler-llm-source="v1" data-ai-butler-llm-block-id="${blockId}" data-ai-butler-llm-meta="${encoded}" style="margin: 0 0 12px 0; padding: 6px 8px; border-left: 3px solid #59c0bc; background: #f4fbfb; color: #3d5f5d; font-size: 12px; line-height: 1.45;">`,
    `<strong>AI 来源：</strong>`,
    `供应商：${providerName}`,
    ` · 模型：${modelId}`,
    ` · 生成时间：<span title="${generatedAtRaw}">${generatedAt}</span>`,
    warningHtml,
    `</p>`,
  ].join("");
}

function insertVisibleMetadataAfterTitle(
  html: string,
  visibleMetadata: string,
): string {
  const headingMatch = html.match(/^(\s*<(h[1-6])\b[^>]*>[\s\S]*?<\/\2>\s*)/i);
  if (!headingMatch) {
    return `${visibleMetadata}\n${html}`;
  }
  return `${headingMatch[1]}\n${visibleMetadata}\n${html.slice(
    headingMatch[1].length,
  )}`;
}

function utf8ToBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...Array.from(chunk));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToUtf8(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + "=".repeat(padLength));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isMetadata(value: unknown): value is LLMNoteMetadata {
  const item = value as Partial<LLMNoteMetadata> | null;
  return (
    !!item &&
    item.schema === "AI_BUTLER_LLM_NOTE_BLOCK" &&
    item.version === 1 &&
    typeof item.blockId === "string" &&
    typeof item.providerId === "string" &&
    typeof item.providerName === "string" &&
    typeof item.generatedAt === "string"
  );
}

function metadataBlockRegex(): RegExp {
  return /<!--\s*AI_BUTLER_LLM_BLOCK_BEGIN::v1::([^:\s]+)::[^>]*?-->\s*<!--\s*AI_BUTLER_LLM_META_B64URL::v1::([A-Za-z0-9_-]+)\s*-->([\s\S]*?)<!--\s*AI_BUTLER_LLM_BLOCK_END::v1::\1::[a-f0-9]+\s*-->/g;
}

function visibleMetadataRegex(): RegExp {
  return /<([a-z][\w:-]*)\b(?=[^>]*\bdata-ai-butler-llm-source=(["'])v1\2)([^>]*)>[\s\S]*?<\/\1>/gi;
}

function visibleMetadataTextRegex(): RegExp {
  return /<p\b[^>]*>(?:(?!<\/p>)[\s\S])*?AI\s*来源[:：](?:(?!<\/p>)[\s\S])*?供应商[:：](?:(?!<\/p>)[\s\S])*?(?:模型[:：]|生成时间[:：])(?:(?!<\/p>)[\s\S])*?<\/p>/gi;
}

function readHtmlAttribute(html: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(
    new RegExp(`\\b${escapedName}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"),
  );
  return match ? unescapeHtml(match[2]) : "";
}

function trimStructuralSeparators(html: string): string {
  let output = html.trim();
  const edgeSeparator =
    /^(?:\s|<br\s*\/?>|<hr\s*\/?>|<p>\s*(?:&nbsp;|\s|<br\s*\/?>)*<\/p>)+/i;
  const trailingSeparator =
    /(?:\s|<br\s*\/?>|<hr\s*\/?>|<p>\s*(?:&nbsp;|\s|<br\s*\/?>)*<\/p>)+$/i;
  let previous = "";
  while (output !== previous) {
    previous = output;
    output = output.replace(edgeSeparator, "").replace(trailingSeparator, "");
  }
  return output.trim();
}

function hasMeaningfulHtml(html: string): boolean {
  const normalized = trimStructuralSeparators(html)
    .replace(/<hr\s*\/?>/gi, "")
    .replace(/<br\s*\/?>/gi, "")
    .replace(/<p>\s*(?:&nbsp;|\s|<br\s*\/?>)*<\/p>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, "");
  return normalized.length > 0;
}

function compactNoteHtml(html: string): string {
  return trimStructuralSeparators(
    html
      .replace(/(?:\s*<hr\s*\/?>\s*){2,}/gi, "\n<hr/>\n")
      .replace(/^\s*<hr\s*\/?>\s*/i, "")
      .replace(/\s*<hr\s*\/?>\s*$/i, ""),
  );
}

function findLastHeadingIndex(html: string): number {
  const regex = /<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>/gi;
  let match: RegExpExecArray | null;
  let index = -1;
  while ((match = regex.exec(html)) !== null) {
    index = match.index;
  }
  return index;
}

function findVisibleBlockStart(
  html: string,
  searchFrom: number,
  metaStart: number,
): number {
  const beforeMeta = html.slice(searchFrom, metaStart);
  const headingIndex = findLastHeadingIndex(beforeMeta);
  if (headingIndex >= 0) {
    return searchFrom + headingIndex;
  }
  return metaStart;
}

function findVisibleMetadataElements(
  html: string,
): Array<{ visibleHtml: string; metaStart: number; metaEnd: number }> {
  const markers: Array<{
    visibleHtml: string;
    metaStart: number;
    metaEnd: number;
  }> = [];
  const seen = new Set<string>();

  const addMatches = (regex: RegExp) => {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
      const key = `${match.index}:${match.index + match[0].length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      markers.push({
        visibleHtml: match[0],
        metaStart: match.index,
        metaEnd: match.index + match[0].length,
      });
    }
  };

  addMatches(visibleMetadataRegex());
  addMatches(visibleMetadataTextRegex());

  return markers.sort((a, b) => a.metaStart - b.metaStart);
}

function inferVisibleMetadata(
  visibleHtml: string,
  blockHtml: string,
): LLMNoteMetadata {
  const encoded = readHtmlAttribute(visibleHtml, "data-ai-butler-llm-meta");
  if (encoded) {
    try {
      const parsed = JSON.parse(base64UrlToUtf8(encoded));
      if (isMetadata(parsed)) return parsed;
    } catch {
      // Fall through to visible text inference.
    }
  }

  const text = stripHtmlTags(visibleHtml);
  const providerMatch = text.match(
    /供应商[:：]\s*(.*?)(?:\s*[·|]\s*模型[:：]|\s*[·|]\s*生成时间[:：]|$)/,
  );
  const modelMatch = text.match(
    /模型[:：]\s*(.*?)(?:\s*[·|]\s*生成时间[:：]|$)/,
  );
  const generatedAtRaw =
    readHtmlAttribute(visibleHtml, "title") ||
    (text.match(/生成时间[:：]\s*(.*?)$/)?.[1] || "").trim();
  const isChat =
    /AI_BUTLER_CHAT_PAIR_|来自快速追问|<h2>\s*AI\s+管家\s*-\s*后续追问\s*-/i.test(
      blockHtml,
    );
  const blockId =
    readHtmlAttribute(visibleHtml, "data-ai-butler-llm-block-id") ||
    `visible-${isChat ? "chat" : "summary"}-${hashString(blockHtml)}`;

  return {
    schema: "AI_BUTLER_LLM_NOTE_BLOCK",
    version: 1,
    blockId,
    task: isChat ? "chat" : "summary",
    providerId: "unknown",
    providerName: providerMatch?.[1]?.trim() || "Unknown provider",
    modelId: modelMatch?.[1]?.trim() || undefined,
    generatedAt: generatedAtRaw || new Date(0).toISOString(),
  };
}

export class LLMNoteMetadataService {
  static fromResponse(
    task: LLMTask | "chat",
    response?: LLMResponse | null,
  ): LLMNoteMetadata {
    return {
      schema: "AI_BUTLER_LLM_NOTE_BLOCK",
      version: 1,
      blockId: makeBlockId(task),
      task,
      endpointId: response?.endpointId,
      providerId: response?.providerId || "unknown",
      providerName:
        response?.providerName || response?.providerId || "Unknown provider",
      modelId: response?.model,
      generatedAt: response?.generatedAt || new Date().toISOString(),
      warnings: response?.warnings,
    };
  }

  static wrapHtml(html: string, metadata: LLMNoteMetadata): string {
    const blockId = metadata.blockId || makeBlockId(metadata.task);
    const normalized: LLMNoteMetadata = {
      ...metadata,
      blockId,
      schema: "AI_BUTLER_LLM_NOTE_BLOCK",
      version: 1,
    };
    const encoded = utf8ToBase64Url(JSON.stringify(normalized));
    const nonce = randomToken();
    const visibleHtml = insertVisibleMetadataAfterTitle(
      html,
      renderVisibleMetadata(normalized, encoded),
    );
    const checksum = hashString(`${blockId}\n${encoded}\n${visibleHtml}`);
    return [
      htmlComment(`${BEGIN_PREFIX}${blockId}::${nonce}`),
      htmlComment(`${META_PREFIX}${encoded}`),
      visibleHtml,
      htmlComment(`${END_PREFIX}${blockId}::${checksum}`),
    ].join("\n");
  }

  static parseAll(html: string): ParsedLLMNoteBlock[] {
    const blocks: ParsedLLMNoteBlock[] = [];
    const regex = metadataBlockRegex();
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(base64UrlToUtf8(match[2]));
        if (!isMetadata(parsed) || parsed.blockId !== match[1]) continue;
        blocks.push({
          metadata: parsed,
          content: match[3],
          blockId: match[1],
          rawHtml: match[0],
          startIndex: match.index,
          endIndex: match.index + match[0].length,
        });
      } catch {
        // Ignore malformed metadata blocks.
      }
    }
    return blocks.length > 0 ? blocks : this.parseVisibleMetadataBlocks(html);
  }

  static parseSummaryBlocks(html: string): ParsedLLMNoteSummaryBlock[] {
    const commentBlocks = this.parseCommentMetadataBlocks(html);
    const visibleBlocks = this.parseVisibleMetadataBlocks(html);
    const metadataBlocks =
      visibleBlocks.length > commentBlocks.length
        ? visibleBlocks
        : commentBlocks;
    const summaryBlocks: ParsedLLMNoteSummaryBlock[] = [];
    const legacyContent =
      metadataBlocks.length > 0
        ? this.extractLegacySummaryContent(html, metadataBlocks)
        : "";

    if (legacyContent) {
      summaryBlocks.push({
        kind: "legacy",
        blockId: LEGACY_SUMMARY_BLOCK_ID,
        metadata: null,
        content: legacyContent,
      });
    }

    for (const block of metadataBlocks) {
      if (block.metadata.task !== "summary") continue;
      summaryBlocks.push({
        kind: "metadata",
        blockId: block.blockId,
        metadata: block.metadata,
        content: block.content,
        rawHtml: block.rawHtml,
        startIndex: block.startIndex,
        endIndex: block.endIndex,
      });
    }

    if (summaryBlocks.length > 0) return summaryBlocks;

    const stripped = this.stripSidebarMetadata(html);
    return hasMeaningfulHtml(stripped)
      ? [
          {
            kind: "legacy",
            blockId: LEGACY_SUMMARY_BLOCK_ID,
            metadata: null,
            content: compactNoteHtml(stripped),
          },
        ]
      : [];
  }

  static replaceBlockContent(
    html: string,
    blockId: string,
    newContent: string,
  ): string {
    const regex = metadataBlockRegex();
    let replaced = false;

    const updated = html.replace(regex, (match, matchedBlockId, encoded) => {
      if (matchedBlockId !== blockId) {
        return match;
      }

      try {
        const parsed = JSON.parse(base64UrlToUtf8(encoded));
        if (!isMetadata(parsed) || parsed.blockId !== blockId) {
          return match;
        }
        replaced = true;
        return this.wrapHtml(newContent, parsed);
      } catch {
        return match;
      }
    });

    if (replaced) {
      return updated;
    }

    const visibleUpdated = this.replaceVisibleBlockContent(
      html,
      blockId,
      newContent,
    );
    if (visibleUpdated !== null) return visibleUpdated;

    throw new Error(`LLM note block not found: ${blockId}`);
  }

  static replaceSummaryBlockContent(
    html: string,
    blockId: string,
    newContent: string,
  ): string {
    if (blockId !== LEGACY_SUMMARY_BLOCK_ID) {
      return this.replaceBlockContent(html, blockId, newContent);
    }

    const metadataBlocks = this.parseAll(html);
    if (metadataBlocks.length === 0) {
      return compactNoteHtml(newContent);
    }

    const preservedBlocks = metadataBlocks
      .map((block) => block.rawHtml || "")
      .filter(Boolean);
    return compactNoteHtml(
      [newContent, ...preservedBlocks]
        .filter((part) => part.trim())
        .join("\n<hr/>\n"),
    );
  }

  static removeSummaryBlock(html: string, blockId: string): string {
    if (blockId === LEGACY_SUMMARY_BLOCK_ID) {
      return this.removeLegacySummaryContent(html);
    }

    const regex = metadataBlockRegex();
    let removed = false;
    const updated = html.replace(regex, (match, matchedBlockId, encoded) => {
      if (matchedBlockId !== blockId) return match;
      try {
        const parsed = JSON.parse(base64UrlToUtf8(encoded));
        if (!isMetadata(parsed) || parsed.blockId !== blockId) return match;
      } catch {
        return match;
      }
      removed = true;
      return "";
    });

    if (removed) {
      return compactNoteHtml(updated);
    }

    const visibleUpdated = this.removeVisibleBlock(html, blockId);
    if (visibleUpdated !== null) return visibleUpdated;

    throw new Error(`LLM note block not found: ${blockId}`);
  }

  static hasSummaryBlocks(html: string): boolean {
    return this.parseSummaryBlocks(html).length > 0;
  }

  static getLatest(html: string): LLMNoteMetadata | null {
    const blocks = this.parseAll(html).filter(
      (block) => block.metadata.task === "summary",
    );
    return blocks.length > 0 ? blocks[blocks.length - 1].metadata : null;
  }

  static stripMetadataComments(html: string): string {
    return html
      .replace(/<!--\s*AI_BUTLER_LLM_BLOCK_BEGIN::v1::[^>]*?-->\s*/g, "")
      .replace(
        /<!--\s*AI_BUTLER_LLM_META_B64URL::v1::[A-Za-z0-9_-]+\s*-->\s*/g,
        "",
      )
      .replace(/\s*<!--\s*AI_BUTLER_LLM_BLOCK_END::v1::[^>]*?-->/g, "");
  }

  static stripVisibleMetadata(html: string): string {
    return html
      .replace(
        /<([a-z][\w:-]*)\b(?=[^>]*\bdata-ai-butler-llm-source=(["'])v1\2)[^>]*>[\s\S]*?<\/\1>\s*/gi,
        "",
      )
      .replace(visibleMetadataTextRegex(), "");
  }

  static stripSidebarMetadata(html: string): string {
    return this.stripVisibleMetadata(this.stripMetadataComments(html));
  }

  static formatTooltip(metadata: LLMNoteMetadata | null): string {
    if (!metadata) return "未记录模型信息。";
    const generatedText = formatGeneratedAt(metadata.generatedAt);
    return [
      `Provider: ${metadata.providerName}`,
      `Model: ${metadata.modelId || "(unknown)"}`,
      `Generated: ${generatedText}`,
      ...(metadata.warnings && metadata.warnings.length > 0
        ? [`Warnings: ${metadata.warnings.join("; ")}`]
        : []),
    ].join("\n");
  }

  static formatSelectorLabel(metadata: LLMNoteMetadata): string {
    const generatedText = formatGeneratedAt(metadata.generatedAt);
    return metadata.modelId
      ? `供应商: ${metadata.providerName} 模型: ${metadata.modelId} · ${generatedText} ⓘ`
      : `供应商: ${metadata.providerName} · ${generatedText} ⓘ`;
  }

  static formatSummaryBlockSelectorLabel(
    block: ParsedLLMNoteSummaryBlock,
  ): string {
    return block.metadata
      ? this.formatSelectorLabel(block.metadata)
      : "未记录模型";
  }

  static formatSummaryBlockTooltip(block: ParsedLLMNoteSummaryBlock): string {
    return block.metadata
      ? this.formatTooltip(block.metadata)
      : "未记录模型信息。";
  }

  private static parseCommentMetadataBlocks(
    html: string,
  ): ParsedLLMNoteBlock[] {
    const blocks: ParsedLLMNoteBlock[] = [];
    const regex = metadataBlockRegex();
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(base64UrlToUtf8(match[2]));
        if (!isMetadata(parsed) || parsed.blockId !== match[1]) continue;
        blocks.push({
          metadata: parsed,
          content: match[3],
          blockId: match[1],
          rawHtml: match[0],
          startIndex: match.index,
          endIndex: match.index + match[0].length,
        });
      } catch {
        // Ignore malformed metadata blocks.
      }
    }
    return blocks;
  }

  private static parseVisibleMetadataBlocks(
    html: string,
  ): ParsedLLMNoteBlock[] {
    const markers: Array<{
      visibleHtml: string;
      metaStart: number;
      metaEnd: number;
      blockStart: number;
    }> = [];
    let searchFrom = 0;
    for (const marker of findVisibleMetadataElements(html)) {
      const blockStart = findVisibleBlockStart(
        html,
        searchFrom,
        marker.metaStart,
      );
      markers.push({
        visibleHtml: marker.visibleHtml,
        metaStart: marker.metaStart,
        metaEnd: marker.metaEnd,
        blockStart,
      });
      searchFrom = marker.metaEnd;
    }

    return markers.map((marker, index) => {
      const blockEnd =
        index + 1 < markers.length
          ? markers[index + 1].blockStart
          : html.length;
      const rawHtml = compactNoteHtml(html.slice(marker.blockStart, blockEnd));
      const metadata = inferVisibleMetadata(marker.visibleHtml, rawHtml);
      return {
        metadata,
        content: rawHtml,
        blockId: metadata.blockId,
        rawHtml,
        startIndex: marker.blockStart,
        endIndex: blockEnd,
      };
    });
  }

  private static replaceVisibleBlockContent(
    html: string,
    blockId: string,
    newContent: string,
  ): string | null {
    const block = this.parseVisibleMetadataBlocks(html).find(
      (item) => item.blockId === blockId,
    );
    if (
      !block ||
      typeof block.startIndex !== "number" ||
      typeof block.endIndex !== "number"
    ) {
      return null;
    }
    return compactNoteHtml(
      `${html.slice(0, block.startIndex)}${this.wrapHtml(
        newContent,
        block.metadata,
      )}${html.slice(block.endIndex)}`,
    );
  }

  private static removeVisibleBlock(
    html: string,
    blockId: string,
  ): string | null {
    const block = this.parseVisibleMetadataBlocks(html).find(
      (item) => item.blockId === blockId,
    );
    if (
      !block ||
      typeof block.startIndex !== "number" ||
      typeof block.endIndex !== "number"
    ) {
      return null;
    }
    return compactNoteHtml(
      `${html.slice(0, block.startIndex)}${html.slice(block.endIndex)}`,
    );
  }

  private static extractLegacySummaryContent(
    html: string,
    metadataBlocks: ParsedLLMNoteBlock[] = this.parseAll(html),
  ): string {
    if (metadataBlocks.length === 0) return "";

    const chunks: string[] = [];
    let cursor = 0;
    for (const block of metadataBlocks) {
      const start = block.startIndex ?? cursor;
      const end = block.endIndex ?? start;
      chunks.push(html.slice(cursor, start));
      cursor = end;
    }
    chunks.push(html.slice(cursor));

    const legacy = compactNoteHtml(
      this.stripSidebarMetadata(chunks.join("\n")),
    );
    return hasMeaningfulHtml(legacy) ? legacy : "";
  }

  private static removeLegacySummaryContent(html: string): string {
    const metadataBlocks = this.parseAll(html);
    if (metadataBlocks.length === 0) return "";
    return compactNoteHtml(
      metadataBlocks
        .map((block) => block.rawHtml || "")
        .filter(Boolean)
        .join("\n<hr/>\n"),
    );
  }
}

export default LLMNoteMetadataService;
