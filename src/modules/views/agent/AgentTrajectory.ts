import type { AgentSession } from "../../agent/types";
import {
  agentTraceRecords,
  agentTraceSegments,
  type AgentTraceRecord,
} from "./trajectory";
import { button, documentOf, element, t } from "./dom";
import { prettyAgentData } from "./transcript";
import { renderAgentMarkdown } from "./AgentMarkdown";

type TraceRow = {
  root: HTMLDetailsElement;
  summary: HTMLElement;
  badge: HTMLElement;
  preview: HTMLElement;
  duration: HTMLElement;
  body: HTMLElement;
  actions: HTMLElement;
  signature: string;
};

/** Searchable, interactive execution ledger independent of conversation folding. */
export class AgentTrajectory {
  private search: HTMLInputElement;
  private ledger: HTMLElement;
  private chart: HTMLElement;
  private empty: HTMLElement;
  private lanes = new Map<string, HTMLElement>();
  private bars = new Map<string, HTMLButtonElement>();
  private rows = new Map<string, TraceRow>();
  private turns = new Map<number, HTMLDetailsElement>();
  private records: AgentTraceRecord[] = [];
  private duration = false;
  private folded = false;
  private expanded = false;
  private selected = "";

  constructor(
    private host: HTMLElement,
    private navigate: (eventId: string) => void,
    private approve: (approvalId: string, allow: boolean) => void,
  ) {
    const doc = documentOf(host);
    const toolbar = element(doc, "div", "agent-trace-toolbar");
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", t("agent-tab-activity"));
    const duration = button(doc, t("agent-trace-duration"), () => {
      this.duration = !this.duration;
      duration.setAttribute("aria-pressed", String(this.duration));
      this.renderChart();
    });
    duration.setAttribute("aria-pressed", "false");
    const turns = button(doc, t("agent-trace-fold-turns"), () => {
      this.folded = !this.folded;
      for (const turn of this.turns.values()) turn.open = !this.folded;
      turns.textContent = t(
        this.folded ? "agent-trace-expand-turns" : "agent-trace-fold-turns",
      );
    });
    const calls = button(doc, t("agent-trace-expand-details"), () => {
      this.expanded = !this.expanded;
      for (const row of this.rows.values()) row.root.open = this.expanded;
      calls.textContent = t(
        this.expanded
          ? "agent-trace-fold-details"
          : "agent-trace-expand-details",
      );
    });
    this.search = element(doc, "input", "agent-trace-search");
    this.search.type = "search";
    this.search.placeholder = t("agent-trace-search");
    this.search.setAttribute("aria-label", t("agent-trace-search"));
    this.search.addEventListener("input", () => this.filter());
    toolbar.append(duration, turns, calls, this.search);
    this.chart = element(doc, "div", "agent-trace-chart");
    this.chart.setAttribute("aria-label", t("agent-trace-overview"));
    for (const kind of ["input", "model", "tool"] as const) {
      const lane = element(doc, "div", "agent-trace-lane");
      const bars = element(doc, "div", "agent-trace-bars");
      lane.append(
        element(
          doc,
          "span",
          "agent-trace-lane-label",
          t(`agent-trace-${kind}`),
        ),
        bars,
      );
      this.lanes.set(kind, bars);
      this.chart.append(lane);
    }
    this.ledger = element(doc, "div", "agent-trace-ledger");
    this.empty = element(
      doc,
      "p",
      "agent-trace-empty",
      t("agent-trace-no-matches"),
    );
    this.empty.hidden = true;
    host.append(toolbar, this.chart, this.empty, this.ledger);
  }

  clear(): void {
    this.rows.clear();
    this.turns.clear();
    this.bars.clear();
    this.records = [];
    this.selected = "";
    this.search.value = "";
    this.ledger.replaceChildren();
    for (const lane of this.lanes.values()) lane.replaceChildren();
  }

  render(session: AgentSession): number {
    const follow =
      this.ledger.scrollHeight -
        this.ledger.scrollTop -
        this.ledger.clientHeight <
      80;
    this.records = agentTraceRecords(session);
    const doc = documentOf(this.host);
    for (const record of this.records) {
      let turn = this.turns.get(record.turn);
      if (!turn) {
        turn = element(doc, "details", "agent-trace-turn");
        turn.open = !this.folded;
        turn.append(
          element(
            doc,
            "summary",
            "agent-trace-turn-title",
            t("agent-trace-turn", { count: record.turn }),
          ),
        );
        this.turns.set(record.turn, turn);
        this.ledger.append(turn);
      }
      let row = this.rows.get(record.id);
      if (!row) {
        const root = element(doc, "details", "agent-trace-row");
        root.open = this.expanded;
        root.dataset.eventId = record.id;
        const summary = element(doc, "summary", "agent-trace-summary");
        const badge = element(doc, "span", "agent-trace-badge");
        const preview = element(doc, "span", "agent-trace-preview");
        const duration = element(doc, "span", "agent-trace-time");
        summary.append(badge, preview, duration);
        const body = element(doc, "div", "agent-trace-detail");
        const actions = element(doc, "div", "agent-trace-actions");
        actions.append(
          button(doc, t("agent-trace-conversation"), () =>
            this.navigate(record.id),
          ),
        );
        root.append(summary, body, actions);
        summary.addEventListener("click", () => this.select(record.id, false));
        row = {
          root,
          summary,
          badge,
          preview,
          duration,
          body,
          actions,
          signature: "",
        };
        this.rows.set(record.id, row);
        turn.append(root);
      }
      row.root.dataset.kind = record.kind;
      row.root.dataset.streamState = record.event.streamState || "";
      row.badge.textContent = t(`agent-trace-${record.kind}`);
      const outputs = record.events.filter(
        (event) => event.type === "assistant" || event.type === "reasoning",
      );
      row.preview.textContent = [
        record.event.memberId
          ? session.team.find((member) => member.id === record.event.memberId)
              ?.name
          : "",
        record.event.toolName,
        outputs.length
          ? outputs.map((event) => event.text).join(" · ")
          : record.event.text,
        record.resultText ? `→ ${record.resultText}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
        .replace(/\s+/g, " ")
        .slice(0, 600);
      const end =
        record.endedAt ??
        (record.event.streamState === "streaming" ? Date.now() : undefined);
      row.duration.textContent =
        end !== undefined
          ? `${Math.max(0, (end - record.startedAt) / 1000).toFixed(1)}s`
          : "";
      row.duration.title = new Date(record.startedAt).toLocaleString();
      const pending = session.pendingApprovals.find(
        (approval) =>
          record.event.type === "approval" &&
          approval.id ===
            (record.event.data as { id?: string } | undefined)?.id,
      );
      const signature = JSON.stringify([
        record.events,
        record.resultText,
        pending?.id,
      ]);
      if (row.signature !== signature) {
        row.signature = signature;
        row.body.replaceChildren();
        for (const event of record.events) {
          const section = element(doc, "section", "agent-trace-section");
          section.append(
            element(
              doc,
              "strong",
              "",
              [
                t(`agent-event-${event.type}`),
                event.streamState === "interrupted"
                  ? t("agent-stream-interrupted")
                  : "",
              ]
                .filter(Boolean)
                .join(" · "),
            ),
          );
          const content = element(doc, "div", "agent-trace-text");
          if (
            ["assistant", "reasoning"].includes(event.type) &&
            event.streamState !== "streaming"
          )
            renderAgentMarkdown(content, event.text);
          else
            content.textContent =
              event === record.result
                ? prettyAgentData(record.resultText || event.text)
                : prettyAgentData(event.text);
          section.append(content);
          row.body.append(section);
        }
        row.actions
          .querySelectorAll(".agent-trace-approval")
          .forEach((node: Element) => node.remove());
        if (pending) {
          row.root.open = true;
          row.body.append(
            element(
              doc,
              "pre",
              "agent-trace-text",
              JSON.stringify(pending.arguments, null, 2),
            ),
          );
          for (const allow of [false, true])
            row.actions.append(
              button(
                doc,
                t(allow ? "agent-approve" : "agent-reject"),
                () => {
                  row!.actions
                    .querySelectorAll<HTMLButtonElement>(
                      ".agent-trace-approval",
                    )
                    .forEach((button: HTMLButtonElement) => {
                      button.disabled = true;
                    });
                  this.approve(pending.id, allow);
                },
                "agent-button agent-trace-approval",
              ),
            );
        }
      }
    }
    this.renderChart();
    this.filter();
    if (follow && !this.search.value)
      this.ledger.scrollTop = this.ledger.scrollHeight;
    return this.records.length;
  }

  private select(id: string, reveal: boolean): void {
    this.selected = id;
    for (const [key, row] of this.rows)
      row.root.classList.toggle("is-selected", key === id);
    for (const [key, bar] of this.bars)
      bar.setAttribute("aria-pressed", String(key === id));
    const row = this.rows.get(id);
    if (!reveal || !row) return;
    if (row.root.hidden) {
      this.search.value = "";
      this.filter();
    }
    const record = this.records.find((record) => record.id === id);
    if (record) this.turns.get(record.turn)!.open = true;
    row.root.open = true;
    row.summary.scrollIntoView({ block: "center" });
    row.summary.focus();
  }

  private renderChart(): void {
    const doc = documentOf(this.host);
    const records = this.records.filter((record) => record.kind !== "status");
    for (const segment of agentTraceSegments(
      records,
      this.duration,
      Date.now(),
    )) {
      const record = segment.record;
      let bar = this.bars.get(record.id);
      if (!bar) {
        bar = button(
          doc,
          "",
          () => this.select(record.id, true),
          "agent-trace-bar",
        );
        this.bars.set(record.id, bar);
        this.lanes.get(record.kind)!.append(bar);
      }
      bar.dataset.kind = record.kind;
      bar.style.left = `${segment.left}%`;
      bar.style.width = `${segment.width}%`;
      bar.title = `${t(`agent-trace-${record.kind}`)} · ${record.event.toolName || record.event.text.slice(0, 120)}`;
      bar.setAttribute("aria-label", bar.title);
      bar.setAttribute("aria-pressed", String(record.id === this.selected));
    }
  }

  private filter(): void {
    const query = this.search.value.trim().toLocaleLowerCase();
    const visibleTurns = new Set<number>();
    for (const record of this.records) {
      const match = !query || record.searchText.includes(query);
      this.rows.get(record.id)!.root.hidden = !match;
      this.bars.get(record.id)?.classList.toggle("is-dimmed", !match);
      if (match) visibleTurns.add(record.turn);
    }
    for (const [id, turn] of this.turns) {
      turn.hidden = !visibleTurns.has(id);
      if (query && !turn.hidden) turn.open = true;
    }
    this.empty.hidden = visibleTurns.size > 0;
  }
}
