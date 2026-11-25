import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { URL } from "node:url";
import vm from "node:vm";
import { transformSync } from "esbuild";

const { Event, EventTarget } = globalThis;

function settingsFixture(initialPrefs) {
  const prefs = new Map(Object.entries(initialPrefs));
  const preferences = {
    getPref: (key) => prefs.get(key),
    setPref: (key, value) => prefs.set(key, value),
    clearPref: (key) => prefs.delete(key),
  };
  let importText;
  const elements = [];
  function createElement(tag) {
    const element = Object.assign(new EventTarget(), {
      tag,
      style: {},
      appendChild() {},
    });
    elements.push(element);
    return element;
  }
  const document = {
    body: createElement("body"),
    createElement,
    createElementNS: (_, tag) => createElement(tag),
  };
  const globals = {
    Zotero: {
      locale: "en-US",
      getMainWindow: () => ({ document }),
      Prefs: { clear() {} },
    },
    Services: {
      prompt: {
        confirm: () => true,
        prompt: (_window, _title, _label, text) => {
          text.value = importText;
          return true;
        },
      },
    },
    ztoolkit: {
      ProgressWindow: class {
        createLine() {
          return this;
        }
        show() {}
      },
    },
    setTimeout() {},
  };
  const locale = { getString: (id) => id };
  function load(path, imports) {
    const source = readFileSync(
      new URL("../src/" + path + ".ts", import.meta.url),
      "utf8",
    );
    const module = { exports: {} };
    vm.runInNewContext(
      transformSync(source, { loader: "ts", format: "cjs" }).code,
      {
        module,
        require: (key) => imports[key] || {},
        ...globals,
      },
    );
    return module.exports;
  }
  const prompts = load("utils/prompts", {
    "./prefs": preferences,
    "./locale": locale,
    "../defaults/prompts/deep-read.json": JSON.parse(
      readFileSync(
        new URL("../src/defaults/prompts/deep-read.json", import.meta.url),
        "utf8",
      ),
    ),
  });
  const imports = {
    "../../../utils/prefs": preferences,
    "../../../utils/prompts": prompts,
    "../../../utils/locale": locale,
    "../../../utils/outputLanguage": load("utils/outputLanguage", {
      "./prefs": preferences,
    }),
    "../../../utils/promptLanguageSelect": load("utils/promptLanguageSelect", {
      "./prompts": prompts,
    }),
    "../ui/components": load("modules/views/ui/components", {}),
  };
  const { PromptsSettingsPage } = load(
    "modules/views/settings/PromptsSettingsPage",
    imports,
  );
  const { DataSettingsPage } = load(
    "modules/views/settings/DataSettingsPage",
    imports,
  );
  const promptPage = new PromptsSettingsPage(document.body);
  const dataPage = new DataSettingsPage(document.body);
  promptPage.render = dataPage.render = () => {};
  promptPage.renderDefaultPromptLanguageSetting();
  promptPage.renderOutputLanguageSetting();
  return {
    prefs,
    prompts,
    dataPage,
    change(id, value, event = "change") {
      const element = elements.find((node) => node.id === "setting-" + id);
      element.value = value;
      element.dispatchEvent(new Event(event));
    },
    exportJSON() {
      dataPage.exportSettings();
      return elements.findLast((element) => element.tag === "textarea").value;
    },
    importJSON(text) {
      importText = text;
      dataPage.importSettings();
    },
  };
}

test("only changing the native template selector updates an untouched built-in prompt", () => {
  const { change, prefs, prompts } = settingsFixture({
    promptLanguage: "auto",
  });
  const original = prompts.getDefaultSummaryPrompt();
  prefs.set("summaryPrompt", original);
  prefs.set("promptVersion", 1);
  for (const language of ["中文", "English", "日本語", ""]) {
    change("outputLanguage", language);
    change("outputLanguage", language, "blur");
    assert.equal(prefs.get("outputLanguage"), language);
    assert.equal(prefs.get("promptLanguage"), "auto");
    assert.equal(prefs.get("summaryPrompt"), original);
    assert.equal(prefs.get("promptVersion"), 1);
  }
  change("outputLanguage", "English");
  change("promptLanguage", "zh-CN");
  assert.equal(prefs.get("summaryPrompt"), prompts.DEFAULT_SUMMARY_PROMPT);
  assert.equal(prefs.get("outputLanguage"), "English");
  prefs.set("summaryPrompt", "My own template");
  change("promptLanguage", "en-US");
  assert.equal(prefs.get("summaryPrompt"), "My own template");
});

test("language settings round-trip through export, reset and import, including older backups", () => {
  const fixture = settingsFixture({
    promptLanguage: "zh-CN",
    summaryPrompt: "Custom",
  });
  const { change, dataPage, prefs, prompts } = fixture;
  change("outputLanguage", " 日本語 ");
  change("outputLanguageDomain", "law");
  const backup = fixture.exportJSON();
  const saved = {
    promptLanguage: "zh-CN",
    outputLanguage: "日本語",
    outputLanguageDomain: "law",
    summaryPrompt: "Custom",
  };
  for (const [key, value] of Object.entries(saved))
    assert.equal(JSON.parse(backup)[key], value);
  dataPage.resetAll();
  assert.equal(prefs.get("promptLanguage"), "auto");
  assert.equal(prefs.get("summaryPrompt"), prompts.DEFAULT_SUMMARY_PROMPT_EN);
  assert.equal(prefs.get("outputLanguage"), "");
  assert.equal(prefs.get("outputLanguageDomain"), "general");
  fixture.importJSON(backup);
  for (const [key, value] of Object.entries(saved))
    assert.equal(prefs.get(key), value);
  fixture.importJSON(JSON.stringify({ promptLanguage: "en" }));
  assert.equal(prompts.getDefaultPromptLanguagePreference(), "en-US");
  assert.equal(prefs.get("outputLanguage"), "日本語");
  assert.equal(prefs.get("outputLanguageDomain"), "law");
});
