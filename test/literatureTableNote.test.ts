import { expect } from "chai";
import { LiteratureReviewService } from "../src/modules/literatureReviewService";
import { TableSchemaError } from "../src/modules/literatureTable";

describe("literature table note persistence", function () {
  it("replaces a matching table atomically and preserves the latest note on a stale append", async function () {
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "Table append fixture");
    await item.saveTx();
    try {
      const original = "| 字段 | 值 |\n|---|---|\n| Method | A &lt; B |";
      const updated = original + "\n| Sample | Ten |";
      const first = await LiteratureReviewService.saveTableNote(item, original);
      expect(await LiteratureReviewService.findTableNote(item)).to.equal(
        original,
      );
      const second = await LiteratureReviewService.saveTableNote(
        item,
        updated,
        true,
        undefined,
        original,
      );
      expect(second.id).not.to.equal(first.id);

      let error: unknown;
      try {
        await LiteratureReviewService.saveTableNote(
          item,
          original,
          true,
          undefined,
          original,
        );
      } catch (e) {
        error = e;
      }
      expect(error).to.be.instanceOf(TableSchemaError);
      expect(item.getNotes()).to.deep.equal([second.id]);
      expect(await LiteratureReviewService.findTableNote(item)).to.equal(
        updated,
      );
    } finally {
      await item.eraseTx();
    }
  });
});
