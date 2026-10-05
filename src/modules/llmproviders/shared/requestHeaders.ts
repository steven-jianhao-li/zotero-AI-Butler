import { getString } from "../../../utils/locale";

export type LLMCustomHeadersInput =
  string | Record<string, unknown> | null | undefined;

const PROTECTED_HEADER_NAMES = new Set([
  "content-type",
  "authorization",
  "x-api-key",
  "x-goog-api-key",
]);

function parseCustomHeadersText(text: string): unknown {
  const input = text.trim();
  if (!input) return {};

  try {
    return JSON.parse(input);
  } catch {
    /* Try common Python-dict snippets below. */
  }

  let normalized = input.replace(/^\s*headers\s*=\s*/i, "").trim();
  normalized = normalized.replace(/\{\s*\*\*[^,}]+,\s*/g, "{");
  normalized = normalized.replace(/,\s*\*\*[^,}]+(?=,|\})/g, "");
  normalized = normalized
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null")
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, value: string) => {
      return JSON.stringify(value.replace(/\\'/g, "'"));
    });

  return JSON.parse(normalized);
}

export function parseCustomHeaders(
  rawHeaders: LLMCustomHeadersInput,
): Record<string, string> {
  if (!rawHeaders) return {};

  let parsed: unknown;
  try {
    parsed =
      typeof rawHeaders === "string"
        ? parseCustomHeadersText(rawHeaders)
        : rawHeaders;
  } catch (error: any) {
    throw new Error(
      `${getString("llm-error-custom-headers-format")}: ${
        error?.message || getString("llm-error-custom-headers-object")
      }`,
      { cause: error },
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `${getString("llm-error-custom-headers-format")}: ${getString(
        "llm-error-custom-headers-object",
      )}`,
    );
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    const headerName = name.trim();
    if (!headerName) continue;
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(headerName)) {
      throw new Error(
        getString("llm-error-custom-header-name-detail", {
          args: { name: headerName },
        }),
      );
    }
    if (
      value === null ||
      value === undefined ||
      (typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean")
    ) {
      throw new Error(
        getString("llm-error-custom-header-value-type", {
          args: { name: headerName },
        }),
      );
    }

    const headerValue = String(value).trim();
    if (/[\r\n]/.test(headerValue)) {
      throw new Error(
        getString("llm-error-custom-header-value-newline", {
          args: { name: headerName },
        }),
      );
    }
    headers[headerName] = headerValue;
  }

  return headers;
}

export function mergeRequestHeaders(
  baseHeaders: Record<string, string>,
  customHeaders?: LLMCustomHeadersInput,
  options?: { protectAllBaseHeaders?: boolean },
): Record<string, string> {
  const merged = { ...baseHeaders };
  const protectedHeaderNames = options?.protectAllBaseHeaders
    ? new Set(Object.keys(baseHeaders).map((name) => name.toLowerCase()))
    : PROTECTED_HEADER_NAMES;

  for (const [name, value] of Object.entries(
    parseCustomHeaders(customHeaders),
  )) {
    if (protectedHeaderNames.has(name.toLowerCase())) continue;
    merged[name] = value;
  }

  return merged;
}
