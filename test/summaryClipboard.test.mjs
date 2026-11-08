import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { URL } from "node:url";
import { TextDecoder } from "node:util";
import vm from "node:vm";
import { transformSync } from "esbuild";

const source = (name) =>
  readFileSync(new URL("../src/" + name, import.meta.url), "utf8");
const locale = {
  getString: (key, options) =>
    key + (options?.args ? " " + JSON.stringify(options.args) : ""),
};
function loadSource(name, imports, globals = {}) {
  const module = { exports: {} };
  const compiled = transformSync(source(name), {
    loader: "ts",
    format: "cjs",
    target: "es2018",
  });
  vm.runInNewContext(
    compiled.code,
    {
      module,
      exports: module.exports,
      Error,
      TextDecoder,
      ...globals,
      require: (specifier) => imports[specifier] || {},
    },
    { filename: name },
  );
  return module.exports;
}
function clipboardHost(nativeCopy, browserCopy) {
  const notifications = [];
  const created = [];
  const win = {
    navigator: {
      clipboard: browserCopy ? { writeText: browserCopy } : undefined,
    },
    document: {
      body: { appendChild() {} },
      createElement() {
        throw new Error("XUL textarea has no select()");
      },
      createElementNS(namespace, tagName) {
        const element = {
          namespace,
          tagName,
          style: {},
          select() {},
          remove() {
            element.removed = true;
          },
        };
        created.push(element);
        return element;
      },
      execCommand: () => false,
    },
  };
  const { SummaryView } = loadSource(
    "modules/views/SummaryView.ts",
    {
      "./BaseView": { BaseView: class {} },
      "../../utils/locale": locale,
    },
    {
      Zotero: {
        getMainWindow: () => win,
        Utilities: { Internal: { copyTextToClipboard: nativeCopy } },
      },
      ztoolkit: {
        log() {},
        ProgressWindow: class {
          createLine(line) {
            notifications.push(line);
            return this;
          }
          show() {}
        },
      },
    },
  );
  return {
    view: Object.create(SummaryView.prototype),
    notifications,
    created,
    win,
  };
}

test("summary error copy uses the native Zotero 6 clipboard instead of denied browser APIs", async () => {
  const copies = [];
  const host = clipboardHost(
    (text) => copies.push(text),
    async () => {
      throw new Error("browser copy denied");
    },
  );
  await host.view.copyErrorToClipboard("Deep-read diagnostics 中文");
  assert.deepEqual(copies, ["Deep-read diagnostics 中文"]);
  assert.equal(host.notifications[0].type, "success");
  assert.equal(host.created.length, 0);
});

test("summary error copy checks the HTML fallback result and cleans up on failure", async () => {
  const host = clipboardHost(() => {
    throw new Error("native clipboard unavailable");
  }, undefined);
  await host.view.copyErrorToClipboard("Deep-read diagnostics");
  assert.equal(host.created.length, 1);
  assert.equal(host.created[0].namespace, "http://www.w3.org/1999/xhtml");
  assert.equal(host.created[0].removed, true);
  assert.equal(host.notifications[0].type, "fail");
});
