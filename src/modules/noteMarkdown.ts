import { marked } from "marked";
import katex from "katex";

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
    /<p>\s*FORMULA_BLOCK_(\d+)_END\s*<\/p>|FORMULA_(BLOCK|INLINE)_(\d+)_END/g,
    (_match, blockIndex, _type, inlineIndex) => {
      const formulaData = formulas[parseInt(blockIndex ?? inlineIndex)];
      if (!formulaData) return _match;

      const escapedContent = escapeHtml(formulaData.content);
      if (formulaData.isBlock) {
        return `<p style="text-align: center;"><span class="math">$\\displaystyle ${escapedContent}$</span></p>`;
      }
      return `<span class="math">$${escapedContent}$</span>`;
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
      /(<p\b[^>]*>)(\s*<span class="math">[\s\S]*?<\/span>\s*)<\/p>/gi,
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

    const { isBlock } = formulaData;
    const content = decodeMathHtmlEntities(formulaData.content);
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

export function parseFollowUpChatPairsFromNoteHtml(
  html: string,
): FollowUpChatPair[] {
  const pairs: FollowUpChatPair[] = [];
  const seenIds = new Set<string>();
  const markerPattern = /<!--\s*AI_BUTLER_CHAT_JSON:\s*([\s\S]*?)\s*-->/g;
  let match: RegExpExecArray | null;

  while ((match = markerPattern.exec(html)) !== null) {
    try {
      const parsed = normalizeFollowUpChatPair(JSON.parse(match[1].trim()));
      if (!parsed || seenIds.has(parsed.id)) continue;
      seenIds.add(parsed.id);
      pairs.push(parsed);
    } catch {
      // Ignore malformed legacy markers and keep scanning later pairs.
    }
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
      : (options.savedAt ?? new Date()).toLocaleString("zh-CN");
  const sourceSuffix = options.sourceLabel
    ? ` (${escapeHtml(options.sourceLabel)})`
    : "";
  const jsonMarker = `<!-- AI_BUTLER_CHAT_JSON: ${escapeJsonForHtmlComment(
    JSON.stringify({
      id: options.pairId,
      user: options.userMessage,
      assistant: options.assistantMessage,
    }),
  )} -->`;

  return `
<!-- AI_BUTLER_CHAT_PAIR_START id=${pairId} -->
${jsonMarker}
<div id="ai-butler-pair-${pairId}" style="${FOLLOW_UP_CHAT_PAIR_STYLE}">
  <div style="${FOLLOW_UP_CHAT_USER_STYLE}"><strong>👤 用户:</strong><div>${renderedUserMessage}</div></div>
  <div style="${FOLLOW_UP_CHAT_ASSISTANT_STYLE}"><strong>🤖 AI管家:</strong><div>${renderedAssistantMessage}</div></div>
  <div style="${FOLLOW_UP_CHAT_TIME_STYLE}">保存时间: ${escapeHtml(savedAt)}${sourceSuffix}</div>
</div>
<!-- AI_BUTLER_CHAT_PAIR_END id=${pairId} -->
`;
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
