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
}

export interface ParsedLLMNoteBlock {
  metadata: LLMNoteMetadata;
  content: string;
  blockId: string;
}

const BEGIN_PREFIX = "AI_BUTLER_LLM_BLOCK_BEGIN::v1::";
const META_PREFIX = "AI_BUTLER_LLM_META_B64URL::v1::";
const END_PREFIX = "AI_BUTLER_LLM_BLOCK_END::v1::";

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

function formatGeneratedAt(value: string): string {
  const generated = new Date(value);
  return Number.isNaN(generated.getTime()) ? value : generated.toLocaleString();
}

function renderVisibleMetadata(metadata: LLMNoteMetadata): string {
  const providerName = escapeHtml(metadata.providerName || "Unknown provider");
  const modelId = escapeHtml(metadata.modelId || "(unknown)");
  const generatedAt = escapeHtml(formatGeneratedAt(metadata.generatedAt));
  const generatedAtRaw = escapeHtml(metadata.generatedAt);
  return [
    `<p data-ai-butler-llm-source="v1" style="margin: 0 0 12px 0; padding: 6px 8px; border-left: 3px solid #59c0bc; background: #f4fbfb; color: #3d5f5d; font-size: 12px; line-height: 1.45;">`,
    `<strong>AI 来源：</strong>`,
    `供应商：${providerName}`,
    ` · 模型：${modelId}`,
    ` · 生成时间：<span title="${generatedAtRaw}">${generatedAt}</span>`,
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
      renderVisibleMetadata(normalized),
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
    const regex =
      /<!--\s*AI_BUTLER_LLM_BLOCK_BEGIN::v1::([^:\s]+)::[^>]*?-->\s*<!--\s*AI_BUTLER_LLM_META_B64URL::v1::([A-Za-z0-9_-]+)\s*-->([\s\S]*?)<!--\s*AI_BUTLER_LLM_BLOCK_END::v1::\1::[a-f0-9]+\s*-->/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(base64UrlToUtf8(match[2]));
        if (!isMetadata(parsed) || parsed.blockId !== match[1]) continue;
        blocks.push({
          metadata: parsed,
          content: match[3],
          blockId: match[1],
        });
      } catch {
        // Ignore malformed metadata blocks.
      }
    }
    return blocks;
  }

  static getLatest(html: string): LLMNoteMetadata | null {
    const blocks = this.parseAll(html);
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
    return html.replace(
      /<([a-z][\w:-]*)\b(?=[^>]*\bdata-ai-butler-llm-source=(["'])v1\2)[^>]*>[\s\S]*?<\/\1>\s*/gi,
      "",
    );
  }

  static stripSidebarMetadata(html: string): string {
    return this.stripVisibleMetadata(this.stripMetadataComments(html));
  }

  static formatTooltip(metadata: LLMNoteMetadata | null): string {
    if (!metadata) return "No LLM metadata found.";
    const generatedText = formatGeneratedAt(metadata.generatedAt);
    return [
      `Provider: ${metadata.providerName}`,
      `Model: ${metadata.modelId || "(unknown)"}`,
      `Generated: ${generatedText}`,
    ].join("\n");
  }

  static formatSelectorLabel(metadata: LLMNoteMetadata): string {
    return metadata.modelId
      ? `供应商: ${metadata.providerName} 模型: ${metadata.modelId} ⓘ`
      : `供应商: ${metadata.providerName} ⓘ`;
  }
}

export default LLMNoteMetadataService;
