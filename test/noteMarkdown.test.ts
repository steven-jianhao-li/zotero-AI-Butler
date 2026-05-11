import { expect } from "chai";
import {
  buildFollowUpChatPairNoteHtml,
  markdownToZoteroNoteHtml,
  normalizeFollowUpChatNoteHtml,
} from "../src/modules/noteMarkdown";

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

  it("renders saved follow-up chats without fixed light backgrounds (#193)", function () {
    const html = buildFollowUpChatPairNoteHtml({
      pairId: "pair_193",
      userMessage: "Why is **social contagion** important?",
      assistantMessage: "Because $x < y$ can spread across peers.",
      savedAt: "2026/5/8 12:10:56",
      sourceLabel: "来自快速提问",
    });

    expect(html).to.contain("AI_BUTLER_CHAT_PAIR_START id=pair_193");
    expect(html).to.contain("<strong>social contagion</strong>");
    expect(html).to.contain('<span class="math">$x &lt; y$</span>');
    expect(html).to.contain("保存时间: 2026/5/8 12:10:56");
    expect(html).to.contain("background:transparent");
    expect(html).not.to.contain("background-color:#e3f2fd");
    expect(html).not.to.contain("background-color:#f5f5f5");
  });

  it("normalizes legacy follow-up chat blocks for dark notes (#193)", function () {
    const legacy = `
<div id="ai-butler-pair-pair_193" style="margin-top:14px; padding-top:8px; border-top:1px dashed #ccc;">
  <div style="background-color:#e3f2fd; padding:10px; border-radius:6px; margin-bottom:8px;">user</div>
  <div style="background-color:#f5f5f5; padding:10px; border-radius:6px;">assistant</div>
  <div style="font-size:11px; color:#999; margin-top:6px;">saved</div>
</div>`;

    const normalized = normalizeFollowUpChatNoteHtml(legacy);

    expect(normalized).to.contain("background:transparent");
    expect(normalized).to.contain("border-left:3px solid #4f8fd9");
    expect(normalized).to.contain("border-left:3px solid #59c0bc");
    expect(normalized).to.contain("opacity:0.65");
    expect(normalized).not.to.contain("background-color:#e3f2fd");
    expect(normalized).not.to.contain("background-color:#f5f5f5");
    expect(normalized).not.to.contain("color:#999");
  });
});
