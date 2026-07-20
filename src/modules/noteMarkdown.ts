import { marked } from "marked";
import katex from "katex";
import { getString } from "../utils/locale";

type ProtectedFormula = {
  content: string;
  isBlock: boolean;
};

export type FollowUpChatPairNoteHtmlOptions = {
  pairId: string;
  userMessage: string;
  assistantMessage: string;
  savedAt?: Date | string;
  sourceLabel?: string;
};

export type FollowUpChatPair = {
  id: string;
  user: string;
  assistant: string;
};

const FOLLOW_UP_CHAT_PAIR_STYLE =
  "margin-top:14px; padding-top:8px; border-top:1px dashed #8a8a8a;";
const FOLLOW_UP_CHAT_USER_STYLE =
  "padding:10px; border-left:3px solid #4f8fd9; border-radius:4px; margin-bottom:8px; color:inherit; background:transparent;";
const FOLLOW_UP_CHAT_ASSISTANT_STYLE =
  "padding:10px; border-left:3px solid #59c0bc; border-radius:4px; color:inherit; background:transparent;";
const FOLLOW_UP_CHAT_TIME_STYLE =
  "font-size:11px; color:inherit; opacity:0.65; margin-top:6px;";

const NOTE_PRE_STYLE =
  "max-width:100%; overflow-x:auto; overflow-y:hidden; white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word; box-sizing:border-box;";
const NOTE_CODE_STYLE =
  "white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word;";
const NOTE_TABLE_STYLE =
  "max-width:100%; width:auto; table-layout:auto; overflow-wrap:anywhere; word-break:break-word;";
const NOTE_MATH_BLOCK_STYLE =
  "text-align:center; max-width:100%; overflow-x:auto; overflow-y:hidden; overflow-wrap:anywhere; word-break:break-word; box-sizing:border-box;";
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function unescapeHtml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
}

function isInvalidXmlCharCode(code: number): boolean {
  return (
    (code >= 0x00 && code <= 0x08) ||
    code === 0x0b ||
    code === 0x0c ||
    (code >= 0x0e && code <= 0x1f) ||
    (code >= 0x7f && code <= 0x9f)
  );
}

export function stripInvalidXmlChars(text: string): string {
  let sanitized = "";
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === undefined || isInvalidXmlCharCode(code)) continue;
    sanitized += char;
  }
  return sanitized;
}

function decodeHtmlCodePoint(raw: string, radix: 10 | 16): string {
  const codePoint = parseInt(raw, radix);
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return "";
  }
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return "";
  }
}

export function decodeMathHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      decodeHtmlCodePoint(hex, 16),
    )
    .replace(/&#(\d+);/g, (_match, dec: string) =>
      decodeHtmlCodePoint(dec, 10),
    );
}

export function requiresDisplayMath(content: string): boolean {
  return /(^|[^\\])\\tag\s*\{/.test(content);
}

export function stripMathDelimiters(content: string): string {
  let trimmed = content.trim();
  while (
    trimmed.startsWith("$") &&
    trimmed.endsWith("$") &&
    trimmed.length >= 2
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function normalizeLatexForKatex(content: string): string {
  return decodeMathHtmlEntities(stripMathDelimiters(content))
    .replace(/</g, "\\langle ")
    .replace(/>/g, " \\rangle");
}

export function zoteroNoteMathHtml(content: string, isBlock: boolean): string {
  const normalizedContent = stripMathDelimiters(content);
  const escapedContent = escapeHtml(normalizedContent);
  if (isBlock || requiresDisplayMath(normalizedContent)) {
    return `<pre class="math">$$${escapedContent}$$</pre>`;
  }
  return `<span class="math">$${escapedContent}$</span>`;
}

/**
 * Convert Markdown into the HTML dialect Zotero notes can render, including
 * Zotero-native math spans. Shared by summary notes and saved follow-up chats.
 */
export function markdownToZoteroNoteHtml(markdown: string): string {
  const formulas: ProtectedFormula[] = [];
  let processedMarkdown = stripInvalidXmlChars(markdown);

  processedMarkdown = processedMarkdown.replace(
    /(\$\$|\\\[)([\s\S]*?)(\$\$|\\\])/g,
    (_match, _start, formula) => {
      const placeholder = `FORMULA_BLOCK_${formulas.length}_END`;
      formulas.push({ content: formula.trim(), isBlock: true });
      return `\n\n${placeholder}\n\n`;
    },
  );

  processedMarkdown = normalizeMarkdownBlockBoundaries(processedMarkdown);

  processedMarkdown = processedMarkdown.replace(
    // eslint-disable-next-line no-useless-escape
    /((?<!\$)\$(?!\$)|\\\()([^\$\n]+?)((?<!\$)\$(?!\$)|\\\))/g,
    (_match, _start, formula) => {
      const placeholder = `FORMULA_INLINE_${formulas.length}_END`;
      formulas.push({ content: formula.trim(), isBlock: false });
      return placeholder;
    },
  );

  processedMarkdown = processedMarkdown.replace(
    // eslint-disable-next-line no-useless-escape
    /\*\*([^\*\n]+?)\*\*/g,
    "<strong>$1</strong>",
  );

  marked.setOptions({
    breaks: true,
    gfm: true,
  });

  let html = marked.parse(processedMarkdown) as string;
  html = html.replace(/\s+style="[^"]*"/g, "");

  html = html.replace(
    /<p>\s*FORMULA_BLOCK_(\d+)_END\s*<\/p>|<p>\s*FORMULA_INLINE_(\d+)_END\s*<\/p>|FORMULA_(BLOCK|INLINE)_(\d+)_END/g,
    (_match, blockIndex, paragraphInlineIndex, _type, inlineIndex) => {
      const formulaData =
        formulas[parseInt(blockIndex ?? paragraphInlineIndex ?? inlineIndex)];
      if (!formulaData) return _match;

      return zoteroNoteMathHtml(formulaData.content, formulaData.isBlock);
    },
  );

  return addZoteroNoteOverflowGuards(html);
}

function mergeStyleAttribute(tag: string, style: string): string {
  if (tag.includes(style)) return tag;
  const styleMatch = tag.match(/\sstyle="([^"]*)"/i);
  if (styleMatch) {
    return tag.replace(
      styleMatch[0],
      ` style="${styleMatch[1].trim().replace(/;?\s*$/, "; ")}${style}"`,
    );
  }
  return tag.replace(/>$/, ` style="${style}">`);
}

export function addZoteroNoteOverflowGuards(html: string): string {
  return html
    .replace(/<pre\b([^>]*)>/gi, (tag) =>
      mergeStyleAttribute(tag, NOTE_PRE_STYLE),
    )
    .replace(/<code\b([^>]*)>/gi, (tag) =>
      mergeStyleAttribute(tag, NOTE_CODE_STYLE),
    )
    .replace(/<table\b([^>]*)>/gi, (tag) =>
      mergeStyleAttribute(tag, NOTE_TABLE_STYLE),
    )
    .replace(
      /(<p\b[^>]*>)(\s*<span class="math"(?:\s[^>]*)?>[\s\S]*?<\/span>\s*)<\/p>/gi,
      (_match, openingTag, inner) =>
        `${mergeStyleAttribute(openingTag, NOTE_MATH_BLOCK_STYLE)}${inner}</p>`,
    );
}

function normalizeMarkdownBlockBoundaries(markdown: string): string {
  return markdown
    .replace(/^(#{1,6}\s+[^\n]+)\n(?=\S)/gm, "$1\n\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Convert Markdown into display HTML for plugin UI surfaces, including KaTeX
 * rendering for LaTeX formulas.
 */
export function markdownToDisplayHtml(markdown: string): string {
  const formulas: ProtectedFormula[] = [];
  let html = stripInvalidXmlChars(markdown);

  html = html.replace(/\\\[([\s\S]*?)\\\]/g, (_match, formula) => {
    const placeholder = `AI_BUTLER_FORMULA_BLOCK_${formulas.length}_END`;
    formulas.push({ content: formula.trim(), isBlock: true });
    return placeholder;
  });

  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_match, formula) => {
    const placeholder = `AI_BUTLER_FORMULA_BLOCK_${formulas.length}_END`;
    formulas.push({ content: formula.trim(), isBlock: true });
    return placeholder;
  });

  html = html.replace(/\\\((.*?)\\\)/g, (_match, formula) => {
    const placeholder = `AI_BUTLER_FORMULA_INLINE_${formulas.length}_END`;
    formulas.push({ content: formula.trim(), isBlock: false });
    return placeholder;
  });

  // eslint-disable-next-line no-useless-escape
  html = html.replace(/\$([^\$\n]+?)\$/g, (_match, formula) => {
    const placeholder = `AI_BUTLER_FORMULA_INLINE_${formulas.length}_END`;
    formulas.push({ content: formula.trim(), isBlock: false });
    return placeholder;
  });

  marked.setOptions({
    breaks: true,
    gfm: true,
  });

  try {
    html = marked.parse(html) as string;
  } catch {
    html = `<p>${escapeHtml(html)}</p>`;
  }

  const renderFormula = (_match: string, _type: string, index: string) => {
    const formulaData = formulas[parseInt(index)];
    if (!formulaData) return _match;

    const content = normalizeLatexForKatex(formulaData.content);
    const isBlock = formulaData.isBlock || requiresDisplayMath(content);
    try {
      const rendered = katex.renderToString(content, {
        throwOnError: false,
        displayMode: isBlock,
        output: "html",
        trust: true,
        strict: false,
      });

      if (isBlock) {
        return `<div class="katex-display">${rendered}</div>`;
      }
      return `<span class="katex-inline">${rendered}</span>`;
    } catch {
      const escapedContent = escapeHtml(content);
      if (isBlock) {
        return `<pre class="math-fallback">$$${escapedContent}$$</pre>`;
      }
      return `<code class="math-fallback">$${escapedContent}$</code>`;
    }
  };

  html = html.replace(
    /<p>\s*AI_BUTLER_FORMULA_BLOCK_(\d+)_END\s*<\/p>/g,
    (match, index) => renderFormula(match, "BLOCK", index),
  );

  return html.replace(
    /AI_BUTLER_FORMULA_(BLOCK|INLINE)_(\d+)_END/g,
    renderFormula,
  );
}

function escapeJsonForHtmlComment(json: string): string {
  return json
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/--/g, "-\\u002D");
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readHtmlAttribute(html: string, name: string): string {
  const escapedName = escapeRegExp(name);
  const match = html.match(
    new RegExp(`\\b${escapedName}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"),
  );
  return match ? unescapeHtml(match[2]) : "";
}

function htmlToPlainText(html: string): string {
  return unescapeHtml(
    html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeFollowUpChatPair(raw: unknown): FollowUpChatPair | null {
  if (!raw || typeof raw !== "object") return null;
  const pair = raw as Partial<FollowUpChatPair>;
  if (
    pair.id === undefined ||
    pair.user === undefined ||
    pair.assistant === undefined
  ) {
    return null;
  }

  return {
    id: String(pair.id),
    user: String(pair.user),
    assistant: String(pair.assistant),
  };
}

type HtmlElementMatch = {
  tagName: string;
  openingTag: string;
  startIndex: number;
  endIndex: number;
  innerHtml: string;
};

type IndexedFollowUpChatPair = {
  pair: FollowUpChatPair;
  index: number;
};

function findMatchingElementEnd(
  html: string,
  tagName: string,
  openingEndIndex: number,
): number {
  const tagPattern = new RegExp(`<\\/?${escapeRegExp(tagName)}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = openingEndIndex;
  let depth = 1;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(html)) !== null) {
    const token = match[0];
    const isClosingTag = /^<\s*\//.test(token);
    const isSelfClosing = /\/\s*>$/.test(token);

    if (isClosingTag) {
      depth -= 1;
      if (depth === 0) {
        return tagPattern.lastIndex;
      }
    } else if (!isSelfClosing) {
      depth += 1;
    }
  }

  return -1;
}

function findElementsByOpeningTag(
  html: string,
  predicate: (openingTag: string, tagName: string) => boolean,
): HtmlElementMatch[] {
  const results: HtmlElementMatch[] = [];
  const openingTagPattern = /<([a-z][\w:-]*)\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = openingTagPattern.exec(html)) !== null) {
    const tagName = match[1].toLowerCase();
    const openingTag = match[0];
    const openingEndIndex = openingTagPattern.lastIndex;

    if (!predicate(openingTag, tagName)) continue;

    const endIndex = findMatchingElementEnd(html, tagName, openingEndIndex);
    if (endIndex === -1) continue;

    results.push({
      tagName,
      openingTag,
      startIndex: match.index,
      endIndex,
      innerHtml: html.slice(openingEndIndex, endIndex - `</${tagName}>`.length),
    });
  }

  return results;
}

function decodePairFromDataAttribute(
  openingTag: string,
): FollowUpChatPair | null {
  const encodedJson = readHtmlAttribute(openingTag, "data-ai-butler-chat-json");
  if (!encodedJson) return null;

  try {
    return normalizeFollowUpChatPair(JSON.parse(base64UrlToUtf8(encodedJson)));
  } catch {
    return null;
  }
}

function isFollowUpPairOpeningTag(openingTag: string): boolean {
  return (
    readHtmlAttribute(openingTag, "data-ai-butler-chat-pair") === "v1" ||
    !!readHtmlAttribute(openingTag, "data-ai-butler-chat-json") ||
    /^ai-butler-pair-/.test(readHtmlAttribute(openingTag, "id"))
  );
}

function inferFollowUpChatRole(
  openingTag: string,
): "user" | "assistant" | null {
  const explicitRole = readHtmlAttribute(
    openingTag,
    "data-ai-butler-chat-role",
  );
  if (explicitRole === "user" || explicitRole === "assistant") {
    return explicitRole;
  }

  const style = readHtmlAttribute(openingTag, "style").toLowerCase();
  if (style.includes("#4f8fd9") || style.includes("#e3f2fd")) {
    return "user";
  }
  if (style.includes("#59c0bc") || style.includes("#f5f5f5")) {
    return "assistant";
  }
  return null;
}

function parsePairFromVisibleElement(
  element: HtmlElementMatch,
): FollowUpChatPair | null {
  const encodedPair = decodePairFromDataAttribute(element.openingTag);
  if (encodedPair) return encodedPair;

  const pairId =
    readHtmlAttribute(element.openingTag, "data-ai-butler-chat-pair-id") ||
    readHtmlAttribute(element.openingTag, "id").replace(/^ai-butler-pair-/, "");
  if (!pairId) return null;

  let user = "";
  let assistant = "";
  for (const roleElement of findElementsByOpeningTag(
    element.innerHtml,
    (openingTag, tagName) =>
      tagName === "div" && !!inferFollowUpChatRole(openingTag),
  )) {
    const role = inferFollowUpChatRole(roleElement.openingTag);
    const text = htmlToPlainText(
      roleElement.innerHtml.replace(/<strong\b[^>]*>[\s\S]*?<\/strong>/i, ""),
    );
    if (role === "user") {
      user = text;
    } else if (role === "assistant") {
      assistant = text;
    }
  }

  if (!user && !assistant) return null;
  return { id: pairId, user, assistant };
}

function findVisibleFollowUpChatPairs(html: string): IndexedFollowUpChatPair[] {
  return findElementsByOpeningTag(html, (openingTag) =>
    isFollowUpPairOpeningTag(openingTag),
  )
    .map((element) => ({
      pair: parsePairFromVisibleElement(element),
      index: element.startIndex,
    }))
    .filter(
      (item): item is IndexedFollowUpChatPair =>
        !!item.pair && Number.isFinite(item.index),
    );
}

export function parseFollowUpChatPairsFromNoteHtml(
  html: string,
): FollowUpChatPair[] {
  const pairs: FollowUpChatPair[] = [];
  const seenIds = new Set<string>();
  const candidates: IndexedFollowUpChatPair[] = [];
  const pushCandidate = (raw: unknown, index: number) => {
    const parsed = normalizeFollowUpChatPair(raw);
    if (!parsed) return;
    candidates.push({ pair: parsed, index });
  };
  const markerPattern = /<!--\s*AI_BUTLER_CHAT_JSON:\s*([\s\S]*?)\s*-->/g;
  let match: RegExpExecArray | null;

  while ((match = markerPattern.exec(html)) !== null) {
    try {
      pushCandidate(JSON.parse(match[1].trim()), match.index);
    } catch {
      // Ignore malformed legacy markers and keep scanning later pairs.
    }
  }

  candidates.push(...findVisibleFollowUpChatPairs(html));
  candidates.sort((a, b) => a.index - b.index);

  for (const { pair } of candidates) {
    if (seenIds.has(pair.id)) continue;
    seenIds.add(pair.id);
    pairs.push(pair);
  }

  return pairs;
}

export function buildFollowUpChatPairNoteHtml(
  options: FollowUpChatPairNoteHtmlOptions,
): string {
  const renderedUserMessage = markdownToZoteroNoteHtml(options.userMessage);
  const renderedAssistantMessage = markdownToZoteroNoteHtml(
    options.assistantMessage,
  );
  const pairId = escapeHtml(options.pairId);
  const savedAt =
    typeof options.savedAt === "string"
      ? options.savedAt
      : (options.savedAt ?? new Date()).toLocaleString();
  const sourceSuffix = options.sourceLabel
    ? ` (${escapeHtml(options.sourceLabel)})`
    : "";
  const pairJson = JSON.stringify({
    id: options.pairId,
    user: options.userMessage,
    assistant: options.assistantMessage,
  });
  const encodedPairJson = escapeHtml(utf8ToBase64Url(pairJson));
  const jsonMarker = `<!-- AI_BUTLER_CHAT_JSON: ${escapeJsonForHtmlComment(
    pairJson,
  )} -->`;

  return `
<!-- AI_BUTLER_CHAT_PAIR_START id=${pairId} -->
${jsonMarker}
<div id="ai-butler-pair-${pairId}" data-ai-butler-chat-pair="v1" data-ai-butler-chat-pair-id="${pairId}" data-ai-butler-chat-json="${encodedPairJson}" style="${FOLLOW_UP_CHAT_PAIR_STYLE}">
  <div data-ai-butler-chat-role="user" style="${FOLLOW_UP_CHAT_USER_STYLE}"><strong>${getString("follow-up-note-user-label")}</strong><div>${renderedUserMessage}</div></div>
  <div data-ai-butler-chat-role="assistant" style="${FOLLOW_UP_CHAT_ASSISTANT_STYLE}"><strong>${getString("follow-up-note-assistant-label")}</strong><div>${renderedAssistantMessage}</div></div>
  <div style="${FOLLOW_UP_CHAT_TIME_STYLE}">${getString("follow-up-note-saved-at-label")} ${escapeHtml(savedAt)}${sourceSuffix}</div>
</div>
<!-- AI_BUTLER_CHAT_PAIR_END id=${pairId} -->
`;
}

function findLastMatchBefore(pattern: RegExp, html: string, end: number) {
  pattern.lastIndex = 0;
  let last: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null && match.index < end) {
    last = match;
  }
  return last;
}

function expandToWrappingLlmBlock(
  html: string,
  startIndex: number,
  endIndex: number,
): { startIndex: number; endIndex: number } | null {
  const beginPattern = /<!--\s*AI_BUTLER_LLM_BLOCK_BEGIN::v1::[\s\S]*?-->/g;
  const endPattern = /<!--\s*AI_BUTLER_LLM_BLOCK_END::v1::[\s\S]*?-->/g;
  const beginMatch = findLastMatchBefore(beginPattern, html, startIndex);
  if (!beginMatch) return null;

  const endBeforeStart = findLastMatchBefore(endPattern, html, startIndex);
  if (endBeforeStart && endBeforeStart.index > beginMatch.index) {
    return null;
  }

  endPattern.lastIndex = endIndex;
  const endMatch = endPattern.exec(html);
  if (!endMatch) return null;

  return {
    startIndex: beginMatch.index,
    endIndex: endPattern.lastIndex,
  };
}

function removeCommentMarkedFollowUpPair(html: string, pairId: string): string {
  const markerIds = Array.from(new Set([pairId, escapeHtml(pairId)]));
  let output = html;

  for (const markerId of markerIds) {
    const startMarker = `<!-- AI_BUTLER_CHAT_PAIR_START id=${markerId} -->`;
    const endMarker = `<!-- AI_BUTLER_CHAT_PAIR_END id=${markerId} -->`;

    while (true) {
      const startIndex = output.indexOf(startMarker);
      if (startIndex === -1) break;
      const markerEndIndex = output.indexOf(endMarker, startIndex);
      if (markerEndIndex === -1) break;
      const endIndex = markerEndIndex + endMarker.length;
      const expanded = expandToWrappingLlmBlock(
        output,
        startIndex,
        endIndex,
      ) || {
        startIndex,
        endIndex,
      };
      output =
        output.slice(0, expanded.startIndex) + output.slice(expanded.endIndex);
    }
  }

  return output;
}

function visibleMetadataStartBefore(html: string, startIndex: number): number {
  const before = html.slice(0, startIndex);
  const match = before.match(
    /(?:\s*<p\b(?=[^>]*\bdata-ai-butler-llm-source=(["'])v1\1)[^>]*>[\s\S]*?<\/p>\s*)$/i,
  );
  return match ? startIndex - match[0].length : startIndex;
}

function removeVisibleFollowUpPair(html: string, pairId: string): string {
  const elements = findElementsByOpeningTag(html, (openingTag) =>
    isFollowUpPairOpeningTag(openingTag),
  );
  let output = html;

  for (const element of elements.reverse()) {
    const pair = parsePairFromVisibleElement(element);
    if (!pair || pair.id !== pairId) continue;

    const startIndex = visibleMetadataStartBefore(output, element.startIndex);
    output =
      output.slice(0, startIndex) + output.slice(element.endIndex).trimStart();
  }

  return output;
}

export function removeFollowUpChatPairFromNoteHtml(
  html: string,
  pairId: string,
): string {
  return removeVisibleFollowUpPair(
    removeCommentMarkedFollowUpPair(html, pairId),
    pairId,
  );
}

export function normalizeFollowUpChatNoteHtml(html: string): string {
  return html
    .replace(
      /style="background-color:\s*#e3f2fd;\s*padding:\s*10px;\s*border-radius:\s*6px;\s*margin-bottom:\s*8px;?"/gi,
      `style="${FOLLOW_UP_CHAT_USER_STYLE}"`,
    )
    .replace(
      /style="background-color:\s*#f5f5f5;\s*padding:\s*10px;\s*border-radius:\s*6px;?"/gi,
      `style="${FOLLOW_UP_CHAT_ASSISTANT_STYLE}"`,
    )
    .replace(
      /style="font-size:\s*11px;\s*color:\s*#999;\s*margin-top:\s*6px;?"/gi,
      `style="${FOLLOW_UP_CHAT_TIME_STYLE}"`,
    )
    .replace(
      /style="margin-top:\s*14px;\s*padding-top:\s*8px;\s*border-top:\s*1px\s+dashed\s+#ccc;?"/gi,
      `style="${FOLLOW_UP_CHAT_PAIR_STYLE}"`,
    );
}
