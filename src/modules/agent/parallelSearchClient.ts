import { version } from "../../../package.json";
import type { LLMAbortSignal } from "../llmproviders/types";
import {
  bindAbortSignal,
  throwIfAborted,
} from "../llmproviders/shared/requestAbort";
import { agentText } from "./messages";

const ENDPOINT = "https://search.parallel.ai/mcp";
const PROTOCOL = "2025-03-26";
const SUPPORTED_PROTOCOLS = [
  "2024-11-05",
  PROTOCOL,
  "2025-06-18",
  "2025-11-25",
];

type Json = Record<string, unknown>;

function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(agentText("agent-web-invalid-response"));
  return value as Json;
}

/** Bounded Streamable HTTP requests over the plugin's native Zotero transport.
 * Connection state is local to a call; conversation identity is supplied separately.
 */
export class ParallelSearchClient {
  async call(
    name: "web_search" | "web_fetch",
    args: Json,
    signal: LLMAbortSignal,
  ): Promise<unknown> {
    throwIfAborted(signal);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "User-Agent": "zotero-ai-butler/5.1.1",
    };
    let sequence = 0;
    const request = async (
      method: string,
      params?: Json,
      notification = false,
    ): Promise<Json> => {
      throwIfAborted(signal);
      const id = ++sequence;
      let unbind: (() => void) | undefined;
      let aborted: Error | undefined;
      try {
        const response = await Zotero.HTTP.request("POST", ENDPOINT, {
          headers: { ...headers },
          body: JSON.stringify({
            jsonrpc: "2.0",
            ...(!notification ? { id } : {}),
            method,
            ...(params ? { params } : {}),
          }),
          responseType: "text",
          timeout: 60000,
          errorDelayMax: 0,
          requestObserver: (xhr: XMLHttpRequest) => {
            unbind = bindAbortSignal(signal, xhr, (error) => {
              aborted = error;
            });
          },
        });
        if (aborted) throw aborted;
        throwIfAborted(signal);
        const connection = response.getResponseHeader("Mcp-Session-Id");
        if (connection) headers["Mcp-Session-Id"] = connection;
        if (notification) return {};
        const raw = response.responseText || "";
        if (raw.length > 2_000_000)
          throw new Error(agentText("agent-web-invalid-response"));
        const envelopes: unknown[] = raw.trimStart().startsWith("{")
          ? [JSON.parse(raw)]
          : raw
              .replace(/\r\n/g, "\n")
              .split("\n\n")
              .map((event) =>
                event
                  .split("\n")
                  .filter((line) => line.startsWith("data:"))
                  .map((line) => line.slice(5).trimStart())
                  .join("\n"),
              )
              .filter(Boolean)
              .map((data) => JSON.parse(data));
        const message = envelopes.map(object).find((entry) => entry.id === id);
        if (!message || message.jsonrpc !== "2.0")
          throw new Error(agentText("agent-web-invalid-response"));
        if (message.error)
          throw new Error(agentText("agent-web-service-error"));
        return object(message.result);
      } catch (error) {
        if (aborted) throw aborted;
        throwIfAborted(signal);
        const failure = error as { status?: number; name?: string };
        if (failure.status === 429)
          throw new Error(agentText("agent-web-rate-limit"), { cause: error });
        if (/timeout/i.test(failure.name || ""))
          throw new Error(agentText("agent-web-timeout"), { cause: error });
        throw error;
      } finally {
        unbind?.();
      }
    };
    const initialized = await request("initialize", {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: "zotero-ai-butler", version },
    });
    if (!SUPPORTED_PROTOCOLS.includes(String(initialized.protocolVersion)))
      throw new Error(agentText("agent-web-invalid-response"));
    headers["MCP-Protocol-Version"] = String(initialized.protocolVersion);
    await request("notifications/initialized", undefined, true);
    const catalog = await request("tools/list");
    if (
      !Array.isArray(catalog.tools) ||
      !catalog.tools.some((tool) => object(tool).name === name)
    )
      throw new Error(agentText("agent-web-tool-unavailable"));
    const result = await request("tools/call", { name, arguments: args });
    if (result.isError) throw new Error(agentText("agent-web-service-error"));
    if (!Array.isArray(result.content))
      throw new Error(agentText("agent-web-invalid-response"));
    const text = result.content
      .map(object)
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("\n\n");
    if (!text.trim()) throw new Error(agentText("agent-web-invalid-response"));
    return { provider: "Parallel Search MCP", content: text };
  }
}
