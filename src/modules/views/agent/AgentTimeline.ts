import type { AgentEvent, AgentSession } from "../../agent/types";
import { renderAgentMarkdown } from "./AgentMarkdown";
import { agentTurns, prettyAgentData, type AgentTurnView } from "./transcript";
import { button, documentOf, element, t } from "./dom";

type EventRow = {
  root: HTMLElement;
  label: HTMLElement;
  body: HTMLElement;
  signature: string;
};
type TurnRow = {
  root: HTMLElement;
  user: HTMLElement;
  work: HTMLDetailsElement;
  summary: HTMLElement;
  process: HTMLElement;
  reasoningHint: HTMLElement;
  approvals: HTMLElement;
  delivery: HTMLElement;
  errors: HTMLElement;
  status: string;
};

/** A turn's working record is expandable; its final delivery stays outside it. */
export class AgentTimeline {
  private rows = new Map<string, EventRow>();
  private turns = new Map<string, TurnRow>();
  private approvalRows = new Map<string, HTMLElement>();

  constructor(private host: HTMLElement) {}

  clear(): void {
    this.rows.clear();
    this.turns.clear();
    this.approvalRows.clear();
    this.host.replaceChildren();
  }

  focusEvent(id: string): void {
    const row = this.rows.get(id);
    if (!row) return;
    let parent: Element | null = row.root;
    while (parent && parent !== this.host) {
      if (parent.localName === "details")
        (parent as HTMLDetailsElement).open = true;
      parent = parent.parentElement;
    }
    row.root.tabIndex = -1;
    row.root.scrollIntoView({ block: "center" });
    row.root.focus({ preventScroll: true });
  }

  render(
    session: AgentSession,
    approve: (id: string, allow: boolean) => void,
  ): void {
    const stickToBottom =
      this.host.scrollHeight - this.host.scrollTop - this.host.clientHeight <
      90;
    const turns = agentTurns(session);
    for (const turn of turns) {
      const row = this.turnRow(turn);
      if (turn.user) this.place(this.eventRow(turn.user, session), row.user);
      const toolResults = new Map(
        turn.work
          .filter((event) => event.type === "tool-result" && event.toolCallId)
          .map((event) => [
            `${event.memberId || ""}:${event.toolCallId}`,
            event,
          ]),
      );
      const toolStarts = new Set(
        turn.work
          .filter((event) => event.type === "tool-start" && event.toolCallId)
          .map((event) => `${event.memberId || ""}:${event.toolCallId}`),
      );
      for (const event of turn.work) {
        const key = `${event.memberId || ""}:${event.toolCallId}`;
        if (
          event.type === "tool-result" &&
          event.toolCallId &&
          toolStarts.has(key)
        )
          continue;
        const result =
          event.type === "tool-start" && event.toolCallId
            ? toolResults.get(key)
            : undefined;
        this.place(
          this.eventRow(event, session, result, turn.status),
          row.process,
        );
      }
      if (turn.delivery)
        this.place(this.eventRow(turn.delivery, session), row.delivery);
      for (const error of turn.errors)
        this.place(this.eventRow(error, session), row.errors);
    }
    const latest = turns[turns.length - 1];
    const approvalHost = latest
      ? this.turns.get(latest.id)?.approvals
      : undefined;
    const pending = new Set(
      session.pendingApprovals.map((approval) => approval.id),
    );
    for (const [id, card] of this.approvalRows) {
      if (!pending.has(id)) {
        card.remove();
        this.approvalRows.delete(id);
      }
    }
    if (approvalHost) {
      const doc = documentOf(this.host);
      for (const approval of session.pendingApprovals) {
        if (this.approvalRows.has(approval.id)) continue;
        const card = element(doc, "section", "agent-approval-card");
        card.setAttribute("role", "region");
        card.setAttribute("aria-label", t("agent-approval-title"));
        card.append(
          element(doc, "strong", "", t("agent-approval-title")),
          element(doc, "p", "", approval.description),
        );
        const details = element(doc, "details", "agent-approval-details");
        details.open = true;
        details.append(
          element(doc, "summary", "", approval.toolName),
          element(doc, "pre", "", JSON.stringify(approval.arguments, null, 2)),
        );
        const actions = element(doc, "div", "agent-approval-actions");
        for (const allow of [false, true])
          actions.append(
            button(
              doc,
              t(allow ? "agent-approve" : "agent-reject"),
              () => {
                actions
                  .querySelectorAll("button")
                  .forEach((node: HTMLButtonElement) => {
                    node.disabled = true;
                  });
                approve(approval.id, allow);
              },
              `agent-button${allow ? " agent-primary" : ""}`,
            ),
          );
        card.append(details, actions);
        approvalHost.append(card);
        this.approvalRows.set(approval.id, card);
      }
    }
    if (stickToBottom) this.host.scrollTop = this.host.scrollHeight;
  }

  private place(node: HTMLElement, parent: HTMLElement): void {
    // Moving existing nodes on every refresh disrupts focus, selection and scroll.
    if (node.parentElement !== parent) parent.append(node);
  }

  private turnRow(turn: AgentTurnView): TurnRow {
    let row = this.turns.get(turn.id);
    const running =
      turn.status === "running" || turn.status === "waiting-approval";
    if (!row) {
      const doc = documentOf(this.host);
      const root = element(doc, "section", "agent-turn");
      root.dataset.turnId = turn.id;
      const user = element(doc, "div", "agent-turn-user");
      const work = element(doc, "details", "agent-work");
      const summary = element(doc, "summary", "agent-work-summary");
      const process = element(doc, "div", "agent-work-content");
      const reasoningHint = element(
        doc,
        "p",
        "agent-reasoning-hint",
        t("agent-work-no-reasoning"),
      );
      process.append(reasoningHint);
      const approvals = element(doc, "div", "agent-turn-approvals");
      const delivery = element(doc, "div", "agent-delivery");
      const errors = element(doc, "div", "agent-turn-errors");
      work.append(summary, process);
      root.append(user, work, approvals, delivery, errors);
      row = {
        root,
        user,
        work,
        summary,
        process,
        reasoningHint,
        approvals,
        delivery,
        errors,
        status: "",
      };
      this.turns.set(turn.id, row);
      this.host.append(root);
    }
    const wasRunning =
      row.status === "running" || row.status === "waiting-approval";
    if (
      !row.status ||
      (row.status !== turn.status && !(running && wasRunning))
    ) {
      // Default to the delivery when work finishes; later refreshes preserve the reader's choice.
      row.work.open = turn.status !== "completed" || !turn.delivery;
    }
    row.status = turn.status;
    row.reasoningHint.hidden =
      running || turn.work.some((event) => event.type === "reasoning");
    row.work.hidden = !turn.work.length && !running;
    row.work.dataset.status = turn.status;
    const seconds = Math.floor(turn.elapsed / 1000);
    const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    row.summary.textContent = [
      t("agent-work-process"),
      t(`agent-status-${turn.status}`),
      !running ? duration : "",
      turn.toolCount ? t("agent-work-tools", { count: turn.toolCount }) : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return row;
  }

  private eventRow(
    event: AgentEvent,
    session: AgentSession,
    result?: AgentEvent,
    status?: string,
  ): HTMLElement {
    let row = this.rows.get(event.id);
    const doc = documentOf(this.host);
    if (!row) {
      const disclosure = [
        "tool-start",
        "tool-result",
        "reasoning",
        "approval",
      ].includes(event.type);
      const root = element(
        doc,
        disclosure ? "details" : "article",
        `agent-event agent-event--${event.type}`,
      );
      const label = element(
        doc,
        disclosure ? "summary" : "div",
        "agent-event-label",
      );
      const body = element(doc, "div", "agent-event-body");
      root.append(label, body);
      root.dataset.eventId = event.id;
      row = { root, label, body, signature: "" };
      this.rows.set(event.id, row);
    }
    const member = event.memberId
      ? session.team.find((member) => member.id === event.memberId)?.name ||
        event.memberId
      : "";
    const signature = JSON.stringify([
      event.text,
      event.data,
      event.phase,
      event.streamState,
      member,
      result?.text,
      event.type === "tool-start" && !result ? status : undefined,
    ]);
    if (row.signature === signature) return row.root;
    row.signature = signature;
    let state =
      event.streamState === "streaming"
        ? t("agent-stream-live")
        : event.streamState === "interrupted"
          ? t("agent-stream-interrupted")
          : "";
    row.root.dataset.streamState = event.streamState || "";
    if (event.type === "tool-start") {
      let failed = false;
      if (result) {
        try {
          failed = Boolean(JSON.parse(result.text)?.result?.error);
        } catch {
          /* Older tool diagnostics may be plain text. */
        }
      }
      state = result
        ? t(failed ? "agent-work-tool-failed" : "agent-work-tool-done")
        : t(
            status === "running" || status === "waiting-approval"
              ? "agent-work-tool-running"
              : "agent-work-tool-interrupted",
          );
      row.root.dataset.state = result
        ? failed
          ? "error"
          : "completed"
        : "pending";
    }
    row.label.textContent = [
      member,
      t(
        event.type === "assistant" && event.phase === "work"
          ? "agent-work-output"
          : `agent-event-${event.type}`,
      ),
      event.toolName,
      state,
      event.type === "reasoning"
        ? event.text.split(/\r?\n/)[0].replace(/\*\*/g, "").slice(0, 100)
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
    if (
      event.streamState === "streaming" &&
      (event.type === "assistant" || event.type === "reasoning")
    ) {
      row.body.classList.remove("agent-markdown");
      row.body.textContent = event.text;
    } else if (event.type === "assistant" || event.type === "reasoning")
      renderAgentMarkdown(row.body, event.text);
    else if (event.type === "tool-start") {
      row.body.replaceChildren(
        element(doc, "strong", "", t("agent-work-arguments")),
        element(doc, "pre", "", prettyAgentData(event.text)),
      );
      if (result) {
        let text = result.text;
        try {
          const envelope = JSON.parse(text);
          if (
            typeof envelope.resultRef === "string" &&
            session.artifacts[envelope.resultRef]
          )
            text = session.artifacts[envelope.resultRef];
        } catch {
          /* Preserve plain-text diagnostics from older sessions. */
        }
        row.body.append(
          element(doc, "strong", "", t("agent-event-tool-result")),
          element(doc, "pre", "", prettyAgentData(text)),
        );
      }
    } else if (event.type === "approval") {
      row.body.textContent = `${event.text}\n${JSON.stringify(event.data, null, 2) || ""}`;
    } else row.body.textContent = event.text;
    return row.root;
  }
}
