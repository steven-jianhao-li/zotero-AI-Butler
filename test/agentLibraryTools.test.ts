import { expect } from "chai";
import JSZip from "jszip";
import { createLibraryTools } from "../src/modules/agent/tools/libraryTools";
import type { AgentToolContext } from "../src/modules/agent/tools/types";
import {
  defaultAgentOptions,
  type AgentSession,
} from "../src/modules/agent/types";
import { LLMService, type LLMGenerateRequest } from "../src/modules/llmService";
import {
  LLMEndpointManager,
  type LLMEndpoint,
} from "../src/modules/llmEndpointManager";
import { ContentExtractor } from "../src/modules/contentExtractor";
import { PDFExtractor } from "../src/modules/pdfExtractor";
import { MineruClient } from "../src/modules/mineruIntegration";
import { MineruMarkdownSaver } from "../src/modules/mineruMarkdownSaver";
import { AgentRunner } from "../src/modules/agent/AgentRunner";
import { AgentService } from "../src/modules/agent/AgentService";
import {
  TaskQueueManager,
  TaskStatus,
  type TaskItem,
  type TaskOptions,
} from "../src/modules/taskQueue";

type FixtureTag = { tag: string; type?: number };

/** In-memory Zotero boundary: no real library or preference is accessed. */
class FixtureItem {
  libraryID = 1;
  deleted = false;
  parentID: number | false = false;
  key: string;
  itemType: string;
  note = "";
  noteIds: number[] = [];
  attachmentIds: number[] = [];
  tags: FixtureTag[] = [];
  collections: number[] = [];
  fields: Record<string, string> = {};
  saveCount = 0;
  mutationCount = 0;
  failSave = false;
  onSave?: () => void;

  constructor(
    public id: number,
    type = "journalArticle",
  ) {
    this.key = `KEY${id}`;
    this.itemType = type;
    this.fields.title = `Paper ${id}`;
  }

  isRegularItem() {
    return this.itemType === "journalArticle";
  }
  isNote() {
    return this.itemType === "note";
  }
  getField(field: string) {
    return this.fields[field] || "";
  }
  getNotes() {
    return [...this.noteIds];
  }
  getAttachments() {
    return [...this.attachmentIds];
  }
  getCreators() {
    return [{ firstName: "Ada", lastName: "Lovelace" }];
  }
  getNote() {
    return this.note;
  }
  getTags() {
    return this.tags.map((tag) => ({ ...tag }));
  }
  getCollections() {
    return [...this.collections];
  }
  setTags(tags: FixtureTag[]) {
    this.mutationCount++;
    this.tags = tags.map((tag) => ({ ...tag }));
  }
  addTag(tag: string) {
    this.mutationCount++;
    this.tags.push({ tag });
  }
  setNote(note: string) {
    this.mutationCount++;
    this.note = note;
  }
  addToCollection(id: number) {
    this.mutationCount++;
    this.collections = [...new Set([...this.collections, id])];
  }
  removeFromCollection(id: number) {
    this.mutationCount++;
    this.collections = this.collections.filter((value) => value !== id);
  }
  async save() {
    this.saveCount++;
    if (this.failSave) throw new Error("fixture save failure");
    this.onSave?.();
    return this.id;
  }
  async saveTx() {
    return this.save();
  }
}

interface FixtureCollection {
  id: number;
  key: string;
  name: string;
  parentID: number | false;
  libraryID: number;
  deleted: boolean;
}

function context(): AgentToolContext {
  const signal = new AbortController().signal;
  const session: AgentSession = {
    id: "library-fixture",
    title: "Research",
    createdAt: 1,
    updatedAt: 1,
    status: "running",
    permission: "read-only",
    options: { ...defaultAgentOptions(), endpointId: "selected" },
    messages: [],
    events: [],
    plan: [],
    team: [],
    artifacts: {},
    pendingApprovals: [],
    context: {
      estimatedTokens: 0,
      compactions: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
  };
  return {
    session,
    signal,
    assertActive() {
      if (signal.aborted) throw new Error("fixture cancelled");
    },
  };
}

async function rejects(operation: Promise<unknown>, message: string) {
  let failure: unknown;
  try {
    await operation;
  } catch (error) {
    failure = error;
  }
  expect(failure).to.be.instanceOf(Error);
  expect((failure as Error).message).to.contain(message);
}

describe("Agent library tools", function () {
  describe("Agent library tool boundary", function () {
    const globals = globalThis as unknown as Record<string, unknown>;
    let previous: Record<string, unknown>;
    let items: Map<number, FixtureItem>;
    let collections: Map<number, FixtureCollection>;
    let state: AgentToolContext;
    let editable: boolean;
    let transactionCount: number;
    let rollbackCount: number;
    let lastSearch: {
      libraryID: number;
      conditions: string[][];
      scope?: unknown;
      includeChildren?: boolean;
    };
    let generate: typeof LLMService.generateWithEndpoint;
    let getEndpoint: typeof LLMEndpointManager.getEndpoint;
    let acquireEndpoint: typeof LLMService.acquireChatSessionEndpoint;
    let getQueue: typeof TaskQueueManager.getInstance;
    let tasks: Map<string, TaskItem>;
    let queued: {
      itemId: number;
      mode: string;
      priority: boolean;
      options?: TaskOptions;
    }[];
    let complete: Set<(id: string) => void>;
    let progress: Set<(id: string) => void>;
    let removed: Set<(id: string) => void>;
    let noteStrategy: string;
    let failEnqueue: boolean;

    function task(mode = "summary", status = TaskStatus.PROCESSING): TaskItem {
      return {
        id: `${mode === "summary" ? "summary" : "deepread"}-task-1`,
        itemId: 1,
        title: "Paper 1",
        taskType: mode === "summary" ? "summary" : "deepRead",
        status,
        progress: 30,
        createdAt: new Date(),
        retryCount: 0,
        maxRetries: 3,
      };
    }

    function subscribe(
      set: Set<(id: string) => void>,
      callback: (id: string) => void,
    ) {
      set.add(callback);
      return () => set.delete(callback);
    }

    async function waiting() {
      for (let i = 0; i < 20 && !complete.size; i++) await Promise.resolve();
      expect(complete.size).to.equal(1);
    }

    function noListeners() {
      expect([complete.size, progress.size, removed.size]).to.deep.equal([
        0, 0, 0,
      ]);
    }

    function execute(name: string, args: Record<string, unknown>) {
      const selected = createLibraryTools().find(
        (entry) => entry.definition.name === name,
      );
      if (!selected) throw new Error(`Missing fixture tool: ${name}`);
      return selected.execute(args, state);
    }

    beforeEach(function () {
      previous = Object.fromEntries(
        ["Zotero", "DOMParser", "ztoolkit", "addon"].map((key) => [
          key,
          globals[key],
        ]),
      );
      generate = LLMService.generateWithEndpoint;
      getEndpoint = LLMEndpointManager.getEndpoint;
      acquireEndpoint = LLMService.acquireChatSessionEndpoint;
      getQueue = TaskQueueManager.getInstance;
      tasks = new Map();
      queued = [];
      complete = new Set();
      progress = new Set();
      removed = new Set();
      noteStrategy = "skip";
      failEnqueue = false;
      const enqueue = async (
        item: Zotero.Item,
        mode: string,
        priority = false,
        options?: TaskOptions,
      ) => {
        if (failEnqueue) throw new Error("no usable attachment");
        queued.push({ itemId: item.id, mode, priority, options });
        const entry = task(mode, TaskStatus.PENDING);
        tasks.set(entry.id, entry);
        return entry.id;
      };
      const queue: Pick<
        TaskQueueManager,
        | "getTask"
        | "addTask"
        | "addDeepReadTask"
        | "onComplete"
        | "onProgress"
        | "onRemoved"
      > = {
        getTask: (id) => tasks.get(id),
        addTask: (item, priority, options) =>
          enqueue(item, "summary", priority, options),
        addDeepReadTask: (item, priority, options) =>
          enqueue(item, "deepRead", priority, options),
        onComplete: (callback) =>
          subscribe(complete, (id) =>
            callback(id, tasks.get(id)?.status === TaskStatus.COMPLETED),
          ),
        onProgress: (callback) =>
          subscribe(progress, (id) => callback(id, 50, "progress")),
        onRemoved: (callback) => subscribe(removed, callback),
      };
      TaskQueueManager.getInstance = () => queue as TaskQueueManager;
      state = context();
      editable = true;
      transactionCount = 0;
      rollbackCount = 0;
      const paper = new FixtureItem(1);
      paper.noteIds = [2];
      paper.tags = [{ tag: "original", type: 1 }];
      paper.collections = [10];
      const note = new FixtureItem(2, "note");
      note.parentID = 1;
      note.note = "Existing AI summary\nEvidence about the experiment.";
      note.tags = [{ tag: "AI-Generated" }];
      const foreign = new FixtureItem(3);
      foreign.libraryID = 2;
      const deleted = new FixtureItem(4);
      deleted.deleted = true;
      const second = new FixtureItem(5);
      items = new Map(
        [paper, note, foreign, deleted, second].map((item) => [item.id, item]),
      );
      collections = new Map([
        [
          10,
          {
            id: 10,
            key: "C10",
            name: "Existing",
            parentID: false,
            libraryID: 1,
            deleted: false,
          },
        ],
        [
          11,
          {
            id: 11,
            key: "C11",
            name: "Research",
            parentID: false,
            libraryID: 1,
            deleted: false,
          },
        ],
        [
          20,
          {
            id: 20,
            key: "C20",
            name: "Foreign",
            parentID: false,
            libraryID: 2,
            deleted: false,
          },
        ],
      ]);
      class Search {
        libraryID: number;
        conditions: string[][] = [];
        scope?: unknown;
        includeChildren?: boolean;
        constructor(options: { libraryID: number }) {
          this.libraryID = options.libraryID;
          lastSearch = { ...this };
        }
        addCondition(...condition: string[]) {
          this.conditions.push(condition);
        }
        setScope(scope: unknown, includeChildren: boolean) {
          this.scope = scope;
          this.includeChildren = includeChildren;
          lastSearch = { ...this };
        }
        async search() {
          return [...items.values()]
            .filter(
              (item) => item.libraryID === this.libraryID && !item.deleted,
            )
            .filter((item) =>
              this.conditions.some(
                (part) => part.join(":") === "itemType:is:note",
              )
                ? item.isNote()
                : item.isRegularItem(),
            )
            .map((item) => item.id)
            .reverse();
        }
      }
      globals.Zotero = {
        Prefs: { get: () => noteStrategy },
        Items: {
          trash: async (ids: number[]) => {
            for (const id of ids) {
              const item = items.get(id)!;
              if (item.failSave) throw new Error("fixture trash failure");
              item.deleted = true;
              item.onSave?.();
            }
          },
          getAsync: async (id: number | number[]) =>
            Array.isArray(id)
              ? id.map((value) => items.get(value))
              : items.get(id),
        },
        Collections: {
          getAsync: async (id: number) => collections.get(id),
          getByLibrary: (libraryID: number) =>
            [...collections.values()].filter(
              (entry) => entry.libraryID === libraryID,
            ),
        },
        Libraries: {
          isEditable: () => editable,
          get: (id: number) => ({ libraryID: id }),
        },
        URI: {
          getLibraryURI: (id: number) =>
            id === 1
              ? "https://zotero.org/users/fixture"
              : "https://zotero.org/groups/77",
        },
        Search,
        Item: class extends FixtureItem {
          constructor(type: string) {
            super(100, type);
            items.set(this.id, this);
          }
        },
        DB: {
          executeTransaction: async (operation: () => Promise<unknown>) => {
            transactionCount++;
            const snapshot = [...items].map(([id, item]) => ({
              id,
              tags: item.getTags(),
              collections: item.getCollections(),
              deleted: item.deleted,
            }));
            try {
              return await operation();
            } catch (error) {
              rollbackCount++;
              for (const entry of snapshot) {
                const item = items.get(entry.id)!;
                item.tags = entry.tags;
                item.collections = entry.collections;
                item.deleted = entry.deleted;
              }
              throw error;
            }
          },
        },
      };
      globals.ztoolkit = { log: () => {} };
      globals.addon = { data: {} };
      // Notes here are plain-text fixtures. A real DOMParser is used in Zotero;
      // this minimal Node boundary exercises pagination and mutation isolation.
      if (!previous.DOMParser) {
        globals.DOMParser = class {
          parseFromString(text: string) {
            return { body: { textContent: text }, querySelectorAll: () => [] };
          }
        };
      }
    });

    afterEach(function () {
      Object.assign(globals, previous);
      LLMService.generateWithEndpoint = generate;
      LLMEndpointManager.getEndpoint = getEndpoint;
      LLMService.acquireChatSessionEndpoint = acquireEndpoint;
      TaskQueueManager.getInstance = getQueue;
    });

    it("scopes metadata and note search to the chosen library and pages deterministically", async function () {
      const result = (await execute("search_library", {
        query: "",
        source: "metadata",
        limit: 1,
      })) as { items: { itemId: number }[]; nextOffset: number };
      expect(result.items.map((item) => item.itemId)).to.deep.equal([1]);
      expect(result.nextOffset).to.equal(1);
      expect(lastSearch.libraryID).to.equal(1);
      expect(lastSearch.conditions).to.deep.include(["deleted", "false"]);
      await execute("search_library", {
        query: "experiment",
        source: "notes",
        collectionId: 10,
      });
      expect(lastSearch.conditions).to.deep.include([
        "note",
        "contains",
        "experiment",
      ]);
      expect(lastSearch.scope).to.have.property("libraryID", 1);
      expect(lastSearch.includeChildren).to.equal(true);
      await rejects(
        execute("search_library", {
          query: "",
          source: "notes",
          collectionId: 20,
        }),
        "collection-unavailable",
      );
    });

    it("enqueues standard summary and deep-read workflows with saved settings and returns immediately", async function () {
      state.session.permission = "full";
      items.get(1)!.noteIds = [];
      for (const mode of ["summary", "deepRead"]) {
        const result = await execute("start_paper_workflow", {
          itemId: 1,
          mode,
        });
        expect(result).to.have.property("disposition", "submitted");
      }
      expect(queued).to.deep.equal([
        {
          itemId: 1,
          mode: "summary",
          priority: false,
          options: { source: "manual", summaryMode: "single" },
        },
        {
          itemId: 1,
          mode: "deepRead",
          priority: false,
          options: { source: "manual", summaryMode: "deepRead" },
        },
      ]);
      noListeners();
    });

    it("reuses existing notes by default even under overwrite policy and never migrates legacy tags", async function () {
      state.session.permission = "full";
      noteStrategy = "overwrite";
      const result = (await execute("start_paper_workflow", {
        itemId: 1,
        mode: "summary",
      })) as { after: { noteId: number; artifactReady: boolean } };
      expect(result).to.have.property("disposition", "reused_result");
      expect(result.after.noteId).to.equal(2);
      expect(result.after.artifactReady).to.equal(true);
      expect(queued).to.have.length(0);
      expect(items.get(2)!.tags).to.deep.equal([{ tag: "AI-Generated" }]);
      expect(items.get(2)!.mutationCount).to.equal(0);
      expect(items.get(2)!.saveCount).to.equal(0);
      const status = await execute("get_paper_workflow_status", {
        taskId: "summary-task-1",
      });
      expect(status).to.include({
        status: "completed",
        noteId: 2,
        artifactReady: true,
      });
    });

    it("requires explicit regeneration and leaves skip/append/overwrite policy to the queue", async function () {
      state.session.permission = "full";
      for (const policy of ["skip", "append", "overwrite"]) {
        noteStrategy = policy;
        tasks.clear();
        await execute("start_paper_workflow", {
          itemId: 1,
          mode: "summary",
          regenerate: true,
        });
        expect(queued.at(-1)!.options).not.to.have.property("forceOverwrite");
      }
      expect(queued).to.have.length(3);
    });

    it("reuses queued, processing and legacy tasks without resetting or overwriting their options", async function () {
      state.session.permission = "full";
      for (const status of [
        TaskStatus.PENDING,
        TaskStatus.PRIORITY,
        TaskStatus.PROCESSING,
      ]) {
        const entry = task("summary", status);
        entry.id = "task-1";
        entry.options = { forceOverwrite: true };
        tasks.set(entry.id, entry);
        const result = await execute("start_paper_workflow", {
          itemId: 1,
          mode: "summary",
          regenerate: true,
        });
        expect(result).to.include({
          disposition: "existing_task",
          taskId: "task-1",
        });
        expect(entry.options).to.deep.equal({ forceOverwrite: true });
      }
      expect(queued).to.have.length(0);
    });

    it("resumes incomplete deep-reading notes and regenerates missing completed artifacts", async function () {
      state.session.permission = "full";
      items.get(2)!.tags = [{ tag: "AI-DeepRead" }];
      items.get(2)!.note =
        "<!-- zab:slot:test:pending --><p>pending</p><!-- zab:slot:test:end -->";
      await execute("start_paper_workflow", { itemId: 1, mode: "deepRead" });
      expect(queued[0].mode).to.equal("deepRead");
      tasks.set("summary-task-1", task("summary", TaskStatus.COMPLETED));
      await execute("start_paper_workflow", { itemId: 1, mode: "summary" });
      expect(queued[1].mode).to.equal("summary");
    });

    it("enforces workflow scope, source type, write authority and strict arguments", async function () {
      await rejects(
        execute("start_paper_workflow", { itemId: 1, mode: "summary" }),
        "read-only",
      );
      state.session.permission = "full";
      editable = false;
      await rejects(
        execute("start_paper_workflow", { itemId: 1, mode: "summary" }),
        "library-read-only",
      );
      editable = true;
      for (const id of [3, 4, 999]) {
        await rejects(
          execute("start_paper_workflow", { itemId: id, mode: "summary" }),
          "item-unavailable",
        );
        await rejects(
          execute("get_paper_workflow_status", {
            taskId: `summary-task-${id}`,
          }),
          "item-unavailable",
        );
      }
      await rejects(
        execute("start_paper_workflow", { itemId: 2, mode: "summary" }),
        "not-paper",
      );
      await rejects(
        execute("start_paper_workflow", { itemId: 1, mode: "invalid" }),
        "enum",
      );
      await rejects(
        execute("start_paper_workflow", {
          itemId: 1,
          mode: "summary",
          regenerate: "true",
        }),
        "boolean",
      );
      await rejects(
        execute("start_paper_workflow", {
          itemId: 1,
          mode: "summary",
          forceOverwrite: true,
        }),
        "unknown-argument",
      );
      await rejects(
        execute("get_paper_workflow_status", { taskId: "img-task-1" }),
        "workflow-task",
      );
      await rejects(
        execute("get_paper_workflow_status", {
          taskId: "summary-task-1",
          wait: "yes",
        }),
        "boolean",
      );
      expect(queued).to.have.length(0);
    });

    it("surfaces enqueue failures without claiming that a workflow started", async function () {
      state.session.permission = "full";
      items.get(1)!.noteIds = [];
      failEnqueue = true;
      await rejects(
        execute("start_paper_workflow", { itemId: 1, mode: "summary" }),
        "no usable attachment",
      );
      expect(tasks.size).to.equal(0);
    });

    it("waits on queue events through transient retries, then returns the saved note", async function () {
      const entry = task();
      tasks.set(entry.id, entry);
      let settled = false;
      const pending = execute("get_paper_workflow_status", {
        taskId: entry.id,
        wait: true,
      }).then((result) => {
        settled = true;
        return result;
      });
      await waiting();
      entry.status = TaskStatus.PENDING;
      for (const callback of complete) callback(entry.id);
      await Promise.resolve();
      expect(settled).to.equal(false);
      entry.status = TaskStatus.COMPLETED;
      entry.progress = 100;
      for (const callback of complete) callback(entry.id);
      expect(await pending).to.include({
        status: "completed",
        noteId: 2,
        artifactReady: true,
        waitTimedOut: false,
      });
      noListeners();
    });

    it("returns final failure and removes all wait subscriptions", async function () {
      const entry = task();
      tasks.set(entry.id, entry);
      const pending = execute("get_paper_workflow_status", {
        taskId: entry.id,
        wait: true,
      });
      await waiting();
      entry.status = TaskStatus.FAILED;
      entry.error = "provider failed";
      for (const callback of progress) callback(entry.id);
      expect(await pending).to.include({
        status: "failed",
        error: "provider failed",
      });
      noListeners();
    });

    it("ends waits for deleted tasks and rechecks item scope before exposing results", async function () {
      const entry = task();
      tasks.set(entry.id, entry);
      const pending = execute("get_paper_workflow_status", {
        taskId: entry.id,
        wait: true,
      });
      await waiting();
      tasks.delete(entry.id);
      for (const callback of removed) callback(entry.id);
      expect(await pending).to.have.property("noteId", 2);
      noListeners();
      tasks.set(entry.id, entry);
      const moved = execute("get_paper_workflow_status", {
        taskId: entry.id,
        wait: true,
      });
      await waiting();
      items.get(1)!.libraryID = 2;
      entry.status = TaskStatus.COMPLETED;
      for (const callback of complete) callback(entry.id);
      await rejects(moved, "target-unavailable");
      noListeners();
    });

    it("cancels the wait without cancelling the queued workflow", async function () {
      const controller = new AbortController();
      state.signal = controller.signal;
      const entry = task();
      tasks.set(entry.id, entry);
      const pending = execute("get_paper_workflow_status", {
        taskId: entry.id,
        wait: true,
      });
      await waiting();
      controller.abort();
      await rejects(pending, "aborted");
      expect(entry.status).to.equal(TaskStatus.PROCESSING);
      noListeners();
    });

    it("times out without changing queue state or leaking subscriptions", async function () {
      const originalSetTimeout = globals.setTimeout;
      const originalClearTimeout = globals.clearTimeout;
      let expire: (() => void) | undefined;
      let cleared = false;
      const entry = task();
      tasks.set(entry.id, entry);
      try {
        globals.setTimeout = (callback: () => void, delay: number) => {
          expect(delay).to.equal(30 * 60 * 1000);
          expire = callback;
          return 812;
        };
        globals.clearTimeout = (id: number) => {
          cleared = id === 812;
        };
        const pending = execute("get_paper_workflow_status", {
          taskId: entry.id,
          wait: true,
        });
        await waiting();
        expire!();
        expect(await pending).to.include({
          waitTimedOut: true,
          status: "processing",
        });
        expect(cleared).to.equal(true);
        noListeners();
      } finally {
        globals.setTimeout = originalSetTimeout;
        globals.clearTimeout = originalClearTimeout;
      }
    });

    it("returns immediately for already completed tasks, including missing artifacts", async function () {
      tasks.set("summary-task-1", task("summary", TaskStatus.COMPLETED));
      items.get(1)!.noteIds = [];
      expect(
        await execute("get_paper_workflow_status", {
          taskId: "summary-task-1",
          wait: true,
        }),
      ).to.include({
        status: "completed",
        artifactReady: false,
        noteId: null,
        waitTimedOut: false,
      });
      noListeners();
    });

    it("runs the approval -> enqueue -> completion -> read-note sequence in the Agent loop", async function () {
      state.session.permission = "confirm";
      items.get(1)!.noteIds = [];
      let step = 0;
      let approvals = 0;
      const running = new AgentRunner({
        tools: createLibraryTools(),
        save: async () => {},
        changed: () => {},
        write: (operation) => operation(),
        approve: async (_session, approval) => {
          approvals++;
          expect(approval.toolName).to.equal("start_paper_workflow");
          expect(queued).to.have.length(0);
          return true;
        },
        turn: async (request) => {
          step++;
          const name = [
            "start_paper_workflow",
            "get_paper_workflow_status",
            "read_note",
          ][step - 1];
          const args = [
            { itemId: 1, mode: "summary" },
            { taskId: "summary-task-1", wait: true },
            { noteId: 2 },
          ][step - 1];
          if (step === 3)
            expect(request.messages.at(-1)!.content).to.contain('"noteId":2');
          if (step === 4)
            expect(request.messages.at(-1)!.content).to.contain(
              "Existing AI summary",
            );
          return {
            text: name ? "" : "Summary ready.",
            toolCalls: name
              ? [{ id: `step-${step}`, name, arguments: JSON.stringify(args) }]
              : [],
          };
        },
      }).run(state.session, state.signal);
      for (let i = 0; i < 150 && !complete.size; i++) await Promise.resolve();
      await waiting();
      const entry = tasks.get("summary-task-1")!;
      entry.status = TaskStatus.COMPLETED;
      items.get(1)!.noteIds = [2];
      for (const callback of complete) callback(entry.id);
      await running;
      expect(approvals).to.equal(1);
      expect(state.session.status).to.equal("completed");
      expect(state.session.mutationReceipts?.[0].status).to.equal("completed");
      noListeners();
    });

    it("reads notes progressively without normalizing tags or saving notes", async function () {
      const original = items.get(2)!.note;
      const metadata = (await execute("get_item", { itemId: 1 })) as {
        children: { items: { itemId: number }[] };
      };
      expect(metadata.children.items.map((item) => item.itemId)).to.deep.equal([
        2,
      ]);
      const first = (await execute("read_note", { noteId: 2, limit: 12 })) as {
        text: string;
        nextOffset: number;
        aiGenerated: boolean;
      };
      const next = (await execute("read_note", {
        noteId: 2,
        offset: first.nextOffset,
      })) as { text: string; nextOffset: null };
      expect(first.text + next.text).to.equal(original);
      expect(first.aiGenerated).to.equal(true);
      expect(next.nextOffset).to.equal(null);
      expect(items.get(2)!.note).to.equal(original);
      expect(
        [...items.values()].every(
          (item) => item.mutationCount === 0 && item.saveCount === 0,
        ),
      ).to.equal(true);
    });

    it("rejects unavailable, deleted and cross-library items before exposing content", async function () {
      for (const itemId of [3, 4, 999])
        await rejects(execute("get_item", { itemId }), "item-unavailable");
      await rejects(execute("read_note", { noteId: 1 }), "not-note");
      await rejects(
        execute("read_paper", { itemId: 2, question: "Methods?" }),
        "not-paper",
      );
    });

    it("rejects unknown keys, coercion, invalid enums, unsafe integers and excessive batches", async function () {
      for (const args of [
        { itemId: "1" },
        { itemId: 1, unexpected: true },
        { itemId: 1.5 },
        { itemId: Number.MAX_SAFE_INTEGER + 1 },
        { itemId: 1, offset: -1 },
        { itemId: 1, limit: 21 },
      ]) {
        await rejects(
          execute("get_item", args),
          args.unexpected ? "unknown-argument" : "integer",
        );
      }
      await rejects(
        execute("search_library", { query: "", source: "all" }),
        "error-enum",
      );
      state.session.permission = "full";
      await rejects(
        execute("edit_tags", { itemIds: Array(51).fill(1), add: ["x"] }),
        "item-ids",
      );
      await rejects(
        execute("edit_tags", { itemIds: [1], add: ["a\0b"] }),
        "nonempty",
      );
      await rejects(
        execute("edit_tags", { itemIds: [1], add: ["x"], remove: ["x"] }),
        "tags-conflict",
      );
      expect(transactionCount).to.equal(0);
    });

    it("rejects every mutation in read-only mode and on noneditable libraries", async function () {
      const calls: [string, Record<string, unknown>][] = [
        ["edit_tags", { itemIds: [1], add: ["test"] }],
        [
          "organize_items",
          { itemIds: [1], collectionId: 11, operation: "add" },
        ],
        ["create_note", { itemId: 1, title: "Title", text: "Evidence" }],
        ["create_collection", { name: "New" }],
      ];
      for (const [name, args] of calls)
        await rejects(execute(name, args), "read-only");
      state.session.permission = "full";
      editable = false;
      for (const [name, args] of calls)
        await rejects(execute(name, args), "library-read-only");
      expect(transactionCount).to.equal(0);
      expect(
        [...items.values()].every((item) => item.mutationCount === 0),
      ).to.equal(true);
    });

    it("preflights all items and collection scope before any batch mutation", async function () {
      state.session.permission = "full";
      await rejects(
        execute("edit_tags", { itemIds: [1, 3], add: ["x"] }),
        "item-unavailable",
      );
      await rejects(
        execute("organize_items", {
          itemIds: [1],
          collectionId: 20,
          operation: "add",
        }),
        "collection-unavailable",
      );
      await rejects(
        execute("organize_items", {
          itemIds: [1, 2],
          collectionId: 11,
          operation: "add",
        }),
        "top-level",
      );
      expect(transactionCount).to.equal(0);
      expect(items.get(1)!.mutationCount).to.equal(0);
    });

    it("preserves tag types and returns exact before/after audits within one transaction", async function () {
      state.session.permission = "full";
      const result = (await execute("edit_tags", {
        itemIds: [1, 1, 5],
        add: ["new", "new"],
      })) as { changes: { before: FixtureTag[]; after: FixtureTag[] }[] };
      expect(transactionCount).to.equal(1);
      expect(result.changes).to.have.length(2);
      expect(result.changes[0].before).to.deep.equal([
        { tag: "original", type: 1 },
      ]);
      expect(result.changes[0].after).to.deep.equal([
        { tag: "original", type: 1 },
        { tag: "new", type: 0 },
      ]);
      expect(items.get(1)!.saveCount).to.equal(1);
      expect(items.get(1)!.tags).to.deep.equal(result.changes[0].after);
    });

    it("rolls back the batch when a later item fails to save", async function () {
      state.session.permission = "full";
      items.get(5)!.failSave = true;
      await rejects(
        execute("organize_items", {
          itemIds: [1, 5],
          collectionId: 11,
          operation: "add",
        }),
        "fixture save failure",
      );
      expect(transactionCount).to.equal(1);
      expect(rollbackCount).to.equal(1);
      expect(items.get(1)!.collections).to.deep.equal([10]);
      expect(items.get(5)!.collections).to.deep.equal([]);
    });

    it("removes only collection membership and records both versions", async function () {
      state.session.permission = "full";
      const result = (await execute("organize_items", {
        itemIds: [1],
        collectionId: 10,
        operation: "remove",
      })) as { changes: { before: number[]; after: number[] }[] };
      expect(result.changes[0].before).to.deep.equal([10]);
      expect(result.changes[0].after).to.deep.equal([]);
      expect(items.get(1)!.deleted).to.equal(false);
      expect(items.get(1)!.noteIds).to.deep.equal([2]);
    });

    it("checks audit size before mutating an oversized batch", async function () {
      state.session.permission = "full";
      items.get(1)!.tags = Array.from({ length: 200 }, (_, index) => ({
        tag: `${index}-${"x".repeat(120)}`,
        type: 1,
      }));
      await rejects(
        execute("edit_tags", { itemIds: [1], add: ["new"] }),
        "audit-size",
      );
      expect(items.get(1)!.mutationCount).to.equal(0);
      expect(items.get(1)!.saveCount).to.equal(0);
    });

    it("returns a completed write audit when cancellation arrives during the commit", async function () {
      state.session.permission = "full";
      let cancelled = false;
      state.assertActive = () => {
        if (cancelled) throw new Error("fixture cancelled");
      };
      items.get(1)!.onSave = () => {
        cancelled = true;
      };
      const result = (await execute("edit_tags", {
        itemIds: [1],
        add: ["new"],
      })) as { changes: unknown[] };
      expect(result.changes).to.have.length(1);
      expect(items.get(1)!.tags.some((tag) => tag.tag === "new")).to.equal(
        true,
      );
      await rejects(execute("get_item", { itemId: 1 }), "cancelled");
    });

    it("escapes model-generated note HTML and uses a separate Agent tag", async function () {
      state.session.permission = "full";
      await execute("create_note", {
        itemId: 1,
        title: "<b>Evidence</b>",
        text: '<script>alert("x")</script>\nResult',
      });
      const created = items.get(100)!;
      expect(created.note).to.contain("&lt;script&gt;");
      expect(created.note).not.to.contain("<script>");
      expect(created.note).to.contain("<br/>Result");
      expect(created.tags).to.deep.equal([{ tag: "AI-Agent" }]);
      expect(created.parentID).to.equal(1);
    });

    it("moves only the chosen papers to Trash and records recoverable before/after state", async function () {
      state.session.permission = "full";
      const result = (await execute("trash_items", { itemIds: [1, 5, 1] })) as {
        recoverable: boolean;
        changes: {
          before: { source: { itemId: number }; childNotes: number };
          after: { deleted: boolean };
        }[];
      };
      expect(result.recoverable).to.equal(true);
      expect(
        result.changes.map((change) => change.before.source.itemId),
      ).to.deep.equal([1, 5]);
      expect(result.changes[0].before.childNotes).to.equal(1);
      expect(result.changes.every((change) => change.after.deleted)).to.equal(
        true,
      );
      expect(items.get(2)!.parentID).to.equal(1);
      expect(items.get(1)!.getCollections()).to.deep.equal([10]);
      expect(items.get(3)!.deleted).to.equal(false);
      expect(transactionCount).to.equal(1);
    });

    it("preflights the entire trash batch and enforces permissions before any change", async function () {
      await rejects(execute("trash_items", { itemIds: [1] }), "read-only");
      state.session.permission = "full";
      editable = false;
      await rejects(
        execute("trash_items", { itemIds: [1] }),
        "library-read-only",
      );
      editable = true;
      for (const id of [3, 4, 999])
        await rejects(
          execute("trash_items", { itemIds: [1, id] }),
          "item-unavailable",
        );
      await rejects(
        execute("trash_items", { itemIds: [1, 2] }),
        "trash-paper-required",
      );
      expect(items.get(1)!.deleted).to.equal(false);
      expect(transactionCount).to.equal(0);
    });

    it("rolls back the whole trash batch if a later item fails", async function () {
      state.session.permission = "full";
      items.get(5)!.failSave = true;
      await rejects(
        execute("trash_items", { itemIds: [1, 5] }),
        "trash failure",
      );
      expect(items.get(1)!.deleted).to.equal(false);
      expect(items.get(5)!.deleted).to.equal(false);
      expect(rollbackCount).to.equal(1);
    });

    it("preserves a completed trash receipt when the Agent stops during commit", async function () {
      state.session.permission = "full";
      items.get(1)!.onSave = () => {
        state.assertActive = () => {
          throw new Error("cancelled");
        };
      };
      const result = await execute("trash_items", { itemIds: [1] });
      expect(result).to.have.property("operation", "trash");
      expect(items.get(1)!.deleted).to.equal(true);
    });

    it("applies read-only -> confirm -> full -> read-only on follow-ups in the same session", async function () {
      const service = Object.create(AgentService.prototype) as AgentService;
      let approvals = 0;
      Object.assign(service, {
        sessions: new Map([[state.session.id, state.session]]),
        listeners: new Set(),
        controllers: new Map(),
        approvals: new Map(),
        loading: Promise.resolve(),
        writes: Promise.resolve(),
        store: { save: async () => {} },
        requestApproval: async () => {
          approvals++;
          return false;
        },
      });
      const originalTurn = LLMService.agentTurn;
      try {
        for (const permission of [
          "read-only",
          "confirm",
          "full",
          "read-only",
        ] as const) {
          let turns = 0;
          LLMService.agentTurn = async (request) => {
            turns++;
            expect(request.messages[0].content).to.contain(
              `Authority=${permission}`,
            );
            expect(
              request.tools.some((tool) => tool.name === "trash_items"),
            ).to.equal(permission !== "read-only");
            if (permission !== "read-only" && turns === 1)
              return {
                text: "",
                toolCalls: [
                  {
                    id: `trash-${permission}`,
                    name: "trash_items",
                    arguments: '{"itemIds":[1]}',
                  },
                ],
              };
            if (permission === "confirm")
              expect(items.get(1)!.deleted).to.equal(false);
            if (permission === "full")
              expect(request.messages.at(-1)!.content).to.contain(
                '"operation":"trash"',
              );
            return { text: "Done.", toolCalls: [] };
          };
          await service.run(state.session.id, "Process the requested papers.", {
            permission,
          });
          expect(state.session.status).to.equal("completed");
          expect(state.session.permission).to.equal(permission);
        }
        expect(approvals).to.equal(1);
        expect(items.get(1)!.deleted).to.equal(true);
        expect(
          state.session.events.filter(
            (event) =>
              event.type === "status" &&
              event.data &&
              "permission" in (event.data as object),
          ),
        ).to.have.length(3);
      } finally {
        LLMService.agentTurn = originalTurn;
      }
    });

    it("keeps group-library source links scoped to the actual group", async function () {
      state.session.options.libraryID = 2;
      const result = (await execute("get_item", { itemId: 3 })) as {
        source: { uri: string };
      };
      expect(result.source.uri).to.equal(
        "zotero://select/groups/77/items/KEY3",
      );
    });

    for (const policy of ["auto", "pdf-base64"] as const) {
      it(`routes ${policy} deep reading through the selected endpoint without storing extracted content`, async function () {
        const completeEvidence = `${"e".repeat(24000)}\nFinal limitation: a small sample.`;
        const endpoint: LLMEndpoint = {
          id: "specialist",
          name: "Specialist",
          providerType: "openai-compat",
          model: "fixture",
          apiUrl: "https://example.invalid",
          apiKey: "fixture",
          enabled: true,
          createdAt: "",
          updatedAt: "",
          pdfProcessMode: "text",
        };
        let captured: LLMGenerateRequest | undefined;
        state.session.options.deepReadEndpointId = endpoint.id;
        state.session.options.pdfPolicy = policy;
        state.session.options.maxOutputTokens = 32768;
        LLMEndpointManager.getEndpoint = (id) => {
          expect(id).to.equal("specialist");
          return endpoint;
        };
        LLMService.acquireChatSessionEndpoint = () => {
          throw new Error("Must not reroute a selected endpoint");
        };
        LLMService.generateWithEndpoint = async (id, request) => {
          expect(id).to.equal(endpoint.id);
          captured = request;
          return {
            text: completeEvidence,
            providerId: "openai-compat",
            model: "fixture",
            warnings: [],
          };
        };
        const result = (await execute("read_paper", {
          itemId: 1,
          question: "What is the evidence?",
        })) as { evidence: string; effectiveMode: string };
        expect(captured?.content.kind).to.equal("zotero-item");
        expect(captured?.content).to.have.property(
          "persistExtractedContent",
          false,
        );
        expect(captured?.content).to.have.property("attachmentMode", "default");
        expect(captured?.content.policy).to.equal(
          policy === "auto" ? undefined : policy,
        );
        expect(captured?.transport?.abortSignal).to.equal(state.signal);
        expect(captured?.generation?.maxOutputTokens).to.equal(8192);
        expect(result.effectiveMode).to.equal(
          policy === "auto" ? "text" : "pdf-base64",
        );
        expect(result.evidence).to.equal(completeEvidence);
        expect(result.evidence).to.contain("Final limitation: a small sample.");
        expect(
          [...items.values()].every(
            (item) => item.mutationCount === 0 && item.saveCount === 0,
          ),
        ).to.equal(true);
      });
    }

    it("fails closed if the configured specialist endpoint was removed", async function () {
      LLMEndpointManager.getEndpoint = () => undefined;
      LLMService.acquireChatSessionEndpoint = () => {
        throw new Error("Unexpected fallback");
      };
      await rejects(
        execute("read_paper", { itemId: 1, question: "Methods?" }),
        "endpoint-unavailable",
      );
    });

    it("uses the coordinator's pinned endpoint when no explicit specialist is selected", async function () {
      state.session.options.endpointId = undefined;
      state.session.activeEndpointId = "coordinator-pinned";
      LLMEndpointManager.getEndpoint = (id) => {
        expect(id).to.equal("coordinator-pinned");
        return {
          id,
          name: "Pinned",
          providerType: "openai-compat",
          model: "fixture",
          apiUrl: "https://example.invalid",
          apiKey: "fixture",
          enabled: true,
          createdAt: "",
          updatedAt: "",
          pdfProcessMode: "text",
        };
      };
      LLMService.acquireChatSessionEndpoint = () => {
        throw new Error("Must not advance endpoint rotation during a run");
      };
      LLMService.generateWithEndpoint = async (id) => {
        expect(id).to.equal("coordinator-pinned");
        return {
          text: "Evidence",
          providerId: "openai-compat",
          model: "fixture",
          generatedAt: "",
          warnings: [],
        };
      };
      await execute("read_paper", { itemId: 1, question: "Methods?" });
    });
  });

  describe("Agent no-write content extraction", function () {
    it("forwards the no-persist policy through the unified PDF extractor", async function () {
      const getPdfs = PDFExtractor.getAllPdfAttachments;
      const extract = PDFExtractor.extractTextFromItem;
      const paper = { id: 1 } as Zotero.Item;
      const pdf = { id: 2 } as Zotero.Item;
      try {
        PDFExtractor.getAllPdfAttachments = async () => [pdf];
        PDFExtractor.extractTextFromItem = async (
          item,
          mode,
          _progress,
          options,
        ) => {
          expect(item).to.equal(paper);
          expect(mode).to.equal("mineru");
          expect(options).to.deep.equal({ persist: false });
          return "OCR evidence";
        };
        const result = await ContentExtractor.extractAnalyzableContentFromItem(
          paper,
          false,
          "mineru",
          undefined,
          { persist: false },
        );
        expect(result.content).to.equal("OCR evidence");
      } finally {
        PDFExtractor.getAllPdfAttachments = getPdfs;
        PDFExtractor.extractTextFromItem = extract;
      }
    });

    it("reuses existing MinerU Markdown in read-only mode even when saving is disabled", async function () {
      const globals = globalThis as unknown as Record<string, unknown>;
      const previous = globals.Zotero;
      const previousToolkit = globals.ztoolkit;
      const enabled = MineruMarkdownSaver.isSaveEnabled;
      const read = MineruMarkdownSaver.readCachedMarkdown;
      const save = MineruMarkdownSaver.save;
      let saveCount = 0;
      try {
        globals.Zotero = { Prefs: { get: () => "fixture-mineru-key" } };
        globals.ztoolkit = { log: () => {} };
        MineruMarkdownSaver.isSaveEnabled = () => false;
        MineruMarkdownSaver.readCachedMarkdown = async () =>
          "Existing OCR evidence";
        MineruMarkdownSaver.save = async () => {
          saveCount++;
          return {};
        };
        expect(
          await MineruClient.extractMarkdown(
            { id: 1 } as Zotero.Item,
            undefined,
            { persist: false },
          ),
        ).to.equal("Existing OCR evidence");
        expect(saveCount).to.equal(0);
      } finally {
        globals.Zotero = previous;
        globals.ztoolkit = previousToolkit;
        MineruMarkdownSaver.isSaveEnabled = enabled;
        MineruMarkdownSaver.readCachedMarkdown = read;
        MineruMarkdownSaver.save = save;
      }
    });
  });

  describe("MinerU read-only extraction and cancellation", function () {
    const globals = globalThis as unknown as Record<string, unknown>;
    let previous: Record<string, unknown>;
    let getPdfs: typeof PDFExtractor.getAllPdfAttachments;
    let readCache: typeof MineruMarkdownSaver.readCachedMarkdown;
    let save: typeof MineruMarkdownSaver.save;
    let enabled: typeof MineruMarkdownSaver.isSaveEnabled;
    let saveCount: number;
    let fetchCount: number;
    let pdf: Zotero.Item;
    let paper: Zotero.Item;
    let archive: Uint8Array;

    beforeEach(async function () {
      previous = Object.fromEntries(
        ["Zotero", "IOUtils", "addon", "fetch", "ztoolkit", "setImmediate"].map(
          (key) => [key, globals[key]],
        ),
      );
      // JSZip's postMessage scheduler stalls in privileged chrome test windows.
      globals.setImmediate = (callback: () => void) => setTimeout(callback, 0);
      getPdfs = PDFExtractor.getAllPdfAttachments;
      readCache = MineruMarkdownSaver.readCachedMarkdown;
      save = MineruMarkdownSaver.save;
      enabled = MineruMarkdownSaver.isSaveEnabled;
      saveCount = 0;
      fetchCount = 0;
      pdf = {
        id: 2,
        dateAdded: "2026-01-01T00:00:00Z",
        attachmentContentType: "application/pdf",
        getField: () => "Fixture PDF",
        getFilePathAsync: async () => "/fixture/paper.pdf",
      } as unknown as Zotero.Item;
      paper = { id: 1, getAttachments: () => [2] } as Zotero.Item;
      globals.Zotero = {
        Prefs: {
          get: (key: string) =>
            key.endsWith("mineruApiKey") ? "fixture-key" : undefined,
        },
        Items: { getAsync: async () => pdf },
      };
      globals.addon = { data: {} };
      globals.ztoolkit = { log: () => {} };
      globals.IOUtils = { read: async () => new Uint8Array([37, 80, 68, 70]) };
      PDFExtractor.getAllPdfAttachments = async () => [pdf];
      MineruMarkdownSaver.readCachedMarkdown = async () => null;
      MineruMarkdownSaver.isSaveEnabled = () => true;
      MineruMarkdownSaver.save = async () => {
        saveCount++;
        return {};
      };
      const zip = new JSZip();
      zip.file("full.md", "# Original evidence\nRead-only OCR result.");
      archive = await zip.generateAsync({ type: "uint8array" });
    });

    afterEach(function () {
      Object.assign(globals, previous);
      PDFExtractor.getAllPdfAttachments = getPdfs;
      MineruMarkdownSaver.readCachedMarkdown = readCache;
      MineruMarkdownSaver.isSaveEnabled = enabled;
      MineruMarkdownSaver.save = save;
    });

    function responseFor(url: string) {
      if (url.includes("file-urls"))
        return {
          ok: true,
          json: async () => ({
            data: {
              batch_id: "fixture",
              file_urls: ["https://example.invalid/upload"],
            },
          }),
        };
      if (url.endsWith("/upload")) return { ok: true };
      if (url.includes("extract-results"))
        return {
          ok: true,
          json: async () => ({
            data: {
              extract_result: [
                {
                  state: "done",
                  full_zip_url: "https://example.invalid/result.zip",
                },
              ],
            },
          }),
        };
      return { ok: true, arrayBuffer: async () => archive };
    }

    it("uploads and reads fresh OCR output without saving a note, attachment or external copy", async function () {
      globals.fetch = async (url: string, options: RequestInit) => {
        fetchCount++;
        expect(options.signal).to.be.instanceOf(AbortSignal);
        return responseFor(url);
      };
      const result = await MineruClient.extractMarkdown(paper, undefined, {
        persist: false,
      });
      expect(result).to.contain("Read-only OCR result.");
      expect(fetchCount).to.equal(4);
      expect(saveCount).to.equal(0);
    });

    it("aborts a pending HTTP request and prevents upload, polling and saves", async function () {
      const controller = new AbortController();
      globals.fetch = async (_url: string, options: RequestInit) => {
        fetchCount++;
        return await new Promise((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(new Error("fixture HTTP aborted")),
            { once: true },
          );
          controller.abort(new Error("fixture cancelled"));
        });
      };
      await rejects(
        MineruClient.extractMarkdown(paper, undefined, {
          persist: false,
          abortSignal: controller.signal,
        }),
        "aborted",
      );
      expect(fetchCount).to.equal(1);
      expect(saveCount).to.equal(0);
    });

    it("cancels the polling delay immediately without issuing another request", async function () {
      const controller = new AbortController();
      globals.fetch = async (url: string) => {
        fetchCount++;
        if (url.includes("extract-results")) {
          setTimeout(() => controller.abort(new Error("fixture cancelled")), 5);
          return {
            ok: true,
            json: async () => ({ data: { state: "running" } }),
          };
        }
        return responseFor(url);
      };
      const startedAt = Date.now();
      await rejects(
        MineruClient.extractMarkdown(paper, undefined, {
          persist: false,
          abortSignal: controller.signal,
        }),
        "cancelled",
      );
      expect(Date.now() - startedAt).to.be.lessThan(1000);
      expect(fetchCount).to.equal(3);
      expect(saveCount).to.equal(0);
    });

    it("never starts extraction or network work for an already cancelled request", async function () {
      const controller = new AbortController();
      controller.abort(new Error("fixture cancelled"));
      globals.fetch = async () => {
        fetchCount++;
        throw new Error("Unexpected request");
      };
      await rejects(
        MineruClient.extractMarkdown(paper, undefined, {
          persist: false,
          abortSignal: controller.signal,
        }),
        "cancelled",
      );
      expect(fetchCount).to.equal(0);
      expect(saveCount).to.equal(0);
    });

    it("does not fall back to Zotero text indexing when MinerU was cancelled", async function () {
      const originalExtract = MineruClient.extractMarkdown;
      const controller = new AbortController();
      try {
        MineruClient.extractMarkdown = async (_item, _progress, options) => {
          expect(options?.abortSignal).to.equal(controller.signal);
          expect(options?.persist).to.equal(false);
          controller.abort(new Error("fixture cancelled"));
          throw new Error("fixture cancelled");
        };
        await rejects(
          PDFExtractor.extractTextFromItem(paper, "mineru", undefined, {
            persist: false,
            abortSignal: controller.signal,
          }),
          "cancelled",
        );
        expect(fetchCount).to.equal(0);
        expect(saveCount).to.equal(0);
      } finally {
        MineruClient.extractMarkdown = originalExtract;
      }
    });
  });
});
