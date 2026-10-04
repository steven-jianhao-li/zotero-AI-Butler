import type { AgentEvent, AgentTeamMember } from "../../agent/types";
import { renderAgentMarkdown } from "./AgentMarkdown";
import { documentOf, element, t } from "./dom";

type EventRow = {
  root: HTMLElement;
  label: HTMLElement;
  body: HTMLElement;
  signature: string;
};

/** Incremental rendering preserves expanded tool output and scroll position. */
export class AgentTimeline {
  private rows = new Map<string, EventRow>();

  constructor(private host: HTMLElement) {}

  clear(): void {
    this.rows.clear();
    this.host.replaceChildren();
  }

  render(events: AgentEvent[], team: AgentTeamMember[] = []): void {
    const stickToBottom =
      this.host.scrollHeight - this.host.scrollTop - this.host.clientHeight <
      90;
    const doc = documentOf(this.host);
    for (const event of events) {
      let row = this.rows.get(event.id);
      if (!row) {
        const isTool =
          event.type === "tool-start" || event.type === "tool-result";
        const root = element(
          doc,
          isTool ? "details" : "article",
          `agent-event agent-event--${event.type}`,
        );
        const label = element(
          doc,
          isTool ? "summary" : "div",
          "agent-event-label",
        );
        const body = element(doc, "div", "agent-event-body");
        root.append(label, body);
        row = { root, label, body, signature: "" };
        this.rows.set(event.id, row);
        this.host.append(root);
      }
      const member = event.memberId
        ? team.find((member) => member.id === event.memberId)?.name ||
          event.memberId
        : "";
      const signature = `${event.type}:${event.toolName || ""}:${member}:${event.text}`;
      if (row.signature === signature) continue;
      row.signature = signature;
      row.label.textContent = [
        member ? `${t("agent-team")} / ${member}` : "",
        t(`agent-event-${event.type}`),
        event.toolName,
      ]
        .filter(Boolean)
        .join(" · ");
      // Only assistant prose receives Markdown; user/tool output stays literal.
      if (event.type === "assistant") renderAgentMarkdown(row.body, event.text);
      else row.body.textContent = event.text;
      row.root.setAttribute("data-event-id", event.id);
    }
    if (stickToBottom) this.host.scrollTop = this.host.scrollHeight;
  }
}
