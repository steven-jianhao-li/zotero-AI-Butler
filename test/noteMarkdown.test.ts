import { expect } from "chai";
import {
  buildFollowUpChatPairNoteHtml,
  decodeMathHtmlEntities,
  markdownToDisplayHtml,
  markdownToZoteroNoteHtml,
  requiresDisplayMath,
  normalizeFollowUpChatNoteHtml,
  parseFollowUpChatPairsFromNoteHtml,
} from "../src/modules/noteMarkdown";
import { buildQuickChatConversation } from "../src/modules/chatContext";

describe("note Markdown rendering", function () {
  it("renders saved follow-up headings and formulas (#307, #264)", function () {
    const html = markdownToZoteroNoteHtml(
      "## Follow-up answer\n\nMass energy: $E=mc^2$.\n\n$$\na_b = c^2\n$$",
    );

    expect(html).to.contain("<h2>Follow-up answer</h2>");
    expect(html).to.contain('<span class="math">$E=mc^2$</span>');
    expect(html).to.contain("$$a_b = c^2$$");
    expect(html).not.to.contain("## Follow-up answer");
  });

  it("escapes formula contents before writing Zotero note HTML", function () {
    const html = markdownToZoteroNoteHtml("Compare $a < b & c$ safely.");

    expect(html).to.contain('<span class="math">$a &lt; b &amp; c$</span>');
  });

  it("keeps tagged equations in display math mode (#346)", function () {
    const formula = String.raw`\mathbf{z}_{NAN} = \mathbf{z}_{1} \cdot \mathbf{z}_{0}^{-1}, \tag{1}`;
    const noteHtml = markdownToZoteroNoteHtml(`$${formula}$`);
    const displayHtml = markdownToDisplayHtml(`$${formula}$`);

    expect(requiresDisplayMath(formula)).to.equal(true);
    expect(noteHtml).to.contain(`<span class="math">$$${formula}$$</span>`);
    expect(noteHtml).not.to.contain("\\displaystyle");
    expect(displayHtml).to.contain('class="katex-display"');
    expect(displayHtml).not.to.contain("katex-error");
  });

  it("keeps text after headings and block formulas as paragraphs", function () {
    const html = markdownToZoteroNoteHtml(
      [
        "#### 论文中的作用",
        "该公式从网络交互（I/O）角度定量评估了解析器的部分负载。",
        "",
        "公式为：",
        "$$QSentCost(n) = RR\\_Sent(n) \\cdot 2$$",
        "该公式通过对网络通信行为和处理器底层行为进行桥接。",
      ].join("\n"),
    );

    expect(html).to.contain("<h4>论文中的作用</h4>");
    expect(html).to.contain(
      "<p>该公式从网络交互（I/O）角度定量评估了解析器的部分负载。</p>",
    );
    expect(html).to.contain(
      "<p>该公式通过对网络通信行为和处理器底层行为进行桥接。</p>",
    );
    expect(html).not.to.contain("<h2>该公式从网络交互");
    expect(html).not.to.contain("<p>公式为：<br><p");
  });

  it("decodes escaped prime entities before KaTeX rendering", function () {
    expect(decodeMathHtmlEntities("X&#39;_t + Y&#x27;_t + Z&apos;_t")).to.equal(
      "X'_t + Y'_t + Z'_t",
    );

    const html = markdownToDisplayHtml("Prime formula: $X&#39;_t = A$");

    expect(html).to.contain('class="katex-inline"');
    expect(html).not.to.contain("katex-error");
    expect(html).not.to.contain("&#39;");
  });

  it("renders follow-up display Markdown formulas with KaTeX (#320)", function () {
    const html = markdownToDisplayHtml(
      [
        "Mass energy: $E=mc^2$.",
        "",
        "$$a_b = c^2$$",
        "",
        "Inline alt: \\(x_i\\)",
        "",
        "\\[\\sum_i x_i\\]",
      ].join("\n"),
    );

    expect(html).to.contain('class="katex-inline"');
    expect(html).to.contain('class="katex-display"');
    expect(html).to.contain("katex-html");
    expect(html).not.to.contain('<span class="math">');
  });

  it("strips XML-invalid clipboard controls before rendering (#347)", function () {
    const pastedText = ["·ccc", "\u000Bddd", "正常保留换行\t和制表符"].join(
      "\n",
    );

    const displayHtml = markdownToDisplayHtml(pastedText);
    const noteHtml = markdownToZoteroNoteHtml(pastedText);

    expect(displayHtml).to.contain("·ccc");
    expect(displayHtml).to.contain("ddd");
    expect(displayHtml).not.to.contain("\u000B");
    expect(noteHtml).to.contain("·ccc");
    expect(noteHtml).to.contain("ddd");
    expect(noteHtml).not.to.contain("\u000B");
  });

  it("builds quick-chat context from the current dialog only", function () {
    const dialogHistory = [
      { role: "user" as const, content: "First question" },
      { role: "assistant" as const, content: "First answer" },
    ];

    const conversation = buildQuickChatConversation(
      dialogHistory,
      "Follow up?",
    );

    expect(conversation).to.deep.equal([
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Follow up?" },
    ]);
  });

  it("renders saved follow-up chats without fixed light backgrounds (#193)", function () {
    const html = buildFollowUpChatPairNoteHtml({
      pairId: "pair_193",
      userMessage: "Why is **social contagion** important?",
      assistantMessage: "Because $x < y$ can spread across peers.",
      savedAt: "2026/5/8 12:10:56",
      sourceLabel: "来自快速追问",
    });

    expect(html).to.contain("AI_BUTLER_CHAT_PAIR_START id=pair_193");
    expect(html).to.contain("<strong>social contagion</strong>");
    expect(html).to.contain('<span class="math">$x &lt; y$</span>');
    expect(html).to.contain("保存时间: 2026/5/8 12:10:56");
    expect(html).to.contain("background:transparent");
    expect(html).not.to.contain("background-color:#e3f2fd");
    expect(html).not.to.contain("background-color:#f5f5f5");
  });

  it("restores saved follow-up chat metadata with JSON-like answer text", function () {
    const html = buildFollowUpChatPairNoteHtml({
      pairId: "pair_178",
      userMessage: "How does {context} affect the next question?",
      assistantMessage:
        'It should preserve {"role":"assistant"} and arrows --> safely.',
      savedAt: "2026/5/12 12:10:56",
    });

    const pairs = parseFollowUpChatPairsFromNoteHtml(html);

    expect(pairs).to.deep.equal([
      {
        id: "pair_178",
        user: "How does {context} affect the next question?",
        assistant:
          'It should preserve {"role":"assistant"} and arrows --> safely.',
      },
    ]);
  });

  it("parses legacy follow-up JSON comments that contain braces", function () {
    const html = `<!-- AI_BUTLER_CHAT_JSON: {"id":"legacy_178","user":"Why {this}?","assistant":"Because {that}."} -->`;

    const pairs = parseFollowUpChatPairsFromNoteHtml(html);

    expect(pairs).to.deep.equal([
      {
        id: "legacy_178",
        user: "Why {this}?",
        assistant: "Because {that}.",
      },
    ]);
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
