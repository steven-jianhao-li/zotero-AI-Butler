import { expect } from "chai";
import { isLiteratureReviewCandidateItem } from "../src/modules/literatureReviewCandidate";

function makeItem(
  options: {
    itemType?: string;
    isRegularItem?: boolean;
    isNote?: boolean;
    isAttachment?: boolean;
  } = {},
): Zotero.Item {
  return {
    itemType: options.itemType,
    isRegularItem:
      options.isRegularItem === undefined
        ? undefined
        : () => options.isRegularItem,
    isNote: () => options.isNote || false,
    isAttachment: () => options.isAttachment || false,
  } as unknown as Zotero.Item;
}

describe("literature review candidate filter", function () {
  it("allows regular Zotero items regardless of item type", function () {
    for (const itemType of [
      "journalArticle",
      "conferencePaper",
      "patent",
      "book",
      "bookSection",
    ]) {
      const item = makeItem({ itemType, isRegularItem: true });

      expect(isLiteratureReviewCandidateItem(item), itemType).to.equal(true);
    }
  });

  it("excludes notes, attachments, and other non-regular items", function () {
    expect(
      isLiteratureReviewCandidateItem(
        makeItem({ itemType: "note", isRegularItem: false, isNote: true }),
      ),
    ).to.equal(false);
    expect(
      isLiteratureReviewCandidateItem(
        makeItem({
          itemType: "attachment",
          isRegularItem: false,
          isAttachment: true,
        }),
      ),
    ).to.equal(false);
    expect(
      isLiteratureReviewCandidateItem(
        makeItem({ itemType: "annotation", isRegularItem: false }),
      ),
    ).to.equal(false);
  });

  it("falls back to excluding notes and attachments when isRegularItem is unavailable", function () {
    expect(isLiteratureReviewCandidateItem(makeItem())).to.equal(true);
    expect(
      isLiteratureReviewCandidateItem(makeItem({ isNote: true })),
    ).to.equal(false);
    expect(
      isLiteratureReviewCandidateItem(makeItem({ isAttachment: true })),
    ).to.equal(false);
  });
});
