import assert from "node:assert/strict";
import process from "node:process";
import { test } from "node:test";
import { URL } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: `export * from "./src/modules/llmproviders/shared/openCodeGo";
export * from "./src/modules/llmproviders/openCodeGoModels";`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  plugins: [
    {
      name: "fixture-locale",
      setup(builder) {
        builder.onResolve({ filter: /utils\/locale$/ }, () => ({
          path: "locale",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: "export const getString = (id) => id;",
          loader: "js",
        }));
      },
    },
  ],
});

function load(code) {
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    ztoolkit: { log() {} },
    URL,
  });
  return module.exports;
}

const api = load(bundle.outputFiles[0].text);
const DEFAULT_URL =
  "https://opencode.ai/inference/go/openai/v1/chat/completions";

test("resolves every documented Go gateway address variant", () => {
  assert.equal(api.resolveOpenCodeGoChatUrl(""), DEFAULT_URL);
  assert.equal(
    api.resolveOpenCodeGoChatUrl("https://opencode.ai/inference/go"),
    DEFAULT_URL,
  );
  assert.equal(
    api.resolveOpenCodeGoChatUrl("https://opencode.ai/inference"),
    DEFAULT_URL,
  );
  assert.equal(
    api.resolveOpenCodeGoChatUrl("https://opencode.ai/inference/go/"),
    DEFAULT_URL,
  );
  assert.equal(
    api.resolveOpenCodeGoChatUrl("https://opencode.ai/inference/go/openai/v1"),
    DEFAULT_URL,
  );
  assert.equal(
    api.resolveOpenCodeGoChatUrl(
      "https://opencode.ai/inference/go/openai/v1/chat/completions",
    ),
    DEFAULT_URL,
  );
});

test("keeps custom proxies on their own host", () => {
  assert.equal(
    api.resolveOpenCodeGoChatUrl("https://proxy.example/v1"),
    "https://proxy.example/v1/chat/completions",
  );
  assert.equal(
    api.resolveOpenCodeGoChatUrl("https://proxy.example/v1/chat/completions/"),
    "https://proxy.example/v1/chat/completions",
  );
  assert.equal(
    api.resolveOpenCodeGoChatUrl("https://opencode.ai/zen/go/v1"),
    "https://opencode.ai/zen/go/v1/chat/completions",
  );
});

test("detects endpoints served by the Go gateway", () => {
  for (const url of [
    "https://opencode.ai/inference/go/openai/v1/chat/completions",
    "https://opencode.ai/inference/go/openai/v1/responses",
    "https://opencode.ai/inference/go/anthropic",
    "https://opencode.ai/inference/go/google",
    "https://opencode.ai/zen/go/v1",
  ]) {
    assert.equal(api.isOpenCodeGoGatewayUrl(url), true, url);
  }
  for (const url of [
    "",
    "https://opencode.ai/inference/openai/v1",
    "https://api.openai.com/v1/chat/completions",
    "https://example.invalid/inference/go",
    "not a url",
  ]) {
    assert.equal(api.isOpenCodeGoGatewayUrl(url), false, url);
  }
});

test("adds every OpenCode Go protocol header", () => {
  const headers = api.buildOpenCodeGoHeaders("sk-test");
  assert.equal(headers.Authorization, "Bearer sk-test");
  assert.equal(headers["Content-Type"], "application/json");
  assert.match(headers["User-Agent"], /^zotero-ai-butler\/\d+\.\d+/);
  assert.equal(headers["x-opencode-client"], "zotero-ai-butler");
  assert.equal(headers["x-opencode-project"], "global");
  assert.match(headers["x-opencode-session"], /^ses_[a-z0-9]+$/);
  assert.match(headers["x-opencode-request"], /^msg_[a-z0-9]+$/);
});

test("custom headers override generated Go headers case-insensitively", () => {
  const headers = api.buildOpenCodeGoHeaders("sk-test", {
    "user-agent": "my-agent/2.0",
    "X-OpenCode-Session": "ses_custom",
    "x-opencode-client": "my-client",
    "x-opencode-project": "my-project",
  });
  assert.equal(headers["user-agent"], "my-agent/2.0");
  assert.equal(headers["X-OpenCode-Session"], "ses_custom");
  assert.equal(headers["x-opencode-client"], "my-client");
  assert.equal(headers["x-opencode-project"], "my-project");
  const names = Object.keys(headers).map((name) => name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
});

test("the cross-protocol injection only adds the Go protocol headers", () => {
  const headers = api.withOpenCodeGoHeaders({ "X-Extra": "1" });
  assert.match(headers["User-Agent"], /^zotero-ai-butler\//);
  assert.equal(headers["x-opencode-client"], "zotero-ai-butler");
  assert.equal(headers["x-opencode-project"], "global");
  assert.match(headers["x-opencode-session"], /^ses_/);
  assert.match(headers["x-opencode-request"], /^msg_/);
  assert.equal(headers["X-Extra"], "1");
  assert.equal(headers.Authorization, undefined);
  assert.equal(headers["x-api-key"], undefined);
  assert.equal(headers["x-goog-api-key"], undefined);
});

test("session ids stay stable while request ids are unique", () => {
  const first = api.getOpenCodeGoSessionId();
  assert.equal(api.getOpenCodeGoSessionId(), first);
  const requestA = api.getOpenCodeGoRequestId();
  const requestB = api.getOpenCodeGoRequestId();
  assert.notEqual(requestA, requestB);
  assert.match(requestA, /^msg_/);
  api.resetOpenCodeGoSessionId();
  const second = api.getOpenCodeGoSessionId();
  assert.notEqual(second, first);
  assert.match(second, /^ses_/);
});

test("classifies the actionable OpenCode Go failures", () => {
  assert.equal(
    api.classifyOpenCodeGoError(
      new Error('HTTP 401: {"error":{"message":"This API key has expired."}}'),
    ),
    "unauthorized",
  );
  assert.equal(
    api.classifyOpenCodeGoError({
      xmlhttp: {
        status: 403,
        responseText:
          '{"error":{"message":"Free tier models require OpenCode"}}',
      },
    }),
    "forbidden",
  );
  assert.equal(
    api.classifyOpenCodeGoError(
      'HTTP 429: {"error":{"type":"GoUsageLimitError"}}',
    ),
    "usage-limit",
  );
  assert.equal(
    api.classifyOpenCodeGoError(new Error("network unreachable")),
    "unknown",
  );
});

test("ships a Go catalog grouped by protocol family", () => {
  const models = api.OPENCODE_GO_MODELS;
  assert.ok(models.length >= 20);
  const ids = models.map((model) => model.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("glm-5.3"));
  assert.ok(ids.includes("claude-haiku-5-5"));
  assert.ok(ids.includes("gpt-6-luna"));
  assert.ok(ids.includes("gemini-4-argon"));
  for (const model of models) {
    assert.match(model.id, /^[a-z0-9][a-z0-9._-]*$/);
    assert.ok(model.name && model.name.length > 0);
    assert.ok(!model.contextLength || model.contextLength > 0);
    assert.ok(
      ["chat", "responses", "anthropic", "google"].includes(model.apiFamily),
    );
  }
});

test("the chat family only exposes chat-completions models", () => {
  const chat = api.openCodeGoModelsForFamily("chat");
  assert.ok(chat.length >= 10);
  const ids = chat.map((model) => model.id);
  assert.ok(ids.includes("glm-5.3"));
  assert.ok(ids.includes("kimi-k3"));
  assert.ok(!ids.includes("gpt-6-luna"));
  assert.ok(!ids.includes("claude-haiku-5-5"));
  for (const model of chat) assert.equal(model.apiFamily, undefined);

  const families = {
    responses: "gpt-6-luna",
    anthropic: "claude-haiku-5-5",
    google: "gemini-4-argon",
  };
  for (const [family, expected] of Object.entries(families)) {
    const models = api.openCodeGoModelsForFamily(family);
    assert.ok(
      models.some((model) => model.id === expected),
      family,
    );
    assert.equal(models[0].apiFamily, undefined);
  }
});
