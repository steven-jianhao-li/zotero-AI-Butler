import { expect } from "chai";
import {
  getBuiltinMultiRoundPromptTemplates,
  getDefaultMultiRoundPrompts,
  mergeMultiRoundPromptTemplates,
  parseMultiRoundPromptTemplateExport,
  parseMultiRoundPrompts,
  serializeMultiRoundPromptTemplate,
  type MultiRoundPromptTemplate,
} from "../src/utils/prompts";

function template(
  id: string,
  name: string,
  orderOffset = 0,
): MultiRoundPromptTemplate {
  return {
    id,
    name,
    description: "test template",
    version: 1,
    prompts: [
      {
        id: "round-b",
        title: "Second",
        prompt: "Explain the experiments.",
        order: 2 + orderOffset,
      },
      {
        id: "round-a",
        title: "First",
        prompt: "Explain the motivation.",
        order: 1 + orderOffset,
      },
    ],
    finalPrompt: "Write a final summary.",
  };
}

describe("multi-round prompt templates", function () {
  it("uses the builtin default template as the default prompts source", function () {
    const [builtin] = getBuiltinMultiRoundPromptTemplates();
    const defaults = getDefaultMultiRoundPrompts();

    expect(builtin.name).to.equal("默认");
    expect(defaults.map((prompt) => prompt.title)).to.deep.equal(
      builtin.prompts.map((prompt) => prompt.title),
    );
  });

  it("exports and imports a template with normalized round order", function () {
    const imported = parseMultiRoundPromptTemplateExport(
      serializeMultiRoundPromptTemplate(template("custom", "Custom")),
    );

    expect(imported.id).to.equal("custom");
    expect(imported.name).to.equal("Custom");
    expect(imported.prompts.map((prompt) => prompt.title)).to.deep.equal([
      "First",
      "Second",
    ]);
    expect(imported.prompts.map((prompt) => prompt.order)).to.deep.equal([
      1, 2,
    ]);
  });

  it("rejects invalid template exports", function () {
    expect(() =>
      parseMultiRoundPromptTemplateExport(
        JSON.stringify({ schema: "wrong", version: 1, template: {} }),
      ),
    ).to.throw("schema");

    expect(() =>
      parseMultiRoundPromptTemplateExport(
        JSON.stringify({
          schema: "zotero-ai-butler.multi-round-prompt-template",
          version: 1,
          template: {
            id: "bad",
            name: "Bad",
            version: 1,
            prompts: [{ id: "round1", title: "", prompt: "" }],
          },
        }),
      ),
    ).to.throw("标题和提示词不能为空");
  });

  it("merges templates by id without duplicates", function () {
    const merged = mergeMultiRoundPromptTemplates(
      [template("same", "Old")],
      [template("same", "New")],
    );

    expect(merged).to.have.length(1);
    expect(merged[0].name).to.equal("New");
  });

  it("keeps legacy multi-round prompt parsing compatible", function () {
    const parsed = parseMultiRoundPrompts(
      JSON.stringify(template("legacy", "Legacy").prompts),
    );

    expect(parsed.map((prompt) => prompt.title)).to.deep.equal([
      "First",
      "Second",
    ]);
  });
});
