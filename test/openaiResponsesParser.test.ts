import { expect } from "chai";
import {
  parseOpenAIResponsesDelta,
  parseOpenAIResponsesText,
} from "../src/modules/llmproviders/shared/openaiResponses";

describe("OpenAI Responses parser", function () {
  it("extracts output text from standard output content array", function () {
    const response = {
      id: "resp_test",
      object: "response",
      status: "completed",
      output: [
        { id: "rs_test", type: "reasoning" },
        {
          id: "msg_test",
          type: "message",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: "# Facebook and Social Contagion\n\n## 研究背景与目标",
            },
          ],
        },
      ],
    };

    expect(parseOpenAIResponsesText(response)).to.contain("## 研究背景与目标");
  });

  it("prefers top-level output_text when present", function () {
    const response = {
      output_text: "top-level text",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "nested text" }],
        },
      ],
    };

    expect(parseOpenAIResponsesText(response)).to.equal("top-level text");
  });

  it("extracts streaming output_text deltas", function () {
    const chunks = [
      { type: "response.output_text.delta", delta: "# Title" },
      { type: "response.output_text.delta", delta: "\n- item" },
    ];

    expect(chunks.map(parseOpenAIResponsesDelta).join("")).to.equal(
      "# Title\n- item",
    );
  });
});
