/**
 * Remove model-internal reasoning text that some OpenAI-compatible backends
 * place in the visible assistant content instead of a separate reasoning field.
 */

const REASONING_TAGS = ["think", "thinking", "reasoning"];

function stripTaggedReasoningBlock(text: string, tag: string): string {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blockPattern = new RegExp(
    `<\\s*${escapedTag}\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*${escapedTag}\\s*>`,
    "gi",
  );
  return text.replace(blockPattern, "\n\n");
}

function normalizeSanitizedWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Strips reasoning blocks such as `<think>...</think>` from final LLM output.
 *
 * These tags are emitted by several local/open-source reasoning models through
 * OpenAI-compatible Chat Completions. If not removed before Markdown rendering,
 * Zotero hides the unknown HTML tag but keeps the text inside it in the note.
 */
export function sanitizeLLMOutputText(text: string): string {
  if (!text) return text;

  let sanitized = text;
  for (const tag of REASONING_TAGS) {
    sanitized = stripTaggedReasoningBlock(sanitized, tag);
  }

  return sanitized === text ? text : normalizeSanitizedWhitespace(sanitized);
}
