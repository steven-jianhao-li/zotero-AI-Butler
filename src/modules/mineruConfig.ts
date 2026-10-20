import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";

export type MineruApiFormat = "file-parse" | "v1" | "v4";

export interface MineruServiceConfig {
  apiUrl: string;
  apiFormat: MineruApiFormat;
  apiKey: string;
}

export function isCustomMineruServer(): boolean {
  return getPref("mineruServiceMode") === "custom";
}

export function getMineruCustomApiFormat(): MineruApiFormat {
  const value = getPref("mineruCustomApiFormat");
  return value === "v1" || value === "v4" ? value : "file-parse";
}

/** Snapshot the selected server so an in-flight parse keeps using one service. */
export function getMineruServiceConfig(): MineruServiceConfig {
  if (!isCustomMineruServer()) {
    const apiKey = String(getPref("mineruApiKey") || "").trim();
    if (!apiKey) {
      throw new Error(getString("mineru-error-api-key-missing"));
    }
    return { apiUrl: "https://mineru.net/api/v4", apiFormat: "v4", apiKey };
  }

  const rawUrl = String(getPref("mineruCustomApiUrl") || "").trim();
  if (!rawUrl) {
    throw new Error(getString("mineru-error-server-url-missing"));
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    throw new Error(getString("mineru-error-server-url-invalid"), {
      cause: error,
    });
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(getString("mineru-error-server-url-invalid"));
  }

  const apiFormat = getMineruCustomApiFormat();
  let apiUrl = url.href.replace(/\/+$/, "");
  if (apiFormat === "file-parse") {
    apiUrl = apiUrl.replace(/\/file_parse$/, "");
  } else {
    const suffix = apiFormat === "v1" ? "/v1" : "/api/v4";
    if (!apiUrl.endsWith(suffix)) apiUrl += suffix;
  }
  return {
    apiUrl,
    apiFormat,
    apiKey: String(getPref("mineruCustomApiKey") || "").trim(),
  };
}

/** Returned storage URLs may be relative; only same-origin requests get the key. */
export function getMineruRequestHeaders(
  service: MineruServiceConfig,
  requestUrl = service.apiUrl,
): Record<string, string> {
  return service.apiKey &&
    new URL(requestUrl).origin === new URL(service.apiUrl).origin
    ? { Authorization: `Bearer ${service.apiKey}` }
    : {};
}

export function resolveMineruResultUrl(
  service: MineruServiceConfig,
  resultUrl: string,
): string {
  return new URL(resultUrl, `${service.apiUrl}/`).href;
}
