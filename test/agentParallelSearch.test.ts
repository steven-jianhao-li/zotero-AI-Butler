import { expect } from "chai";
import { AgentService } from "../src/modules/agent/AgentService";
import { LLMService } from "../src/modules/llmService";
import type { LLMAgentRequest } from "../src/modules/llmService";
import type { AgentSession } from "../src/modules/agent/types";

type Request = {
  url: string;
  headers: Record<string, string>;
  message: {
    id?: number;
    method: string;
    params?: Record<string, any>;
  };
};

describe("Agent Parallel search through the service and tool loop", function () {
  const globals = globalThis as unknown as Record<string, any>;
  let previous: Record<string, any>;
  let originalTurn: typeof LLMService.agentTurn;
  let originalEndpoint: typeof LLMService.acquireChatSessionEndpoint;
  let requests: Request[];
  let snapshots: Map<string, string>;
  let fail: string;
  let aborts: number;
  let entered: (() => void) | undefined;
  let uuid = 0;
  const endpoint = "https://search.parallel.ai/mcp";

  beforeEach(function () {
    previous = Object.fromEntries(
      ["Zotero", "Services", "IOUtils", "PathUtils", "addon", "ztoolkit"].map(
        (key) => [key, globals[key]],
      ),
    );
    (AgentService as any).instance = undefined;
    originalTurn = LLMService.agentTurn;
    originalEndpoint = LLMService.acquireChatSessionEndpoint;
    requests = [];
    snapshots = new Map();
    fail = "";
    aborts = 0;
    globals.addon = { data: {} };
    globals.ztoolkit = { log() {} };
    globals.Services = {
      uuid: {
        generateUUID: () =>
          "{00000000-0000-4000-8000-" + String(++uuid).padStart(12, "0") + "}",
      },
    };
    globals.PathUtils = {
      join: (...parts: string[]) => parts.join("/"),
      filename: (path: string) => path.split("/").pop(),
    };
    globals.IOUtils = {
      exists: async () => snapshots.size > 0,
      getChildren: async () => [...snapshots.keys()],
      readUTF8: async (path: string) => snapshots.get(path),
      makeDirectory: async () => {},
      writeUTF8: async (path: string, text: string) => {
        snapshots.set(path, text);
      },
    };
    globals.Zotero = {
      Prefs: { get() {} },
      DataDirectory: { dir: "/fixture" },
      Libraries: { userLibraryID: 1, get: () => ({ libraryID: 1 }) },
      HTTP: {
        request: async (
          method: string,
          url: string,
          options: Record<string, any>,
        ) => {
          expect(method).to.equal("POST");
          expect(url).to.equal(endpoint);
          expect(options.timeout).to.equal(60000);
          expect(options.errorDelayMax).to.equal(0);
          expect(options.responseType).to.equal("text");
          expect(options.headers["User-Agent"]).to.equal(
            "zotero-ai-butler/5.1.1",
          );
          expect(options.headers.Authorization).to.equal(undefined);
          expect(options.headers.Accept).to.equal(
            "application/json, text/event-stream",
          );
          const message = JSON.parse(options.body);
          requests.push({ url, headers: { ...options.headers }, message });
          let rejectAbort: (error: Error) => void = () => {};
          const cancelled = new Promise<never>((_resolve, reject) => {
            rejectAbort = reject;
          });
          options.requestObserver({
            abort: () => {
              aborts++;
              rejectAbort(new Error("XHR aborted"));
            },
          });
          if (fail === "abort" && message.method === "tools/call") {
            entered?.();
            return cancelled;
          }
          if (message.method === "tools/call" && fail === "quota")
            throw { status: 429 };
          if (message.method === "tools/call" && fail === "timeout")
            throw { name: "TimeoutException" };
          if (message.method === "tools/call" && fail === "network")
            throw new Error("Network fixture unavailable");
          let result: unknown;
          if (message.method === "initialize") {
            expect(message.params.clientInfo.name).to.equal("zotero-ai-butler");
            expect(message.params.capabilities).to.deep.equal({});
            result = {
              protocolVersion: "2025-03-26",
              capabilities: { tools: {} },
            };
          } else if (message.method === "notifications/initialized") {
            expect(message.id).to.equal(undefined);
            return { responseText: "", getResponseHeader: () => null };
          } else if (message.method === "tools/list") {
            result = {
              tools:
                fail === "missing-tool"
                  ? []
                  : [{ name: "web_search" }, { name: "web_fetch" }],
            };
          } else {
            expect(message.method).to.equal("tools/call");
            const args = message.params.arguments;
            expect(args.session_id).to.match(
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
            );
            result = {
              isError: fail === "tool-error",
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    title: "Research fixture",
                    url: "https://example.org/paper",
                    excerpts: [args.objective || "FETCHED_EVIDENCE"],
                  }),
                },
              ],
            };
          }
          const body =
            fail === "malformed" && message.method === "tools/call"
              ? "not valid MCP"
              : JSON.stringify({
                  jsonrpc: "2.0",
                  id: fail === "wrong-id" ? -1 : message.id,
                  result,
                });
          return {
            // Exercise both allowed response types and SSE progress notifications.
            responseText:
              message.method === "tools/call"
                ? 'event: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\nevent: message\r\ndata: ' +
                  body +
                  "\r\n\r\n"
                : body,
            getResponseHeader: (header: string) =>
              header === "Mcp-Session-Id" ? "connection-fixture" : null,
          };
        },
      },
    };
    LLMService.acquireChatSessionEndpoint = () =>
      ({ id: "saved-model" }) as any;
  });

  afterEach(function () {
    AgentService.shutdown();
    (AgentService as any).instance = undefined;
    LLMService.agentTurn = originalTurn;
    LLMService.acquireChatSessionEndpoint = originalEndpoint;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globals[key];
      else globals[key] = value;
    }
  });

  function call(name: string, args: Record<string, unknown>) {
    return {
      text: "",
      toolCalls: [
        { id: "call-" + Math.random(), name, arguments: JSON.stringify(args) },
      ],
    };
  }

  function researchModel() {
    LLMService.agentTurn = async (request: LLMAgentRequest) => {
      const tools = request.messages.filter(
        (message) => message.role === "tool",
      );
      const lastUser =
        request.messages.filter((message) => message.role === "user").at(-1)
          ?.content || "research";
      if (!tools.length)
        return call("web_search", {
          objective: lastUser,
          search_queries: ["research fixture"],
        });
      if (tools.length === 1) {
        expect(tools[0].content).to.include("https://example.org/paper");
        return call("web_fetch", { urls: ["https://example.org/paper"] });
      }
      expect(tools.at(-1)?.content).to.include("FETCHED_EVIDENCE");
      return {
        text: "Evidence: [paper](https://example.org/paper)",
        toolCalls: [],
      };
    };
  }

  async function fresh() {
    const service = AgentService.getInstance();
    await service.ready();
    const session = service.createSession();
    return { service, session };
  }

  it("loads the unconfigured provider, discovers tools, searches, fetches and consumes evidence", async function () {
    researchModel();
    const { service, session } = await fresh();
    const savedOptions = {
      endpointId: "explicit-model",
      pdfPolicy: "text" as const,
    };
    await service.run(session.id, "Current public research", savedOptions);
    expect(session.status).to.equal("completed");
    expect(session.options.webSearch).to.equal("parallel");
    expect(session.activeEndpointId).to.equal("explicit-model");
    expect(session.options.pdfPolicy).to.equal("text");
    expect(session.permission).to.equal("read-only");
    expect(Object.values(session.artifacts).join(" ")).to.include(
      "FETCHED_EVIDENCE",
    );
    expect(session.messages.at(-1)?.content).to.include(
      "https://example.org/paper",
    );
    expect(requests.map((r) => r.message.method)).to.deep.equal([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call",
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call",
    ]);
    for (const request of requests.filter(
      (r) => r.message.method !== "initialize",
    )) {
      expect(request.headers["Mcp-Session-Id"]).to.equal("connection-fixture");
      expect(request.headers["MCP-Protocol-Version"]).to.equal("2025-03-26");
    }
    const ids = requests
      .filter((r) => r.message.method === "tools/call")
      .map((r) => r.message.params?.arguments.session_id);
    expect(new Set(ids).size).to.equal(1);
    console.log(
      "PARALLEL_CALLER_OBSERVED " +
        JSON.stringify({
          userAgent: requests[0].headers["User-Agent"],
          callerPath: "src/modules/agent/tools/parallelSearchTools.ts",
          requestObserved: true,
          endpoint,
          methods: requests.map((r) => r.message.method),
          resultConsumed: session.messages.at(-1)?.content,
        }),
    );
  });

  it("preserves a saved disabled choice across restarts, permission changes and explicit overrides", async function () {
    const { service, session } = await fresh();
    session.options.webSearch = "disabled";
    let turns = 0;
    LLMService.agentTurn = async (request) => {
      expect(request.tools.some((tool) => /^web_/.test(tool.name))).to.equal(
        false,
      );
      return turns++ === 0
        ? call("web_search", { objective: "Public", search_queries: ["query"] })
        : { text: "Local only.", toolCalls: [] };
    };
    await service.run(session.id, "Local research", { permission: "full" });
    expect(requests).to.have.length(0);
    expect(session.messages.find((m) => m.role === "tool")?.content).to.include(
      "unavailable",
    );
    expect(session.webSearchSessionId).to.equal(undefined);
    (AgentService as any).instance = undefined;
    const restored = AgentService.getInstance();
    await restored.ready();
    const loaded = restored.getSession(session.id)!;
    expect(loaded.options.webSearch).to.equal("disabled");
    turns = 2;
    await restored.run(loaded.id, "Still local", { permission: "confirm" });
    expect(requests).to.have.length(0);
    researchModel();
    const enabled = restored.createSession();
    enabled.options.webSearch = "disabled";
    await restored.run(enabled.id, "Explicitly enable", {
      webSearch: "parallel",
    });
    expect(enabled.status).to.equal("completed");
    expect(enabled.options.webSearch).to.equal("parallel");
  });

  it("isolates interleaved conversations on the shared client and keeps identity for follow-ups", async function () {
    researchModel();
    const { service, session: a } = await fresh();
    const b = service.createSession();
    await Promise.all([
      service.run(a.id, "Conversation A"),
      service.run(b.id, "Conversation B"),
    ]);
    expect(a.status).to.equal("completed");
    expect(b.status).to.equal("completed");
    expect(a.webSearchSessionId).not.to.equal(b.webSearchSessionId);
    const identity = a.webSearchSessionId;
    LLMService.agentTurn = async (request) => {
      const last = request.messages.at(-1);
      return last?.role === "user"
        ? call("web_search", {
            objective: "Follow up A",
            search_queries: ["follow up"],
          })
        : { text: "Follow-up evidence.", toolCalls: [] };
    };
    await service.run(a.id, "Follow up");
    expect(a.webSearchSessionId).to.equal(identity);
    const calls = requests.filter((r) => r.message.method === "tools/call");
    for (const r of calls) {
      const args = r.message.params?.arguments;
      if (/Conversation A|Follow up A/.test(args.objective || ""))
        expect(args.session_id).to.equal(a.webSearchSessionId);
      if (args.objective === "Conversation B")
        expect(args.session_id).to.equal(b.webSearchSessionId);
    }
    const c = service.createSession();
    await service.run(c.id, "New chat");
    expect(c.webSearchSessionId).not.to.equal(identity);
  });

  for (const failure of [
    "quota",
    "timeout",
    "network",
    "tool-error",
    "malformed",
    "wrong-id",
    "missing-tool",
  ]) {
    it(
      "surfaces " +
        failure +
        " without fallback or losing the conversation identity",
      async function () {
        const { service, session } = await fresh();
        fail = failure;
        let turns = 0;
        LLMService.agentTurn = async () =>
          turns++ === 0
            ? call("web_search", {
                objective: "Research",
                search_queries: ["fixture"],
              })
            : { text: "Search failed; no external evidence.", toolCalls: [] };
        await service.run(session.id, "Research");
        const result =
          session.messages.find((m) => m.role === "tool")?.content || "";
        expect(result).to.include("error");
        expect(result).not.to.include("Research fixture");
        const identity = session.webSearchSessionId;
        fail = "";
        LLMService.agentTurn = async (request) =>
          request.messages.at(-1)?.role === "user"
            ? call("web_search", {
                objective: "Retry",
                search_queries: ["retry"],
              })
            : { text: "Retry completed.", toolCalls: [] };
        await service.run(session.id, "Retry");
        expect(session.webSearchSessionId).to.equal(identity);
        expect(
          requests.filter((r) => r.message.method === "tools/call").at(-1)
            ?.message.params?.arguments.session_id,
        ).to.equal(identity);
      },
    );
  }

  it("cancels the native request and retains the same identity on a later retry", async function () {
    const { service, session } = await fresh();
    fail = "abort";
    LLMService.agentTurn = async () =>
      call("web_search", {
        objective: "Research",
        search_queries: ["fixture"],
      });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const running = service.run(session.id, "Research");
    await started;
    const identity = session.webSearchSessionId;
    service.stop(session.id);
    await running;
    expect(aborts).to.equal(1);
    expect(session.status).to.equal("cancelled");
    expect(session.webSearchSessionId).to.equal(identity);
    fail = "";
    LLMService.agentTurn = async () => ({
      text: "Continue locally.",
      toolCalls: [],
    });
    await service.run(session.id, "Retry");
    expect(session.webSearchSessionId).to.equal(identity);
  });

  for (const [label, url] of [
    ["file", "file:///private"],
    ["ftp", "ftp://example.org"],
    ["credentials", "https://user:secret@example.org"],
  ]) {
    it(
      "rejects unsafe fetch URL " + label + " before a request",
      async function () {
        const { service, session } = await fresh();
        let turns = 0;
        LLMService.agentTurn = async () =>
          turns++ === 0
            ? call("web_fetch", { urls: [url] })
            : { text: "URL rejected.", toolCalls: [] };
        await service.run(session.id, "Fetch");
        expect(requests).to.have.length(0);
        expect(
          session.messages.find((m) => m.role === "tool")?.content,
        ).to.include("error");
      },
    );
  }

  it("rejects invalid provider overrides before changing session state", async function () {
    const { service, session } = await fresh();
    try {
      await service.run(session.id, "Research", { webSearch: "other" as any });
      throw new Error("Invalid provider accepted");
    } catch (error) {
      expect(String(error)).to.include("Invalid web search provider");
    }
    expect(session.messages).to.have.length(0);
    expect(requests).to.have.length(0);
  });
});
