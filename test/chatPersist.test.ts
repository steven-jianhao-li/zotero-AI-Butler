import { expect } from "chai";
import {
  createChatAbortController,
  isChatAbortError,
} from "../src/modules/chatContext";
import {
  ChatPersist,
  type ChatPersistIo,
  type ChatPersistMessage,
} from "../src/modules/chatPersist";

function memoryIo(): ChatPersistIo & { snapshot(): string } {
  const files = new Map<string, string>();
  return {
    getDirectory: () => "/profile/ai-butler-chat",
    async ensureDirectory() {
      return undefined;
    },
    async exists(path: string) {
      return files.has(path);
    },
    async read(path: string) {
      return files.get(path) || "";
    },
    async write(path: string, text: string) {
      files.set(path, text);
    },
    join(dir: string, name: string) {
      return `${dir}/${name}`;
    },
    snapshot() {
      return files.get("/profile/ai-butler-chat/threads.json") || "";
    },
  };
}

function createStore(
  io: ChatPersistIo,
  ids: string[],
): { store: ChatPersist; tick: () => void } {
  let time = 1_000;
  let index = 0;
  const store = new ChatPersist(
    io,
    () => time,
    () => ids[index++] || `generated-${index}`,
  );
  return {
    store,
    tick() {
      time += 1;
    },
  };
}

describe("quick-chat persistence and abort labeling", function () {
  it("keeps per-item threads across a reload", async function () {
    const io = memoryIo();
    const first = createStore(io, ["thread-a", "thread-b"]);
    await first.store.ensureLoaded();
    const created = first.store.createThread(7);
    first.store.saveMessages(7, created.id, [
      { role: "user", content: "What is the main claim?" },
      { role: "assistant", content: "The claim is $E=mc^2$." },
    ]);
    await first.store.flush();

    const second = createStore(io, ["unused"]);
    await second.store.ensureLoaded();
    const threads = second.store.listThreads(7);

    expect(threads).to.have.length(1);
    expect(threads[0].id).to.equal("thread-a");
    expect(threads[0].title).to.equal("What is the main claim?");
    expect(threads[0].messages.map((message) => message.content)).to.deep.equal(
      ["What is the main claim?", "The claim is $E=mc^2$."],
    );
    expect(second.store.listThreads(8)).to.deep.equal([]);
  });

  it("caps threads, messages, and message length", async function () {
    const io = memoryIo();
    const { store, tick } = createStore(
      io,
      Array.from({ length: 25 }, (_value, index) => `t-${index}`),
    );
    await store.ensureLoaded();
    for (let index = 0; index < 21; index++) {
      tick();
      store.createThread(3, `Thread ${index}`);
    }
    const threads = store.listThreads(3);
    expect(threads).to.have.length(20);
    expect(threads.some((thread) => thread.title === "Thread 0")).to.equal(
      false,
    );
    expect(threads[0].title).to.equal("Thread 20");

    const messages: ChatPersistMessage[] = Array.from(
      { length: 130 },
      (_value, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content: `m-${index}`,
      }),
    );
    const saved = store.saveMessages(3, threads[0].id, messages);
    expect(saved?.messages).to.have.length(120);
    expect(saved?.messages[0].content).to.equal("m-10");
    expect(saved?.messages.at(-1)?.content).to.equal("m-129");

    const truncated = store.saveMessages(3, threads[0].id, [
      { role: "user", content: "x".repeat(50_010) },
    ]);
    expect(truncated?.messages[0].content.endsWith("\n\n[truncated]")).to.equal(
      true,
    );
    expect(truncated?.messages[0].content.length).to.be.lessThan(50_030);
    await store.flush();
  });

  it("creates a fresh thread when the last one is deleted", async function () {
    const io = memoryIo();
    const { store } = createStore(io, ["keep", "drop", "fresh"]);
    await store.ensureLoaded();
    const first = store.createThread(4);
    const second = store.createThread(4);
    store.saveMessages(4, first.id, [
      { role: "user", content: "Keep this thread" },
    ]);
    const afterDelete = store.deleteThread(4, second.id);
    expect(afterDelete?.id).to.equal(first.id);

    const emptied = store.deleteThread(4, first.id);
    expect(emptied?.id).to.equal("fresh");
    expect(emptied?.messages).to.deep.equal([]);
    expect(store.listThreads(4)).to.have.length(1);
    await store.flush();
  });

  it("labels only real aborts as cancelled", function () {
    const controller = createChatAbortController();
    expect(isChatAbortError(new Error("401"), controller.signal)).to.equal(
      false,
    );
    expect(
      isChatAbortError(
        { name: "LLMApiCallError", suppressTaskRetry: true, message: "boom" },
        controller.signal,
      ),
    ).to.equal(false);
    expect(
      isChatAbortError({ name: "LLMRequestAbortError", message: "stopped" }),
    ).to.equal(true);

    controller.abort("stopped");
    expect(isChatAbortError(new Error("network"), controller.signal)).to.equal(
      true,
    );
  });
});
