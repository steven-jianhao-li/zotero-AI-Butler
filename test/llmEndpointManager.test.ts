import { expect } from "chai";
import { config } from "../package.json";
import {
  LLMEndpointManager,
  type LLMEndpoint,
} from "../src/modules/llmEndpointManager";

const prefKeys = [
  "llmEndpoints",
  "llmRoutingStrategy",
  "llmRoundRobinCursor",
  "maxApiSwitchCount",
  "provider",
  "openaiCompatApiUrl",
  "openaiCompatApiKey",
  "openaiCompatModel",
];

function prefName(key: string): string {
  return `${config.prefsPrefix}.${key}`;
}

function makeEndpoint(id: string, enabled = true): LLMEndpoint {
  return {
    id,
    name: id.toUpperCase(),
    providerType: "openai",
    apiUrl: "https://api.openai.com/v1/responses",
    apiKey: `sk-${id}`,
    model: "gpt-5",
    enabled,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("LLMEndpointManager", function () {
  const originals = new Map<string, unknown>();

  beforeEach(function () {
    originals.clear();
    for (const key of prefKeys) {
      const fullKey = prefName(key);
      originals.set(key, Zotero.Prefs.get(fullKey, true));
      Zotero.Prefs.clear(fullKey, true);
    }
  });

  afterEach(function () {
    for (const key of prefKeys) {
      const fullKey = prefName(key);
      const value = originals.get(key);
      if (value === undefined) Zotero.Prefs.clear(fullKey, true);
      else Zotero.Prefs.set(fullKey, value as any, true);
    }
  });

  it("migrates an empty endpoint list from legacy provider prefs", function () {
    Zotero.Prefs.set(prefName("llmEndpoints"), "[]", true);
    Zotero.Prefs.set(prefName("provider"), "openai-compat", true);
    Zotero.Prefs.set(
      prefName("openaiCompatApiUrl"),
      "https://example.test/v1/chat/completions",
      true,
    );
    Zotero.Prefs.set(prefName("openaiCompatApiKey"), "sk-legacy", true);
    Zotero.Prefs.set(prefName("openaiCompatModel"), "legacy-model", true);

    const endpoints = LLMEndpointManager.getEndpoints();

    expect(endpoints).to.have.length(1);
    expect(endpoints[0]).to.include({
      id: "endpoint-legacy-primary",
      providerType: "openai-compat",
      apiUrl: "https://example.test/v1/chat/completions",
      apiKey: "sk-legacy",
      model: "legacy-model",
      enabled: true,
    });
  });

  it("returns priority route order and skips disabled endpoints", function () {
    LLMEndpointManager.saveEndpoints([
      makeEndpoint("a"),
      makeEndpoint("b", false),
      makeEndpoint("c"),
    ]);
    LLMEndpointManager.setRoutingStrategy("priority");
    Zotero.Prefs.set(prefName("maxApiSwitchCount"), "5", true);

    const route = LLMEndpointManager.prepareRoute();

    expect(route.strategy).to.equal("priority");
    expect(route.maxAttempts).to.equal(5);
    expect(route.endpoints.map((endpoint) => endpoint.id)).to.deep.equal([
      "a",
      "c",
    ]);
  });

  it("advances round-robin cursor after each attempted endpoint", function () {
    LLMEndpointManager.saveEndpoints([
      makeEndpoint("a"),
      makeEndpoint("b"),
      makeEndpoint("c"),
      makeEndpoint("d"),
    ]);
    LLMEndpointManager.setRoutingStrategy("roundRobin");
    Zotero.Prefs.set(prefName("llmRoundRobinCursor"), "b", true);

    const route = LLMEndpointManager.prepareRoute();
    expect(route.endpoints.map((endpoint) => endpoint.id)).to.deep.equal([
      "b",
      "c",
      "d",
      "a",
    ]);

    LLMEndpointManager.markEndpointAttempted("b");
    expect(Zotero.Prefs.get(prefName("llmRoundRobinCursor"), true)).to.equal(
      "c",
    );
    LLMEndpointManager.markEndpointAttempted("c");
    expect(Zotero.Prefs.get(prefName("llmRoundRobinCursor"), true)).to.equal(
      "d",
    );
  });

  it("throws clearly when no enabled endpoint exists", function () {
    LLMEndpointManager.saveEndpoints([makeEndpoint("a", false)]);

    expect(() => LLMEndpointManager.prepareRoute()).to.throw(
      "No enabled LLM endpoints are configured.",
    );
  });
});
