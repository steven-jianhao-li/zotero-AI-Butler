import { getString } from "../../../utils/locale";

const FALLBACK_MESSAGES = {
  "invalid-object": "Agent API returned an invalid object.",
  "invalid-string": "Agent API returned an invalid string.",
  "invalid-arguments": "Agent tool arguments must be a complete JSON object.",
  "orphan-result": "Agent history contains an orphan or duplicate tool result.",
  "unresolved-calls": "Agent history has unresolved tool calls.",
  "invalid-history-ids":
    "Agent history contains invalid or duplicate tool IDs.",
  "invalid-call": "Agent returned an unknown tool or invalid tool call ID.",
  "empty-turn": "Agent API returned an empty turn.",
  "invalid-url": "Agent API URL must use HTTP or HTTPS.",
  "missing-call": "Agent history is missing a tool call.",
  "missing-endpoint": "Agent requires an API URL and model.",
  "missing-key": "Agent requires an API key for this provider.",
  "unsupported-provider":
    "This provider does not support native Agent tool calls.",
  "context-overflow": "Agent context window limit exceeded.",
  "api-error": "Agent API reported an error.",
  "invalid-choice-count": "Agent API must return exactly one choice.",
  "truncated-turn": "Agent API returned a truncated or blocked turn.",
  "invalid-role": "Agent API returned a non-assistant message.",
  "malformed-calls": "Agent API returned malformed tool calls.",
  "missing-declared-calls": "Agent API omitted its declared tool calls.",
  "unsupported-tool-type": "Agent API returned an unsupported tool type.",
  "missing-content": "Agent API returned no content.",
  "invalid-candidate-count": "Agent API returned no unique candidate.",
  "missing-parts": "Agent API returned no content parts.",
  "invalid-json": "Agent API returned invalid JSON.",
  "request-failed":
    "Agent API request failed. Check the endpoint and connection.",
  "responses-incomplete":
    "Agent Responses API returned an incomplete or failed turn.",
  "responses-missing-output": "Agent Responses API returned no output array.",
  "responses-invalid-item": "Invalid Agent response item.",
  "responses-unfinished-item":
    "Agent Responses API returned an unfinished output item.",
  "responses-malformed-call":
    "Agent Responses API returned a malformed tool call.",
  "http-error": "Agent API HTTP { $status }.",
};

export type AgentProtocolErrorCode = keyof typeof FALLBACK_MESSAGES;

/** Safe, localized errors with stable categories independent of UI language. */
export class AgentProtocolError extends Error {
  constructor(
    public readonly code: AgentProtocolErrorCode,
    args: Record<string, unknown> = {},
  ) {
    const key = `agent-protocol-${code}`;
    const localized =
      typeof addon === "undefined" ? key : getString(key, { args });
    const fallback = FALLBACK_MESSAGES[code].replace(
      /\{\s*\$([\w]+)\s*\}/g,
      (_match, name: string) => String(args[name] ?? ""),
    );
    super(localized === key ? fallback : localized);
    this.name = "AgentProtocolError";
  }
}
