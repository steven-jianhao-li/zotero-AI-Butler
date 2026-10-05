import { getString } from "../../../utils/locale";

/** Parse and validate custom HTTP headers without exposing their values in errors. */
export function parseCustomRequestHeaders(
  input: unknown,
): Record<string, string> {
  if (input === undefined || input === "") return {};

  let parsed: unknown = input;
  if (typeof input === "string") {
    if (!input.trim()) return {};
    try {
      parsed = JSON.parse(input);
    } catch {
      throw new Error(getString("llm-custom-headers-error-json"));
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(getString("llm-custom-headers-error-object"));
  }

  const entries: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(parsed)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
      throw new Error(
        getString("llm-custom-headers-error-name", { args: { name } }),
      );
    }
    if (typeof value !== "string" || /[^\t\x20-\x7e\x80-\xff]/.test(value)) {
      throw new Error(
        getString("llm-custom-headers-error-value", { args: { name } }),
      );
    }
    entries.push([name, value]);
  }
  return Object.fromEntries(entries);
}

/** Custom headers override defaults case-insensitively, with no duplicate names. */
export function mergeRequestHeaders(
  defaults: Record<string, string>,
  customHeaders?: Record<string, string>,
): Record<string, string> {
  const headers = new Map<string, [string, string]>();
  for (const [name, value] of [
    ...Object.entries(defaults),
    ...Object.entries(parseCustomRequestHeaders(customHeaders)),
  ]) {
    headers.set(name.toLowerCase(), [name, value]);
  }
  return Object.fromEntries(headers.values());
}
