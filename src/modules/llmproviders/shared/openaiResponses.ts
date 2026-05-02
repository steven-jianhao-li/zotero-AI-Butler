function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function collectContentText(content: unknown): string[] {
  if (!Array.isArray(content)) return [];

  const parts: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;

    const directText = readString(part.text);
    if (directText) {
      parts.push(directText);
      continue;
    }

    const nestedText = isRecord(part.output_text)
      ? readString(part.output_text.text)
      : null;
    if (nestedText) parts.push(nestedText);
  }
  return parts;
}

/**
 * 从 OpenAI Responses API 的原始 JSON 中提取最终文本。
 *
 * 官方 HTTP 响应的正文通常位于 output[].content[].text；
 * SDK 可能额外提供 output_text 便利字段，因此这里先读便利字段，
 * 再回退遍历标准 output 结构。
 */
export function parseOpenAIResponsesText(data: unknown): string {
  if (!isRecord(data)) return "";

  const outputText = readString(data.output_text);
  if (outputText && outputText.length > 0) return outputText;

  const output = data.output;
  if (!Array.isArray(output)) return "";

  const parts: string[] = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    parts.push(...collectContentText(item.content));
  }
  return parts.join("");
}

export function parseOpenAIResponsesDelta(event: unknown): string {
  if (!isRecord(event)) return "";
  return event.type === "response.output_text.delta" &&
    typeof event.delta === "string"
    ? event.delta
    : "";
}
