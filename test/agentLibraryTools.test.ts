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
        Items: {
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
        Libraries: { isEditable: () => editable },
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
            }));
            try {
              return await operation();
            } catch (error) {
              rollbackCount++;
              for (const entry of snapshot) {
                const item = items.get(entry.id)!;
                item.tags = entry.tags;
                item.collections = entry.collections;
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
