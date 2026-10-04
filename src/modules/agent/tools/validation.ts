import { getString } from "../../../utils/locale";

/** Strict validation at the model-to-library boundary. */
export function exactKeys(
  args: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error(getString("agent-tool-error-object-required"));
  }
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key))
      throw new Error(
        getString("agent-tool-error-unknown-argument", { args: { key } }),
      );
  }
}

export function stringArg(
  args: Record<string, unknown>,
  key: string,
  maxLength: number,
  allowEmpty = false,
): string {
  const value = args[key];
  if (
    typeof value !== "string" ||
    value.length > maxLength ||
    (!allowEmpty && !value.trim()) ||
    value.includes("\0")
  ) {
    throw new Error(
      getString(
        allowEmpty
          ? "agent-tool-error-string"
          : "agent-tool-error-nonempty-string",
        { args: { key, maxLength } },
      ),
    );
  }
  return value.trim();
}

export function integerArg(
  args: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
  defaultValue?: number,
): number {
  const value = args[key] === undefined ? defaultValue : args[key];
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      getString("agent-tool-error-integer", {
        args: { key, minimum, maximum },
      }),
    );
  }
  return value;
}

export function enumArg<T extends string>(
  args: Record<string, unknown>,
  key: string,
  values: readonly T[],
  defaultValue?: T,
): T {
  const value = args[key] === undefined ? defaultValue : args[key];
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new Error(
      getString("agent-tool-error-enum", {
        args: { key, values: values.join(", ") },
      }),
    );
  }
  return value as T;
}

export function idsArg(args: Record<string, unknown>, key: string): number[] {
  const value = args[key];
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
    throw new Error(getString("agent-tool-error-item-ids", { args: { key } }));
  }
  return [...new Set(value.map((id) => integerArg({ id }, "id", 1)))];
}

export function stringsArg(
  args: Record<string, unknown>,
  key: string,
): string[] {
  const value = args[key] === undefined ? [] : args[key];
  if (!Array.isArray(value) || value.length > 50) {
    throw new Error(
      getString("agent-tool-error-string-array", { args: { key } }),
    );
  }
  return [...new Set(value.map((tag) => stringArg({ tag }, "tag", 120)))];
}

/** HTML source is never interpreted when the agent creates a note. */
export function escapeNoteText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
