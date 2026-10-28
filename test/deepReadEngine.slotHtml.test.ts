import { expect } from "chai";
import {
  DEEP_READ_SLOT_PREFIX,
  replaceDeepReadSlotHtml,
} from "../src/modules/deepReadEngine";

function runningSlotHtml(slotId: string, title: string): string {
  return [
    `<!-- ${DEEP_READ_SLOT_PREFIX}:${slotId}:running -->`,
    `<h2>${title}</h2>`,
    "<p>🔄 正在生成...</p>",
    `<!-- ${DEEP_READ_SLOT_PREFIX}:${slotId}:end -->`,
  ].join("\n");
}

describe("Deep read slot HTML replacement", function () {
  it("keeps `$&` in generated content from splicing the slot block in", function () {
    // LaTeX `$<9$` becomes `$&lt;9$` after HTML escaping; `$&` is a special
    // replacement pattern in String.prototype.replace.
    const filled = replaceDeepReadSlotHtml(
      runningSlotHtml("method", "Methods"),
      "method",
      '<p>Complete clinical cure requires CSSS <span class="math">$&lt;9$</span>.</p>',
      "done",
    );

    expect(filled).to.contain("$&lt;9$");
    expect(filled).to.not.contain(":running -->");
    expect(filled).to.not.contain("🔄 正在生成...");
  });

  it("keeps `$&` from duplicating previously generated slots on refill", function () {
    const doneNote = [
      `<!-- ${DEEP_READ_SLOT_PREFIX}:intro:done -->`,
      "<h2>Introduction</h2>",
      "<p>Done intro content.</p>",
      `<!-- ${DEEP_READ_SLOT_PREFIX}:intro:end -->`,
      runningSlotHtml("results", "Results"),
    ].join("\n");

    const filled = replaceDeepReadSlotHtml(
      doneNote,
      "results",
      "<p>NO level $&gt;25$ ppm was not observed.</p>",
      "done",
    );

    expect(filled).to.contain("$&gt;25$");
    expect(filled).to.not.contain("🔄 正在生成...");
    expect(filled.match(/zab:slot:intro:done/g)).to.have.length(1);
  });

  it("still replaces the slot with the new content", function () {
    const filled = replaceDeepReadSlotHtml(
      runningSlotHtml("method", "Methods"),
      "method",
      "<p>Freshly generated methods content.</p>",
      "done",
    );

    expect(filled).to.contain("Freshly generated methods content.");
    expect(filled).to.contain(`<!-- ${DEEP_READ_SLOT_PREFIX}:method:done -->`);
    expect(filled).to.not.contain("<h2>Methods</h2>");
  });
});
