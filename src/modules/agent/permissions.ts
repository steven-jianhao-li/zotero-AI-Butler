import { agentText } from "./messages";
import type { AgentPermission } from "./types";

export function assertToolPermission(
  permission: AgentPermission,
  writesLibrary: boolean,
  isTeammate: boolean,
): void {
  if (writesLibrary && (permission === "read-only" || isTeammate))
    throw new Error(agentText("agent-runtime-readonly"));
}

/** Validate the small JSON-schema subset used by our tool catalog at runtime. */
export function validateToolArguments(
  value: unknown,
  schema: Record<string, unknown>,
  path = "arguments",
): void {
  if (schema.enum && !(schema.enum as unknown[]).includes(value))
    throw new Error(`${path}: unsupported value`);
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`${path}: expected an object`);
    const args = value as Record<string, unknown>;
    const properties = (schema.properties || {}) as Record<
      string,
      Record<string, unknown>
    >;
    for (const key of (schema.required || []) as string[])
      if (!(key in args)) throw new Error(`${path}.${key}: required`);
    for (const [key, child] of Object.entries(args)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key))
        throw new Error(`${path}.${key}: unknown argument`);
      validateToolArguments(child, properties[key], `${path}.${key}`);
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) throw new Error(`${path}: expected an array`);
    if (
      value.length > Number(schema.maxItems ?? 100) ||
      value.length < Number(schema.minItems ?? 0)
    )
      throw new Error(`${path}: invalid array length`);
    value.forEach((child, i) =>
      validateToolArguments(
        child,
        (schema.items || {}) as Record<string, unknown>,
        `${path}[${i}]`,
      ),
    );
  } else if (schema.type === "string") {
    if (
      typeof value !== "string" ||
      value.length > Number(schema.maxLength ?? 24000) ||
      value.length < Number(schema.minLength ?? 0)
    )
      throw new Error(`${path}: invalid string length or type`);
  } else if (schema.type === "integer" || schema.type === "number") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (schema.type === "integer" && !Number.isSafeInteger(value)) ||
      value < Number(schema.minimum ?? 0) ||
      value > Number(schema.maximum ?? Number.MAX_SAFE_INTEGER)
    )
      throw new Error(`${path}: invalid number`);
  } else if (schema.type === "boolean" && typeof value !== "boolean") {
    throw new Error(`${path}: expected a boolean`);
  }
}

export function canonicalArguments(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalArguments).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalArguments(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
