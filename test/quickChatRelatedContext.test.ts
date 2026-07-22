import { expect } from "chai";
import {
  buildQuickChatQuestionWithRelatedContext,
  createQuickChatRelatedContextSignature,
  mergeQuickChatRelatedItemRefs,
  resolveQuickChatRelatedContext,
  validateQuickChatRelatedSelection,
  type QuickChatRelatedItemRef,
} from "../src/modules/quickChatRelatedContext";

function makeRef(itemId: number, title = `Paper ${itemId}`) {
  return { itemId, libraryID: 1, title } satisfies QuickChatRelatedItemRef;
}

function makeItem(itemId: number, title = `Paper ${itemId}`): Zotero.Item {
  return {
    id: itemId,
    libraryID: 1,
    getField(field: string) {
      return field === "title" ? title : "";
    },
    isRegularItem() {
      return true;
    },
  } as any;
}

describe("quick-chat related context", function () {
  it("deduplicates refs and excludes the current paper", function () {
    const merged = mergeQuickChatRelatedItemRefs(
      [makeRef(2, "B")],
      [makeRef(1, "A"), makeRef(2, "B again"), makeRef(3, "C")],
      1,
    );

    expect(merged.items.map((ref) => ref.itemId)).to.deep.equal([2, 3]);
    expect(merged.added.map((ref) => ref.itemId)).to.deep.equal([3]);
    expect(merged.skippedCurrent).to.equal(1);
    expect(merged.skippedDuplicate).to.equal(1);
  });

  it("uses AI summary content only in summary mode", async function () {
    let summaryCalls = 0;
    let fullTextCalls = 0;
    const result = await resolveQuickChatRelatedContext(
      [makeRef(2)],
      "summary",
      {
        async getItemById(id) {
          return makeItem(id);
        },
        async getSummaryMarkdown() {
          summaryCalls++;
          return "summary note";
        },
        async getFullText() {
          fullTextCalls++;
          return "full text";
        },
      },
    );

    expect(summaryCalls).to.equal(1);
    expect(fullTextCalls).to.equal(0);
    expect(result.included).to.have.length(1);
    expect(result.included[0].content).to.equal("summary note");
  });

  it("uses text extraction in full-text mode", async function () {
    let summaryCalls = 0;
    let fullTextCalls = 0;
    const result = await resolveQuickChatRelatedContext(
      [makeRef(2)],
      "fullText",
      {
        async getItemById(id) {
          return makeItem(id);
        },
        async getSummaryMarkdown() {
          summaryCalls++;
          return "summary note";
        },
        async getFullText() {
          fullTextCalls++;
          return "plain extracted text";
        },
      },
    );

    expect(summaryCalls).to.equal(0);
    expect(fullTextCalls).to.equal(1);
    expect(result.included[0].content).to.equal("plain extracted text");
  });

  it("enforces mode-specific item limits", function () {
    const fullTextRefs = Array.from({ length: 6 }, (_, index) =>
      makeRef(index + 1),
    );
    const validation = validateQuickChatRelatedSelection(
      fullTextRefs,
      "fullText",
    );

    expect(validation.ok).to.equal(false);
    expect(validation.reason).to.equal("too-many-items");
    expect(validation.limit.maxItems).to.equal(5);
  });

  it("truncates related context and reports skipped missing summaries", async function () {
    const longSummary = "x".repeat(5000);
    const result = await resolveQuickChatRelatedContext(
      [makeRef(2), makeRef(3)],
      "summary",
      {
        async getItemById(id) {
          return makeItem(id);
        },
        async getSummaryMarkdown(item) {
          return item.id === 2 ? longSummary : "";
        },
      },
    );

    expect(result.included).to.have.length(1);
    expect(result.included[0].content.length).to.be.at.most(4000);
    expect(result.included[0].truncated).to.equal(true);
    expect(result.skipped).to.have.length(1);
    expect(result.skipped[0].reason).to.equal("missing-summary");
  });

  it("builds a first-turn question with a RelatedPapers block and stable signature", async function () {
    const refs = [makeRef(2, "B")];
    const result = await resolveQuickChatRelatedContext(refs, "summary", {
      async getItemById(id) {
        return makeItem(id);
      },
      async getSummaryMarkdown() {
        return "summary note";
      },
    });
    const question = buildQuickChatQuestionWithRelatedContext(
      "Compare methods",
      result,
    );

    expect(question).to.contain('<RelatedPapers mode="summary">');
    expect(question).to.contain("<Title>B</Title>");
    expect(question).to.contain("summary note");
    expect(question).not.to.contain("cross-paper comparison");
    expect(question).not.to.contain("Treat the main paper");
    expect(createQuickChatRelatedContextSignature("summary", refs)).to.equal(
      "summary:2",
    );
  });
});
