import { expect } from "chai";
import { shouldOmitAnthropicTemperature } from "../src/modules/llmproviders/AnthropicProvider";

describe("Anthropic provider", function () {
  it("keeps temperature for older Claude models", function () {
    expect(
      shouldOmitAnthropicTemperature("claude-3-5-sonnet-20241022"),
    ).to.equal(false);
    expect(shouldOmitAnthropicTemperature("claude-opus-4-1-20250805")).to.equal(
      false,
    );
    expect(
      shouldOmitAnthropicTemperature("claude-sonnet-4-6-20260601"),
    ).to.equal(false);
    expect(shouldOmitAnthropicTemperature("claude-opus-4-6-20260205")).to.equal(
      false,
    );
  });

  it("omits temperature for Opus 4.7+ models", function () {
    expect(shouldOmitAnthropicTemperature("claude-opus-4-7-20260701")).to.equal(
      true,
    );
    expect(
      shouldOmitAnthropicTemperature("anthropic/claude-opus-4.8"),
    ).to.equal(true);
    expect(shouldOmitAnthropicTemperature("claude-opus-4-latest")).to.equal(
      true,
    );
  });
});
