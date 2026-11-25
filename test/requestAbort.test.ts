import { expect } from "chai";
import { raceAbortSignal } from "../src/modules/llmproviders/shared/requestAbort";
import type { LLMAbortSignal } from "../src/modules/llmproviders/types";

// 纯逻辑测试：用最小 signal 桩（structural），不触碰全局 Zotero / addon。
function abortableSignal(): {
  signal: LLMAbortSignal;
  abort: (reason?: unknown) => void;
  listenerCount: () => number;
} {
  const listeners = new Set<() => void>();
  let aborted = false;
  let reason: unknown;
  const signal: LLMAbortSignal = {
    get aborted() {
      return aborted;
    },
    get reason() {
      return reason;
    },
    addEventListener(type, listener) {
      if (type === "abort") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "abort") listeners.delete(listener);
    },
  };
  return {
    signal,
    abort(nextReason?: unknown) {
      if (aborted) return;
      aborted = true;
      reason = nextReason ?? new Error("stopped by user");
      for (const listener of [...listeners]) listener();
      listeners.clear();
    },
    listenerCount: () => listeners.size,
  };
}

const NEVER = Symbol("never-settled");

async function settleOrSentinel(
  promise: Promise<unknown>,
): Promise<unknown | typeof NEVER> {
  return Promise.race([
    promise.catch((error) => error),
    new Promise((resolve) => setTimeout(() => resolve(NEVER), 20)),
  ]);
}

describe("raceAbortSignal", function () {
  it("rejects with LLMRequestAbortError as soon as the signal aborts", async function () {
    const handle = abortableSignal();
    const race = raceAbortSignal(handle.signal);
    expect(handle.listenerCount()).to.equal(1);

    handle.abort();
    const outcome = (await settleOrSentinel(race.promise)) as Error;

    expect(outcome).to.be.instanceOf(Error);
    expect(outcome.name).to.equal("LLMRequestAbortError");
    expect(outcome.message).to.equal("stopped by user");
    race.dispose();
  });

  it("rejects immediately when the signal is already aborted", async function () {
    const handle = abortableSignal();
    handle.abort(new Error("already stopped"));

    const race = raceAbortSignal(handle.signal);
    const outcome = (await settleOrSentinel(race.promise)) as Error;

    expect(outcome.name).to.equal("LLMRequestAbortError");
    expect(outcome.message).to.equal("already stopped");
    race.dispose();
  });

  it("stops listening after dispose, so a later abort cannot settle it", async function () {
    const handle = abortableSignal();
    const race = raceAbortSignal(handle.signal);
    expect(handle.listenerCount()).to.equal(1);

    race.dispose();
    expect(handle.listenerCount()).to.equal(0);

    handle.abort();
    expect(await settleOrSentinel(race.promise)).to.equal(NEVER);
  });

  it("never settles when there is no signal to watch", async function () {
    const race = raceAbortSignal(undefined);
    expect(await settleOrSentinel(race.promise)).to.equal(NEVER);
    expect(() => race.dispose()).to.not.throw();
  });

  it("does not raise unhandled rejections when the race is lost", async function () {
    const handle = abortableSignal();
    const race = raceAbortSignal(handle.signal);

    // 模拟“请求先完成、信号随后 abort”：竞速失败侧不应产生未处理拒绝。
    const winner = await Promise.race([
      Promise.resolve("request-finished"),
      race.promise,
    ]);
    expect(winner).to.equal("request-finished");

    handle.abort();
    await new Promise((resolve) => setTimeout(resolve, 5));
    race.dispose();
  });
});
