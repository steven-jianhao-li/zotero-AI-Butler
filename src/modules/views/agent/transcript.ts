import type { AgentEvent, AgentSession, AgentStatus } from "../../agent/types";

export interface AgentTurnView {
  id: string;
  user?: AgentEvent;
  work: AgentEvent[];
  delivery?: AgentEvent;
  errors: AgentEvent[];
  status: AgentStatus;
  elapsed: number;
  toolCount: number;
}

/** Derive turn presentation from the durable ledger, including older sessions. */
export function agentTurns(
  session: Pick<AgentSession, "events" | "status">,
): AgentTurnView[] {
  const groups: { id: string; user?: AgentEvent; events: AgentEvent[] }[] = [];
  for (const event of session.events) {
    if (event.type === "user" || !groups.length)
      groups.push({
        id: event.id,
        user: event.type === "user" ? event : undefined,
        events: [],
      });
    if (event.type !== "user") groups[groups.length - 1].events.push(event);
  }
  return groups.map((group, index) => {
    const last = group.events[group.events.length - 1];
    const end = group.events.find((event) => event.runStatus);
    const errors = group.events.filter((event) => event.type === "error");
    const candidates = group.events.filter(
      (event) => event.type === "assistant" && !event.memberId,
    );
    const candidate = candidates[candidates.length - 1];
    // Old ledgers had no phase. Only infer a final answer after all tool work.
    const legacyDelivery =
      candidate &&
      !candidate.phase &&
      group.events
        .slice(group.events.indexOf(candidate) + 1)
        .every((event) => event.type === "status");
    const status =
      index === groups.length - 1
        ? session.status
        : end?.runStatus ||
          (errors.length
            ? "error"
            : candidate?.phase === "delivery" || legacyDelivery
              ? "completed"
              : "cancelled");
    const running = status === "running" || status === "waiting-approval";
    const delivery =
      candidate?.phase === "delivery" ||
      (!running && status === "completed" && legacyDelivery)
        ? candidate
        : undefined;
    const started = group.user?.createdAt ?? group.events[0]?.createdAt ?? 0;
    return {
      id: group.id,
      user: group.user,
      work: group.events.filter(
        (event) =>
          event !== delivery && event.type !== "error" && !event.runStatus,
      ),
      delivery,
      errors,
      status,
      elapsed: Math.max(
        0,
        (end?.createdAt ?? last?.createdAt ?? started) - started,
      ),
      toolCount: group.events.filter((event) => event.type === "tool-start")
        .length,
    };
  });
}

export function prettyAgentData(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // Tool diagnostics and reasoning can be plain text.
    return text;
  }
}
