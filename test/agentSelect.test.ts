import { expect } from "chai";
import { AgentSelect } from "../src/modules/views/agent/AgentSelect";

describe("Agent picker in a Zotero document", function () {
  let doc: Document;
  let host: HTMLDivElement;
  let picker: AgentSelect;
  let changes: string[];

  beforeEach(function () {
    doc = Zotero.getMainWindow().document;
    host = doc.createElement("div");
    Object.assign(host.style, {
      position: "fixed",
      top: "100px",
      left: "100px",
      width: "300px",
      zIndex: "10000",
    });
    doc.documentElement!.append(host);
    // The plugin builds controls before adopting them into the dialog document.
    const detached = doc.implementation.createHTMLDocument("Agent picker");
    picker = new AgentSelect(detached, "Model", [
      { value: "auto", label: "Auto" },
      { value: "missing", label: "Unavailable", disabled: true },
      { value: "qwen", label: "Qwen" },
      { value: "reader", label: "Reader" },
    ]);
    host.append(picker.element);
    changes = [];
    picker.onChange = (value) => changes.push(value);
  });

  afterEach(function () {
    picker.close();
    host.remove();
  });

  function key(value: string): void {
    const event = doc.createEvent("KeyboardEvent");
    event.initKeyboardEvent("keydown", true, true, doc.defaultView, value);
    picker.trigger.dispatchEvent(event);
  }

  function option(value: string): HTMLElement {
    return picker.element.querySelector<HTMLElement>(
      `[role="option"][data-value="${value}"]`,
    )!;
  }

  function expanded(): boolean {
    return picker.trigger.getAttribute("aria-expanded") === "true";
  }

  it("selects by mouse, keeps unavailable choices inert, and reports changes once", function () {
    picker.trigger.click();
    expect(expanded()).to.equal(true);
    option("missing").click();
    expect(picker.value).to.equal("auto");
    expect(expanded()).to.equal(true);
    option("qwen").click();
    expect(picker.value).to.equal("qwen");
    expect(expanded()).to.equal(false);
    expect(changes).to.deep.equal(["qwen"]);
    picker.trigger.click();
    option("qwen").click();
    expect(changes).to.deep.equal(["qwen"]);
  });

  it("navigates enabled choices with the keyboard and commits only on Enter", function () {
    picker.trigger.focus();
    key("ArrowDown");
    key("ArrowDown");
    expect(picker.trigger.getAttribute("aria-activedescendant")).to.equal(
      option("qwen").id,
    );
    expect(picker.value).to.equal("auto");
    key("Enter");
    expect(picker.value).to.equal("qwen");
    expect(expanded()).to.equal(false);
    key("End");
    key("Escape");
    expect(picker.value).to.equal("qwen");
    expect(expanded()).to.equal(false);
    expect(changes).to.deep.equal(["qwen"]);
    key("Home");
    key("Enter");
    expect(picker.value).to.equal("auto");
  });

  it("supports typeahead, Tab dismissal, and closing in the adopted document", function () {
    key("r");
    key("Enter");
    expect(picker.value).to.equal("reader");
    picker.trigger.click();
    key("Tab");
    expect(expanded(), "Tab dismisses the picker").to.equal(false);
    picker.trigger.click();
    const outside = doc.createEvent("MouseEvents");
    outside.initEvent("mousedown", true, true);
    host.dispatchEvent(outside);
    expect(expanded(), "Outside mousedown dismisses the picker").to.equal(
      false,
    );
    picker.trigger.click();
    const other = doc.createElement("button");
    other.textContent = "Outside picker";
    host.append(other);
    other.focus();
    expect(doc.activeElement).to.equal(other);
    // Background chrome windows update activeElement without emitting focusin.
    // Dispatch explicitly so dismissal does not depend on window activation.
    const focus = doc.createEvent("FocusEvent");
    focus.initEvent("focusin", true, false);
    other.dispatchEvent(focus);
    expect(expanded(), "Outside focus dismisses the picker").to.equal(false);
  });

  it("closes when disabled and preserves the saved unavailable model", function () {
    picker.trigger.click();
    picker.disabled = true;
    expect(expanded()).to.equal(false);
    picker.trigger.click();
    key("ArrowDown");
    expect(expanded()).to.equal(false);
    picker.disabled = false;
    picker.setOptions(
      [
        { value: "auto", label: "Auto" },
        { value: "missing", label: "Unavailable", disabled: true },
      ],
      "missing",
    );
    expect(picker.value).to.equal("missing");
    expect(picker.trigger.textContent).to.include("Unavailable");
    expect(changes).to.deep.equal([]);
    picker.trigger.click();
    expect(picker.trigger.getAttribute("aria-activedescendant")).to.equal(
      option("auto").id,
    );
    picker.close();
    expect(picker.trigger.hasAttribute("aria-activedescendant")).to.equal(
      false,
    );
  });
});
