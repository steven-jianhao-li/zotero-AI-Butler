import { expect } from "chai";
import {
  mergeRequestHeaders,
  parseCustomHeaders,
} from "../src/modules/llmproviders/shared/requestHeaders";

describe("LLM custom request headers", function () {
  it("parses custom model request headers from JSON", function () {
    const headers = parseCustomHeaders(
      '{"HTTP-Referer":"https://example.com","X-Title":"AI Butler"}',
    );

    expect(headers).to.deep.equal({
      "HTTP-Referer": "https://example.com",
      "X-Title": "AI Butler",
    });
  });

  it("parses common Python dict custom header snippets", function () {
    const headers = parseCustomHeaders(
      `headers={**common_headers, 'X-Custom-Gateway': 'true'}`,
    );

    expect(headers).to.deep.equal({
      "X-Custom-Gateway": "true",
    });
  });

  it("appends custom headers without overriding protected auth headers", function () {
    const headers = mergeRequestHeaders(
      {
        "Content-Type": "application/json",
        Authorization: "Bearer real-key",
      },
      {
        "HTTP-Referer": "https://example.com",
        authorization: "Bearer ignored",
        "X-Title": "AI Butler",
      },
    );

    expect(headers).to.deep.equal({
      "Content-Type": "application/json",
      Authorization: "Bearer real-key",
      "HTTP-Referer": "https://example.com",
      "X-Title": "AI Butler",
    });
  });

  it("allows overriding non-protected default headers such as HTTP-Referer", function () {
    const headers = mergeRequestHeaders(
      {
        "Content-Type": "application/json",
        Authorization: "Bearer real-key",
        "HTTP-Referer": "https://github.com/steven-jianhao-li/zotero-AI-Butler",
        "X-Title": "Zotero AI Butler",
      },
      {
        "HTTP-Referer": "https://example.com",
        "X-Title": "My App",
      },
    );

    expect(headers).to.deep.equal({
      "Content-Type": "application/json",
      Authorization: "Bearer real-key",
      "HTTP-Referer": "https://example.com",
      "X-Title": "My App",
    });
  });
});
