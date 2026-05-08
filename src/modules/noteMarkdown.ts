import { marked } from "marked";

type ProtectedFormula = {
  content: string;
  isBlock: boolean;
};

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Convert Markdown into the HTML dialect Zotero notes can render, including
 * Zotero-native math spans. Shared by summary notes and saved follow-up chats.
 */
export function markdownToZoteroNoteHtml(markdown: string): string {
  const formulas: ProtectedFormula[] = [];
  let processedMarkdown = markdown;

  processedMarkdown = processedMarkdown.replace(
    /(\$\$|\\\[)([\s\S]*?)(\$\$|\\\])/g,
    (_match, _start, formula) => {
      const placeholder = `FORMULA_BLOCK_${formulas.length}_END`;
      formulas.push({ content: formula.trim(), isBlock: true });
      return placeholder;
    },
  );

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

  return html.replace(
    /FORMULA_(BLOCK|INLINE)_(\d+)_END/g,
    (_match, _type, index) => {
      const formulaData = formulas[parseInt(index)];
      if (!formulaData) return _match;

      const escapedContent = escapeHtml(formulaData.content);
      if (formulaData.isBlock) {
        return `<p style="text-align: center;"><span class="math">$\\displaystyle ${escapedContent}$</span></p>`;
      }
      return `<span class="math">$${escapedContent}$</span>`;
    },
  );
}
