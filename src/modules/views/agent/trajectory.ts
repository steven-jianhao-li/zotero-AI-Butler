import type { AgentEvent, AgentSession } from "../../agent/types";

export interface AgentTraceRecord {
  id: string;
  turn: number;
  kind: "input" | "model" | "tool" | "status";
  event: AgentEvent;
  events: AgentEvent[];
  result?: AgentEvent;
  resultText?: string;
  startedAt: number;
  endedAt?: number;
  searchText: string;
}

/** Project the persisted event ledger without exposing provider replay state. */
export function agentTraceRecords(session: AgentSession): AgentTraceRecord[] {
  const requests = new Map<string, AgentTraceRecord>();
  const tools = new Map<string, AgentTraceRecord>();
  const records: AgentTraceRecord[] = [];
  let turn = 0;
  for (const event of session.events) {
    if (event.type === "user") turn++;
    const toolKey = `${turn}:${event.memberId || ""}:${event.toolCallId}`;
    const request = event.stepId ? requests.get(event.stepId) : undefined;
    if (request && ["assistant", "reasoning"].includes(event.type)) {
      request.events.push(event);
      continue;
    }
    if (
      event.type === "tool-result" &&
      event.toolCallId &&
      tools.has(toolKey)
    ) {
      const record = tools.get(toolKey)!;
      record.result = event;
      record.endedAt = event.createdAt;
      record.events.push(event);
      continue;
    }
    const data =
      event.data && typeof event.data === "object"
        ? (event.data as { kind?: string })
        : {};
    const kind =
      event.type === "user"
        ? "input"
        : data.kind === "model-request" ||
            ["assistant", "reasoning"].includes(event.type)
          ? "model"
          : event.type.startsWith("tool-")
            ? "tool"
            : "status";
    const record: AgentTraceRecord = {
      id: event.id,
      turn: Math.max(1, turn),
      kind,
      event,
      events: [event],
      startedAt: event.createdAt,
      endedAt: event.endedAt,
      searchText: "",
    };
    records.push(record);
    if (data.kind === "model-request" && event.stepId)
      requests.set(event.stepId, record);
    if (event.type === "tool-start" && event.toolCallId)
      tools.set(toolKey, record);
  }
  for (const record of records) {
    if (record.result) {
      record.resultText = record.result.text;
      try {
        const data = JSON.parse(record.result.text) as { resultRef?: string };
        if (data.resultRef && session.artifacts[data.resultRef])
          record.resultText = session.artifacts[data.resultRef];
      } catch {
        /* Preserve plain-text diagnostics from older sessions. */
      }
    }
    record.searchText = [
      record.event.toolName,
      record.event.memberId,
      ...record.events.map((event) => event.text),
      record.resultText,
    ]
      .filter(Boolean)
      .join("\n")
      .toLocaleLowerCase();
  }
  return records;
}

/** Equal-width operations or a duration-weighted overview, with tiny events kept clickable. */
export function agentTraceSegments(
  records: AgentTraceRecord[],
  duration: boolean,
  now: number,
): { record: AgentTraceRecord; left: number; width: number }[] {
  const weights = records.map((record) =>
    duration
      ? Math.max(
          100,
          (record.endedAt ??
            (record.event.streamState === "streaming"
              ? now
              : record.startedAt)) - record.startedAt,
        )
      : 1,
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  let offset = 0;
  return records.map((record, index) => {
    const segment = {
      record,
      left: (offset / total) * 100,
      width: (weights[index] / total) * 100,
    };
    offset += weights[index];
    return segment;
  });
}
