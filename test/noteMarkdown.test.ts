import { expect } from "chai";
import { markdownToZoteroNoteHtml } from "../src/modules/noteMarkdown";

describe("note Markdown rendering", function () {
  it("renders saved follow-up headings and formulas (#307, #264)", function () {
    const html = markdownToZoteroNoteHtml(
      "## Follow-up answer\n\nMass energy: $E=mc^2$.\n\n$$\na_b = c^2\n$$",
    );

    expect(html).to.contain("<h2>Follow-up answer</h2>");
    expect(html).to.contain('<span class="math">$E=mc^2$</span>');
    expect(html).to.contain("\\displaystyle a_b = c^2");
    expect(html).not.to.contain("## Follow-up answer");
  });

  it("escapes formula contents before writing Zotero note HTML", function () {
    const html = markdownToZoteroNoteHtml("Compare $a < b & c$ safely.");

    expect(html).to.contain('<span class="math">$a &lt; b &amp; c$</span>');
  });
});
