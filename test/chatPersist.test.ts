import { expect } from "chai";
import {
  createChatAbortController,
  isChatAbortError,
  buildQuickChatConversation,
} from "../src/modules/chatContext";
import {
  ChatPersist,
  cloneChatContext,
  type ChatPersistIo,
  type ChatPersistMessage,
  type ChatPersistContext,
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
  it("restores each thread's related papers and mode independently (#427)", async function () {
    const io = memoryIo();
    const { store } = createStore(io, ["a", "b", "empty"]);
    await store.ensureLoaded();
    const context: ChatPersistContext = {
      relatedItems: [
        { itemId: 101, libraryID: 1, key: "PAPER_A", title: "Paper A" },
      ],
      relatedMode: "fullText",
      relatedContextSignature: "fullText:101",
      relatedContextIncludedCount: 1,
    };
    store.createThread(7);
    store.saveMessages(
      7,
      "a",
      [{ role: "user", content: "Compare A" }],
      context,
    );
    context.relatedItems[0].itemId = 202;
    context.relatedItems[0].title = "Paper B";
    context.relatedMode = "summary";
    context.relatedContextSignature = "summary:202";
    store.createThread(7);
    store.saveMessages(
      7,
      "b",
      [{ role: "user", content: "Compare B" }],
      context,
    );
    store.createThread(7);
    store.setActiveThread(7, "a");
    await store.flush();

    const restored = createStore(io, []).store;
    await restored.ensureLoaded();
    expect(restored.getOrCreateActiveThread(7).id).to.equal("a");
    const a = cloneChatContext(restored.getThread(7, "a")?.context);
    expect(a.relatedItems[0].itemId).to.equal(101);
    expect(a.relatedMode).to.equal("fullText");
    expect(a.relatedContextSignature).to.equal("fullText:101");
    expect(a.relatedContextIncludedCount).to.equal(1);
    expect(
      restored.getThread(7, "b")?.context?.relatedItems[0].itemId,
    ).to.equal(202);
    expect(restored.getThread(7, "empty")?.context).to.deep.equal(
      cloneChatContext(),
    );
    a.relatedItems.length = 0;
    expect(restored.getThread(7, "a")?.context?.relatedItems).to.have.length(1);
  });

  it("retains answer actions and saved state without changing the active thread (#427)", async function () {
    const io = memoryIo();
    const { store } = createStore(io, ["a", "b"]);
    await store.ensureLoaded();
    store.createThread(7);
    const messages: ChatPersistMessage[] = [
      {
        role: "user",
        content: "Internal paper context\nQuestion?",
        displayContent: "Question?",
      },
      {
        role: "assistant",
        content: "Answer",
        pairId: "pair-1",
        sourceLabel: "Compared Paper A",
        noteMetadata: {
          schema: "AI_BUTLER_LLM_NOTE_BLOCK",
          version: 1,
          blockId: "block-1",
          task: "chat",
          providerId: "test",
          providerName: "Test",
          modelId: "test-model",
          generatedAt: "2026-10-21T00:00:00Z",
        },
      },
    ];
    store.saveMessages(7, "a", messages);
    store.createThread(7);
    store.markPairSaved(7, "a", "pair-1");
    expect(store.getOrCreateActiveThread(7).id).to.equal("b");
    await store.flush();

    const restored = createStore(io, []).store;
    await restored.ensureLoaded();
    const thread = restored.getThread(7, "a")!;
    expect(thread.title).to.equal("Question?");
    expect(thread.messages[0].displayContent).to.equal("Question?");
    expect(thread.messages[1]).to.deep.equal({
      ...messages[1],
      savedToNote: true,
    });
    expect(buildQuickChatConversation(thread.messages, "Next?")).to.deep.equal([
      { role: "user", content: messages[0].content },
      { role: "assistant", content: "Answer" },
      { role: "user", content: "Next?" },
    ]);
    restored.deleteThread(7, "a");
    restored.markPairSaved(7, "a", "pair-1");
    expect(restored.getThread(7, "a")).to.equal(null);
    await restored.flush();
  });

  it("upgrades legacy answer IDs before trimming history (#427)", async function () {
    const io = memoryIo();
    await io.write(
      "/profile/ai-butler-chat/threads.json",
      JSON.stringify({
        version: 1,
        items: {
          "7": {
            activeThreadId: "legacy",
            threads: [
              {
                id: "legacy",
                title: "Old conversation",
                createdAt: 1,
                updatedAt: 1,
                messages: Array.from({ length: 122 }, (_, index) => ({
                  role: index % 2 ? "assistant" : "user",
                  content: `Message ${index}`,
                })),
              },
            ],
          },
        },
      }),
    );
    const { store } = createStore(io, []);
    await store.ensureLoaded();
    const thread = store.getOrCreateActiveThread(7);
    const pairId = thread.messages[3].pairId;
    expect(cloneChatContext(thread.context)).to.deep.equal(cloneChatContext());
    store.saveMessages(7, thread.id, thread.messages);
    expect(store.getThread(7, thread.id)?.messages[1].pairId).to.equal(pairId);
    await store.flush();
  });

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
