import { expect } from "chai";
import { ProviderRegistry } from "../src/modules/llmproviders/ProviderRegistry";
import { OrcaRouterProvider } from "../src/modules/llmproviders/OrcaRouterProvider";

describe("OrcaRouter provider", function () {
  it("is registered in the provider registry", function () {
    const provider = ProviderRegistry.get("orcarouter");
    expect(provider).to.exist;
    expect(provider!.id).to.equal("orcarouter");
  });

  it("is exposed by the registry list", function () {
    expect(ProviderRegistry.list()).to.include("orcarouter");
  });

  it("declares chat-completions and streaming capabilities", function () {
    const provider = new OrcaRouterProvider();
    expect(provider.capabilities).to.include({
      supportsText: true,
      supportsStreaming: true,
      supportsPdfBase64: true,
      supportsSystemPrompt: true,
    });
    expect(provider.capabilities?.supportedParams).to.include(
      "reasoningEffort",
    );
  });
});
