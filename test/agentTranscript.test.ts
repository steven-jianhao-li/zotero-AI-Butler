import { expect } from "chai";
import { agentTurns } from "../src/modules/views/agent/transcript";
import type { AgentEvent, AgentStatus } from "../src/modules/agent/types";

function event(
  id: string,
  type: AgentEvent["type"],
  extra: Partial<AgentEvent> = {},
): AgentEvent {
  return { id, type, text: id, createdAt: 1000, ...extra };
}
function project(events: AgentEvent[], status: AgentStatus = "completed") {
  return agentTurns({ events, status });
}

describe("Agent work and delivery projection", function () {
  it("separates reasoning, intermediate replies, teammates and tools from the final delivery", function () {
    const [turn] = project([
      event("user", "user"),
      event("think", "reasoning"),
      event("progress", "assistant", { phase: "work" }),
      event("start", "tool-start"),
      event("child", "assistant", { memberId: "reader", phase: "work" }),
      event("result", "tool-result"),
      event("final", "assistant", { phase: "delivery" }),
      event("end", "status", { runStatus: "completed", createdAt: 66000 }),
    ]);
    expect(turn.delivery?.id).to.equal("final");
    expect(turn.work.map((entry) => entry.id)).to.deep.equal([
      "think",
      "progress",
      "start",
      "child",
      "result",
    ]);
    expect(turn.toolCount).to.equal(1);
    expect(turn.elapsed).to.equal(65000);
  });

  it("retains each round's outcome when a new run starts", function () {
    const turns = project(
      [
        event("u1", "user"),
        event("error", "error"),
        event("e1", "status", { runStatus: "error" }),
        event("u2", "user"),
        event("a2", "assistant", { phase: "delivery" }),
        event("e2", "status", { runStatus: "completed" }),
        event("u3", "user"),
        event("s3", "status"),
      ],
      "running",
    );
    expect(turns.map((turn) => turn.status)).to.deep.equal([
      "error",
      "completed",
      "running",
    ]);
    expect(turns[0].errors[0].id).to.equal("error");
    expect(turns[2].delivery).to.equal(undefined);
    expect(
      project([event("end", "status", { runStatus: "completed" })], "error")[0]
        .status,
    ).to.equal("error");
  });

  it("recovers old completed answers but never promotes interrupted work or team reports", function () {
    const old = [
      event("u", "user"),
      event("progress", "assistant"),
      event("tool", "tool-start"),
      event("result", "tool-result"),
    ];
    expect(
      project([...old, event("answer", "assistant")])[0].delivery?.id,
    ).to.equal("answer");
    expect(project(old, "cancelled")[0].delivery).to.equal(undefined);
    expect(
      project([...old, event("team", "assistant", { memberId: "reader" })])[0]
        .delivery,
    ).to.equal(undefined);
    expect(
      project([
        event("u", "user"),
        event("progress", "assistant", { phase: "work" }),
      ])[0].delivery,
    ).to.equal(undefined);
    expect(
      project(
        [event("u", "user"), event("progress", "assistant")],
        "running",
      )[0].delivery,
    ).to.equal(undefined);
  });
});
