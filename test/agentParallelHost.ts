import { AgentService } from "../src/modules/agent/AgentService";
import { LLMService } from "../src/modules/llmService";
import { AgentView } from "../src/modules/views/agent/AgentView";

/** Scripted model with the real Zotero/Gecko HTTP caller, in an isolated profile. */
export async function runAgentParallelHostChecks(
  doc: Document,
  assert: (value: boolean, name: string) => void,
  fixtureUrl: string,
): Promise<void> {
  const service = AgentService.getInstance();
  await service.ready();
  const originalTurn = LLMService.agentTurn;
  const originalRequest = Zotero.HTTP.request;
  const session = service.createSession();
  let view: AgentView | undefined;
  let routed = 0;
  try {
    Zotero.HTTP.request = ((method, url, options) => {
      if (url === "https://search.parallel.ai/mcp") {
        routed++;
        return originalRequest.call(
          Zotero.HTTP,
          method,
          fixtureUrl + "/mcp",
          options,
        );
      }
      return originalRequest.call(Zotero.HTTP, method, url, options);
    }) as typeof Zotero.HTTP.request;
    LLMService.agentTurn = async (request) => {
      const results = request.messages.filter(
        (message) => message.role === "tool",
      );
      if (results.length < 2) {
        const name = results.length ? "web_fetch" : "web_search";
        return {
          text: "",
          toolCalls: [
            {
              id: "native-" + results.length,
              name,
              arguments: JSON.stringify(
                results.length
                  ? { urls: ["https://example.org/native-paper"] }
                  : {
                      objective: "Native fixture",
                      search_queries: ["native fixture"],
                    },
              ),
            },
          ],
        };
      }
      assert(
        results.every((message) =>
          message.content.includes("NATIVE_MCP_EVIDENCE"),
        ),
        "agentParallelNativeResultConsumption",
      );
      return {
        text: "[Native source](https://example.org/native-paper)",
        toolCalls: [],
      };
    };
    await service.run(session.id, "Public native fixture", {
      endpointId: "fixture",
    });
    assert(
      session.status === "completed" && routed === 8,
      "agentParallelNativeCaller",
    );
    const observed = await originalRequest.call(
      Zotero.HTTP,
      "GET",
      fixtureUrl + "/mcp-requests",
      { responseType: "text" },
    );
    const requests = JSON.parse(observed.responseText || "[]") as {
      userAgent: string;
      method: string;
      arguments?: { session_id?: string };
    }[];
    assert(
      requests.length === 8 &&
        requests.every((entry) => entry.userAgent === "zotero-ai-butler/5.1.1"),
      "agentParallelNativeUserAgent",
    );
    const ids = requests
      .filter((entry) => entry.method === "tools/call")
      .map((entry) => entry.arguments?.session_id);
    assert(
      ids.length === 2 &&
        ids[0] === session.webSearchSessionId &&
        ids[0] === ids[1],
      "agentParallelNativeConversation",
    );
    LLMService.agentTurn = async (request) => {
      assert(
        !request.tools.some((tool) => /^web_/.test(tool.name)),
        "agentParallelNativeDisabled",
      );
      return { text: "Local evidence only.", toolCalls: [] };
    };
    await service.run(session.id, "Local follow-up", {
      endpointId: "fixture",
      webSearch: "disabled",
    });
    assert(routed === 8, "agentParallelDisabledNoHTTP");

    view = new AgentView();
    const root = view.render();
    doc.documentElement.appendChild(root);
    await new Promise<void>((resolve) =>
      doc.defaultView!.setTimeout(resolve, 100),
    );
    const picker = root.querySelector<HTMLButtonElement>(
      '[role="combobox"][data-value="disabled"]',
    );
    assert(Boolean(picker), "agentParallelSavedSelector");
    picker!.click();
    const option = root.querySelector<HTMLElement>(
      '[role="option"][data-value="parallel"]',
    );
    option!.click();
    assert(
      picker!.getAttribute("data-value") === "parallel",
      "agentParallelNativeSelectorClick",
    );
  } finally {
    view?.destroy();
    service.stop(session.id);
    await service.deleteSession(session.id);
    LLMService.agentTurn = originalTurn;
    Zotero.HTTP.request = originalRequest;
  }
}
