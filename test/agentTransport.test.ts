import { expect } from "chai";
import type {
  LLMAgentMessage,
  LLMToolDefinition,
} from "../src/modules/llmproviders/agentTypes";
import { AgentProtocolError } from "../src/modules/llmproviders/shared/agentErrors";
import {
  buildAgentHttpRequest,
  isAgentContextOverflow,
  parseAgentTurn,
  requestAgentTurn,
  validateAgentMessages,
  validateAgentTurn,
} from "../src/modules/llmproviders/shared/agentTransport";

const tools: LLMToolDefinition[] = [
  {
    name: "search_library",
    description: "Search titles",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
];
const call = {
  id: "call-1",
  name: "search_library",
  arguments: '{"query":"biology"}',
};
const options = {
  apiUrl: "https://example.invalid/v1",
  apiKey: "test-placeholder",
  model: "test-model",
  maxTokens: 2048,
};
const conversation: LLMAgentMessage[] = [
  { role: "system", content: "Use the library." },
  { role: "user", content: "Find papers." },
  {
    role: "assistant",
    content: "",
    toolCalls: [call],
    reasoningContent: "Search first.",
  },
  { role: "tool", toolCallId: call.id, content: '{"items":[]}' },
];

function completion(overrides: Record<string, unknown> = {}) {
  return {
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          reasoning_content: "Search first.",
          tool_calls: [
            {
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.arguments },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
    ...overrides,
  };
}

describe("Native Agent transport", function () {
  it("keeps overflow classification stable when the visible error is localized", function () {
    const globals = globalThis as unknown as Record<string, unknown>;
    const previous = globals.addon;
    globals.addon = {
      data: {
        locale: {
          current: {
            formatMessagesSync: () => [
              { value: "上下文超出限制", attributes: [] },
            ],
          },
        },
      },
    };
    try {
      const error = new AgentProtocolError("context-overflow");
      expect(error.message).to.equal("上下文超出限制");
      expect(error.code).to.equal("context-overflow");
      expect(isAgentContextOverflow(error)).to.equal(true);
    } finally {
      if (previous === undefined) delete globals.addon;
      else globals.addon = previous;
    }
  });

  it("sanitizes transport failures and only trusts typed safe protocol errors", async function () {
    const globals = globalThis as unknown as Record<string, unknown>;
    const previous = globals.Zotero;
    const failures = [
      {
        error: new Error("Agent confidential-api-key"),
        code: "request-failed",
      },
      { error: { status: "confidential-api-key" }, code: "request-failed" },
      {
        error: { status: 401, body: "confidential-api-key" },
        code: "http-error",
      },
      { error: new AgentProtocolError("invalid-json"), code: "invalid-json" },
    ];
    try {
      for (const failure of failures) {
        globals.Zotero = {
          HTTP: {
            request: async () => {
              throw failure.error;
            },
          },
        };
        let caught: unknown;
        try {
          await requestAgentTurn("openai-compat", conversation, tools, options);
        } catch (error) {
          caught = error;
        }
        expect(caught).to.be.instanceOf(AgentProtocolError);
        expect((caught as AgentProtocolError).code).to.equal(failure.code);
        expect((caught as Error).message).not.to.include(
          "confidential-api-key",
        );
      }
    } finally {
      if (previous === undefined) delete globals.Zotero;
      else globals.Zotero = previous;
    }
  });

  it("classifies structured context overflow without exposing request data", function () {
    const httpError = {
      status: 400,
      xmlhttp: {
        responseText: JSON.stringify({
          error: {
            code: "context_length_exceeded",
            message: "long confidential request body",
          },
        }),
      },
    };
    expect(isAgentContextOverflow(httpError)).to.equal(true);
    expect(
      isAgentContextOverflow({
        status: 401,
        xmlhttp: {
          responseText: JSON.stringify({
            error: { code: "invalid_api_key", message: "secret token" },
          }),
        },
      }),
    ).to.equal(false);
    expect(
      isAgentContextOverflow({
        xmlhttp: { responseText: "<html>context length secret</html>" },
      }),
    ).to.equal(false);
    expect(() =>
      parseAgentTurn("chat", {
        error: { code: "context_length_exceeded", message: "confidential" },
      }),
    )
      .to.throw(AgentProtocolError)
      .and.include({
        code: "context-overflow",
        message: new AgentProtocolError("context-overflow").message,
      });
  });

  it("preserves calls, results and compatibility-model reasoning on the wire", function () {
    const request = buildAgentHttpRequest(
      "openai-compat",
      conversation,
      tools,
      options,
    );
    expect(request.url).to.equal("https://example.invalid/v1/chat/completions");
    expect(request.body.stream).to.equal(false);
    expect(request.body.max_tokens).to.equal(2048);
    const messages = request.body.messages as Record<string, unknown>[];
    expect(messages[2].reasoning_content).to.equal("Search first.");
    expect(messages[3].tool_call_id).to.equal("call-1");
    expect(messages[2].tool_calls).to.deep.equal([
      {
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      },
    ]);
  });

  it("parses token usage and parallel native calls", function () {
    const data = completion();
    data.choices[0].message.tool_calls.push({
      id: "call-2",
      type: "function",
      function: { name: call.name, arguments: '{"query":"physics"}' },
    });
    const turn = validateAgentTurn(parseAgentTurn("chat", data), tools);
    expect(turn.toolCalls.map((tool) => tool.id)).to.deep.equal([
      "call-1",
      "call-2",
    ]);
    expect(turn.reasoningContent).to.equal("Search first.");
    expect(turn.usage).to.deep.equal({
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
    });
  });

  it("rejects truncated calls even when their JSON happens to be valid", function () {
    const data = completion();
    data.choices[0].finish_reason = "length";
    expect(() => parseAgentTurn("chat", data))
      .to.throw(AgentProtocolError)
      .with.property("code", "truncated-turn");
  });

  it("rejects malformed JSON, non-object arguments, unknown tools and duplicate IDs", function () {
    for (const argumentsValue of ['{"query":', "null", "[]"]) {
      expect(() =>
        validateAgentTurn(
          { text: "", toolCalls: [{ ...call, arguments: argumentsValue }] },
          tools,
        ),
      )
        .to.throw(AgentProtocolError)
        .with.property("code", "invalid-arguments");
    }
    expect(() =>
      validateAgentTurn(
        { text: "", toolCalls: [{ ...call, name: "delete_library" }] },
        tools,
      ),
    )
      .to.throw(AgentProtocolError)
      .with.property("code", "invalid-call");
    expect(() =>
      validateAgentTurn({ text: "", toolCalls: [call, call] }, tools),
    )
      .to.throw(AgentProtocolError)
      .with.property("code", "invalid-call");
    expect(() =>
      validateAgentTurn(
        {
          text: "",
          toolCalls: Array.from({ length: 33 }, (_, index) => ({
            ...call,
            id: `oversized-${index}`,
          })),
        },
        tools,
      ),
    )
      .to.throw(AgentProtocolError)
      .with.property("code", "malformed-calls");
  });

  it("rejects orphan and incomplete history, including interruption between calls and results", function () {
    expect(() => validateAgentMessages([conversation[3]]))
      .to.throw(AgentProtocolError)
      .with.property("code", "orphan-result");
    expect(() => validateAgentMessages(conversation.slice(0, 3)))
      .to.throw(AgentProtocolError)
      .with.property("code", "unresolved-calls");
    expect(() =>
      validateAgentMessages([
        ...conversation.slice(0, 3),
        { role: "user", content: "Continue" },
        conversation[3],
      ]),
    )
      .to.throw(AgentProtocolError)
      .with.property("code", "unresolved-calls");
    expect(() => validateAgentMessages(conversation)).not.to.throw();
  });

  it("does not allow vendor settings to replace messages, tools or streaming policy", function () {
    const request = buildAgentHttpRequest(
      "openai-compat",
      conversation,
      tools,
      { ...options, vendorOptions: { messages: [], tools: [], stream: true } },
    );
    expect(request.body.messages).to.have.length(4);
    expect(request.body.tools).to.have.length(1);
    expect(request.body.stream).to.equal(false);
  });

  it("maps configured VolcanoArk and Ollama endpoints without changing their origin", function () {
    expect(
      buildAgentHttpRequest("volcanoark", conversation, tools, {
        ...options,
        apiUrl: "https://example.invalid/api/v3/responses",
      }).url,
    ).to.equal("https://example.invalid/api/v3/chat/completions");
    expect(
      buildAgentHttpRequest("ollama", conversation, tools, {
        ...options,
        apiUrl: "http://localhost:11434/api/chat",
        apiKey: "",
      }).url,
    ).to.equal("http://localhost:11434/v1/chat/completions");
  });

  it("rejects invalid endpoints for every protocol without exposing the configured URL", function () {
    for (const providerId of [
      "openai",
      "openai-compat",
      "google",
      "anthropic",
    ]) {
      for (const apiUrl of [
        "invalid confidential-credential",
        "file:///secret",
      ]) {
        expect(() =>
          buildAgentHttpRequest(providerId, conversation, tools, {
            ...options,
            apiUrl,
          }),
        )
          .to.throw(AgentProtocolError)
          .with.property("code", "invalid-url");
      }
    }
  });

  it("preserves Responses function call IDs and encrypted reasoning without server storage", function () {
    const reasoning = {
      type: "reasoning",
      id: "rs-1",
      encrypted_content: "opaque",
      summary: [],
    };
    const turn = validateAgentTurn(
      parseAgentTurn("responses", {
        status: "completed",
        output: [
          reasoning,
          {
            type: "function_call",
            call_id: call.id,
            name: call.name,
            arguments: call.arguments,
          },
        ],
        usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 },
      }),
      tools,
    );
    expect(turn.toolCalls[0]).to.deep.equal(call);
    const messages = conversation.map((message) =>
      message.role === "assistant"
        ? { ...message, providerState: turn.providerState }
        : message,
    );
    const request = buildAgentHttpRequest("openai", messages, tools, options);
    expect(request.body.store).to.equal(false);
    expect(request.body.input).to.deep.include(reasoning);
    expect(request.body.input).to.deep.include({
      type: "function_call_output",
      call_id: call.id,
      output: conversation[3].content,
    });
  });

  it("rejects incomplete Responses output before exposing its tool call", function () {
    expect(() =>
      parseAgentTurn("responses", {
        status: "incomplete",
        output: [
          {
            type: "function_call",
            call_id: call.id,
            name: call.name,
            arguments: call.arguments,
          },
        ],
      }),
    )
      .to.throw(AgentProtocolError)
      .with.property("code", "responses-incomplete");
    expect(() =>
      parseAgentTurn("responses", {
        status: "completed",
        output: [{ type: "function_call", call_id: call.id, name: call.name }],
      }),
    )
      .to.throw(AgentProtocolError)
      .with.property("code", "responses-malformed-call");
  });

  it("keeps Anthropic signed thinking blocks and groups tool results", function () {
    const parts = [
      { type: "thinking", thinking: "Plan", signature: "signed" },
      {
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: { query: "biology" },
      },
    ];
    const turn = validateAgentTurn(
      parseAgentTurn("anthropic", {
        stop_reason: "tool_use",
        content: parts,
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
      tools,
    );
    const messages = conversation.map((message) =>
      message.role === "assistant"
        ? { ...message, providerState: turn.providerState }
        : message,
    );
    const request = buildAgentHttpRequest(
      "anthropic",
      messages,
      tools,
      options,
    );
    expect(request.headers.Authorization).to.equal(undefined);
    expect(request.headers["anthropic-version"]).to.equal("2023-06-01");
    const native = request.body.messages as Record<string, unknown>[];
    expect(native[1].content).to.deep.equal(parts);
    expect(native[2].content).to.deep.equal([
      {
        type: "tool_result",
        tool_use_id: call.id,
        content: conversation[3].content,
      },
    ]);
  });

  it("round-trips Gemini thought signatures with tool responses", function () {
    const parts = [
      {
        functionCall: {
          id: call.id,
          name: call.name,
          args: { query: "biology" },
        },
        thoughtSignature: "signed",
      },
    ];
    const turn = validateAgentTurn(
      parseAgentTurn("google", {
        candidates: [
          { finishReason: "STOP", content: { role: "model", parts } },
        ],
        usageMetadata: {
          promptTokenCount: 8,
          candidatesTokenCount: 3,
          totalTokenCount: 11,
        },
      }),
      tools,
    );
    const messages = conversation.map((message) =>
      message.role === "assistant"
        ? { ...message, providerState: turn.providerState }
        : message,
    );
    const request = buildAgentHttpRequest("google", messages, tools, {
      ...options,
      apiUrl: "https://example.invalid",
    });
    const native = request.body.contents as Record<string, unknown>[];
    expect(native[1].parts).to.deep.equal(parts);
    expect(native[2].parts).to.deep.equal([
      {
        functionResponse: {
          id: call.id,
          name: call.name,
          response: { result: conversation[3].content },
        },
      },
    ]);
    expect(request.url).to.equal(
      "https://example.invalid/v1beta/models/test-model:generateContent",
    );
  });

  it("rejects empty successful turns and missing declared tool calls", function () {
    expect(() => validateAgentTurn({ text: "", toolCalls: [] }, tools))
      .to.throw(AgentProtocolError)
      .with.property("code", "empty-turn");
    expect(() =>
      parseAgentTurn("chat", {
        choices: [
          {
            finish_reason: "tool_calls",
            message: { role: "assistant", content: "" },
          },
        ],
      }),
    )
      .to.throw(AgentProtocolError)
      .with.property("code", "missing-declared-calls");
  });
});
