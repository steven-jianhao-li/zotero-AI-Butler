import type { LLMModelInfo } from "../types";

export function deriveVersionedModelsUrl(
  apiUrl: string | undefined,
  fallbackUrl: string,
  defaultVersionPath = "/v1",
): string {
  const raw = (apiUrl || fallbackUrl).trim().replace(/\/+$/, "");
  if (!raw) return fallbackUrl;

  const versioned = raw.replace(/(\/v\d+(?:beta)?)(?:\/.*)?$/i, "$1/models");
  if (versioned !== raw) return versioned;

  return `${raw}${defaultVersionPath}/models`;
}

export function deriveAnthropicModelsUrl(apiUrl: string | undefined): string {
  const raw = (apiUrl || "https://api.anthropic.com")
    .trim()
    .replace(/\/+$/, "");
  const versioned = raw.replace(/\/v1(?:\/.*)?$/i, "/v1/models");
  if (versioned !== raw) return versioned;
  return `${raw}/v1/models`;
}

export function deriveGeminiModelsUrl(apiUrl: string | undefined): string {
  const raw = (apiUrl || "https://generativelanguage.googleapis.com")
    .trim()
    .replace(/\/+$/, "");
  const base = raw.replace(/\/v1beta(?:\/.*)?$/i, "");
  return `${base}/v1beta/models`;
}

export async function requestModelListJson(
  url: string,
  headers: Record<string, string>,
  timeout = 30000,
): Promise<unknown> {
  try {
    const response = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...headers,
      },
      responseType: "text",
      timeout,
    });
    const status = response.status ?? 200;
    const rawResponse = response.response || "";
    if (status < 200 || status >= 300) {
      throw new Error(`HTTP ${status}: ${rawResponse || "请求失败"}`);
    }
    return rawResponse ? JSON.parse(rawResponse) : {};
  } catch (error: any) {
    const status = error?.xmlhttp?.status;
    const responseBody =
      error?.xmlhttp?.response || error?.xmlhttp?.responseText || "";
    let errorMessage = error?.message || "获取模型列表失败";

    try {
      if (responseBody) {
        const parsed =
          typeof responseBody === "string"
            ? JSON.parse(responseBody)
            : responseBody;
        const err = parsed?.error || parsed;
        errorMessage = err?.message || err?.error?.message || errorMessage;
      }
    } catch {
      // keep the original error message
    }

    if (status) {
      errorMessage = `HTTP ${status}: ${errorMessage}`;
    }
    throw new Error(errorMessage);
  }
}

export function parseModelListResponse(
  data: unknown,
  options: { stripModelsPrefix?: boolean } = {},
): LLMModelInfo[] {
  const root = data as any;
  const items = Array.isArray(root)
    ? root
    : Array.isArray(root?.data)
      ? root.data
      : Array.isArray(root?.models)
        ? root.models
        : [];

  const seen = new Set<string>();
  const models: LLMModelInfo[] = [];

  for (const item of items) {
    const info = normalizeModelInfo(item, options.stripModelsPrefix ?? false);
    if (!info || seen.has(info.id)) continue;
    seen.add(info.id);
    models.push(info);
  }

  return models.sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeModelInfo(
  item: unknown,
  stripModelsPrefix: boolean,
): LLMModelInfo | null {
  if (typeof item === "string") {
    const id = cleanModelId(item, stripModelsPrefix);
    return id ? { id } : null;
  }

  if (!item || typeof item !== "object") return null;
  const model = item as any;
  const rawId =
    model.id ||
    model.name ||
    model.model ||
    model.slug ||
    model.endpoint_id ||
    model.model_id;
  const id = cleanModelId(String(rawId || ""), stripModelsPrefix);
  if (!id) return null;

  const rawName = model.displayName || model.display_name || model.title;
  const name =
    typeof rawName === "string" && rawName.trim() && rawName.trim() !== id
      ? rawName.trim()
      : undefined;

  return {
    id,
    name,
    description:
      typeof model.description === "string" ? model.description : undefined,
    contextLength: pickNumber(
      model.context_length,
      model.contextLength,
      model.inputTokenLimit,
      model.input_token_limit,
    ),
    ownedBy:
      typeof model.owned_by === "string"
        ? model.owned_by
        : typeof model.ownedBy === "string"
          ? model.ownedBy
          : undefined,
    created: pickNumber(model.created),
  };
}

function cleanModelId(id: string, stripModelsPrefix: boolean): string {
  const cleaned = id.trim();
  if (!cleaned) return "";
  return stripModelsPrefix ? cleaned.replace(/^models\//, "") : cleaned;
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}
