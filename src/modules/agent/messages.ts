import { getString } from "../../utils/locale";

// English fallbacks are used only before locale initialization (including Node tests).
const defaults = {
  "agent-runtime-result-limit":
    "Tool result exceeded the evidence storage limit.",
  "agent-runtime-session-limit":
    "Session evidence limit reached. Start a new session.",
  "agent-runtime-no-answer": "The agent returned no final answer.",
  "agent-runtime-context-small":
    "Context budget is too small for the current request. Increase it or start a new session with a shorter request.",
  "agent-runtime-summary-incomplete":
    "Context summary was incomplete; original history was retained.",
  "agent-runtime-summary-not-smaller":
    "Context summary did not reduce the request; original history was retained.",
  "agent-runtime-empty-answer": "Model returned an empty final answer.",
  "agent-runtime-calls-exhausted": "Shared team tool-call budget exhausted.",
  "agent-runtime-tool-unavailable":
    "Tool is unavailable under the current permissions.",
  "agent-runtime-repeat-blocked":
    "Repeated identical tool call blocked. Use existing evidence or change your research strategy.",
  "agent-runtime-unknown-evidence": "Unknown evidence reference.",
  "agent-runtime-no-nested-team": "Teammates cannot create more teammates.",
  "agent-runtime-write-completed":
    "This identical write already succeeded. Read the current state before requesting another change.",
  "agent-runtime-write-declined-before":
    "The user already declined this change during this run.",
  "agent-runtime-write-declined":
    "User declined this library change. Do not retry it unless explicitly requested.",
  "agent-runtime-write-storage-limit":
    "Evidence storage is nearly full. Start a new session before modifying the library.",
  "agent-runtime-team-limit": "Team budget: at most six teammates per run.",
  "agent-runtime-delete-running":
    "Stop the running session before deleting it.",
  "agent-runtime-missing-session": "Agent session not found.",
  "agent-runtime-already-running": "This session is already running.",
  "agent-runtime-prompt-length":
    "Enter a research question of at most 60,000 characters.",
  "agent-runtime-session-concurrency":
    "At most three research sessions can run at once.",
  "agent-runtime-invalid-permission": "Invalid Agent permission.",
  "agent-runtime-invalid-policy": "Invalid PDF policy.",
  "agent-runtime-invalid-library": "Select an accessible Zotero library.",
  "agent-runtime-invalid-selection": "Select at most 100 valid library items.",
  "agent-runtime-library-change":
    "Start a new session to research a different library.",
  "agent-runtime-invalid-session-id": "Invalid Agent session ID",
  "agent-runtime-invalid-session-format": "Unsupported Agent session format",
  "agent-runtime-readonly":
    "Read-only authority: library modification is not permitted.",
  "agent-runtime-step": "Research step {step}/{total}",
  "agent-runtime-pruned":
    "Older tool output compacted; full evidence remains available through read_result.",
  "agent-runtime-compacted":
    "Conversation summarized; recent tool calls, research plan and evidence references retained.",
  "agent-runtime-cancelled": "Research cancelled by the user.",
  "agent-runtime-approved": "Approved: {tool}",
  "agent-runtime-declined": "Declined: {tool}",
  "agent-runtime-approval": "Review the proposed library change: {tool}",
  "agent-runtime-step-limit":
    "Agent reached its {count}-step budget. Evidence and progress have been saved; send a follow-up to continue.",
} as const;

export function agentText(
  key: keyof typeof defaults,
  args: Record<string, string | number> = {},
): string {
  const localized =
    typeof addon === "undefined" ? key : getString(key, { args });
  if (localized !== key) return localized;
  return defaults[key].replace(/\{(\w+)\}/g, (_match, name: string) =>
    String(args[name] ?? name),
  );
}
