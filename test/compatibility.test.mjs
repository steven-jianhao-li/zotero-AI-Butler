import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";
import { posix } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { build } from "esbuild";
import AdmZip from "adm-zip";
import { buildCompatibility } from "../scripts/build-compatibility.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("legacy asset transforms preserve modern bytes", async () => {
  await mkdir(".scaffold/compatibility-tests", { recursive: true });
  const directory = await mkdtemp(".scaffold/compatibility-tests/assets-");
  const script = "const label = record?.label ?? 'modern';";
  const html =
    "<html><head></head><body><script>const label = record?.label;</script></body></html>";
  try {
    await mkdir(`${directory}/addon/content/scripts`, { recursive: true });
    await writeFile(
      `${directory}/addon/content/scripts/compatibility.js`,
      "var legacy = true;",
    );
    await writeFile(`${directory}/addon/content/scripts/main.js`, script);
    await writeFile(`${directory}/addon/content/viewer.html`, html);
    await buildCompatibility({ dist: directory });
    assert.equal(
      await readFile(`${directory}/addon/content/scripts/main.js`, "utf8"),
      script,
    );
    assert.equal(
      await readFile(`${directory}/addon/content/viewer.html`, "utf8"),
      html,
    );
    assert.doesNotMatch(
      await readFile(
        `${directory}/addon/legacy/content/scripts/main.js`,
        "utf8",
      ),
      /\?\./,
    );
    assert.match(
      await readFile(`${directory}/addon/legacy/content/viewer.html`, "utf8"),
      /compatibility\.js/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const version of ["7.0.32", "8.0", "10.0.6", "11.0-beta.1"]) {
  test("modern host " + version + " never loads legacy polyfills", async () => {
    const { context, calls, host } = bootstrapHost();
    host.version = version;
    host.__addonInstance__ = host.AIButler;
    host.PreferencePanes = { register() {} };
    host.ItemPaneManager = { registerSection() {} };
    host.ItemTreeManager = { registerColumn() {} };
    host.Reader = { registerEventListener() {} };
    Object.assign(context, {
      Zotero: host,
      IOUtils: {},
      PathUtils: {},
      Localization: function () {},
      ChromeUtils: { importESModule: () => ({ setTimeout, clearTimeout }) },
    });
    vm.runInContext(await read("addon/bootstrap.js"), context);
    await context.startup({ id: "test", rootURI: "file:///addon/" }, 1);
    assert.equal(context.pluginScope.setTimeout, setTimeout);
    assert.equal(context.pluginScope.clearTimeout, clearTimeout);
    assert.ok(
      calls.some((call) =>
        call.uri?.endsWith("content/scripts/__addonRef__.js"),
      ),
    );
    assert.ok(
      !calls.some(
        (call) =>
          call.uri?.includes("compatibility.js") ||
          call.uri?.includes("legacy/"),
      ),
    );
    await context.shutdown({}, 4);
  });
}

for (const nativeGlobals of [false, true]) {
  test(`modern startup without a main window resolves browser globals (${nativeGlobals ? "native" : "late windows"})`, async () => {
    const { context, host } = bootstrapHost();
    let mainWindow = null;
    host.getMainWindow = () => mainWindow;
    host.version = "7.0.32";
    host.__addonInstance__ = host.AIButler;
    host.PreferencePanes = { register() {} };
    host.ItemPaneManager = { registerSection() {} };
    host.ItemTreeManager = { registerColumn() {} };
    host.Reader = { registerEventListener() {} };
    const names = ["DOMParser", "XMLSerializer", "AbortController"];
    const createConstructors = () =>
      Object.fromEntries(names.map((name) => [name, class {}]));
    const native = createConstructors();
    Object.assign(context, {
      Zotero: host,
      IOUtils: {},
      PathUtils: {},
      Localization: function () {},
      ChromeUtils: { importESModule: () => ({ setTimeout, clearTimeout }) },
      ...(nativeGlobals ? native : {}),
    });
    vm.runInContext(await read("addon/bootstrap.js"), context);
    await context.startup({ id: "test", rootURI: "file:///addon/" }, 1);
    for (const name of names) {
      assert.equal(
        context.pluginScope[name],
        nativeGlobals ? native[name] : undefined,
      );
    }
    for (let windowNumber = 0; windowNumber < 2; windowNumber++) {
      mainWindow = createConstructors();
      for (const name of names) {
        const constructor = nativeGlobals ? native[name] : mainWindow[name];
        assert.equal(context.pluginScope[name], constructor);
        assert.ok(new context.pluginScope[name]() instanceof constructor);
      }
    }
    await context.shutdown({}, 4);
  });
}

test("missing modern capabilities reject startup instead of selecting legacy", async () => {
  const { context, calls, host } = bootstrapHost();
  host.version = "10.0.6";
  context.Zotero = host;
  vm.runInContext(await read("addon/bootstrap.js"), context);
  await assert.rejects(
    context.startup({ rootURI: "file:///addon/" }, 1),
    /modern.*PreferencePanes/i,
  );
  assert.equal(calls.length, 0);
});

test("modern documents are untouched even when a DOM capability is absent", async () => {
  const compiled = await build({
    entryPoints: ["src/compatibility/document.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "DocumentCompatibility",
    logLevel: "silent",
  });
  const prototype = {};
  const document = { defaultView: { Element: { prototype } } };
  const context = vm.createContext({ Zotero: { version: "10.0.6" } });
  vm.runInContext(compiled.outputFiles[0].text, context);
  context.DocumentCompatibility.prepareDocument(document);
  assert.equal(document.createXULElement, undefined);
  assert.deepEqual(prototype, {});
});

test("failed modern startup releases its scope and chrome registration", async () => {
  const { context, calls, host } = bootstrapHost();
  host.version = "10.0.6";
  host.__addonInstance__ = host.AIButler;
  host.PreferencePanes = { register() {} };
  host.ItemPaneManager = { registerSection() {} };
  host.ItemTreeManager = { registerColumn() {} };
  host.Reader = { registerEventListener() {} };
  host.AIButler.hooks.onStartup = async () => {
    throw new Error("startup failure");
  };
  Object.assign(context, {
    Zotero: host,
    IOUtils: {},
    PathUtils: {},
    Localization: function () {},
    ChromeUtils: { importESModule: () => ({ setTimeout, clearTimeout }) },
  });
  vm.runInContext(await read("addon/bootstrap.js"), context);
  await assert.rejects(
    context.startup({ rootURI: "file:///addon/" }, 1),
    /startup failure/,
  );
  assert.ok(calls.includes("shutdown"));
  assert.ok(calls.includes("destruct"));
  assert.equal(context.pluginScope, null);
});

for (const version of [undefined, "", "unknown", "5.0.96", "7garbage"]) {
  test(
    "unrecognized or unsupported version " +
      version +
      " rejects before side effects",
    async () => {
      const { context, calls, host } = bootstrapHost();
      host.version = version;
      context.Zotero = host;
      vm.runInContext(await read("addon/bootstrap.js"), context);
      await assert.rejects(
        context.startup({ rootURI: "file:///addon/" }, 1),
        /Zotero version/,
      );
      assert.equal(calls.length, 0);
    },
  );
}

test("Agent HTML elements retain their namespace in legacy chrome documents", async () => {
  const compiled = await build({
    entryPoints: ["src/modules/views/agent/dom.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "AgentDOM",
    logLevel: "silent",
  });
  const document = {
    createElement: () =>
      assert.fail(
        "Legacy createElement would create an XML element without dataset",
      ),
    createElementNS: (namespace, tag) => ({
      namespaceURI: namespace,
      tagName: tag,
    }),
  };
  const context = vm.createContext({ Zotero: { version: "6.0.27" } });
  vm.runInContext(compiled.outputFiles[0].text, context);
  const element = context.AgentDOM.element(
    document,
    "div",
    "agent-timeline",
    "Timeline",
  );
  assert.equal(element.namespaceURI, "http://www.w3.org/1999/xhtml");
  assert.equal(element.className, "agent-timeline");
  assert.equal(element.textContent, "Timeline");
});

test("settings inputs remain native HTML controls in legacy chrome documents", async () => {
  const compiled = await build({
    entryPoints: ["src/modules/views/ui/components.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "Components",
    logLevel: "silent",
  });
  const document = {
    createElement: () =>
      assert.fail("Legacy createElement would create an XML input"),
    createElementNS: (namespace, tag) => ({
      namespaceURI: namespace,
      tagName: tag,
      style: {},
      addEventListener() {},
    }),
  };
  const context = vm.createContext({
    Zotero: { getMainWindow: () => ({ document }) },
  });
  vm.runInContext(compiled.outputFiles[0].text, context);
  const input = context.Components.createInput(
    "model",
    "text",
    "isolated-model",
  );
  assert.equal(input.namespaceURI, "http://www.w3.org/1999/xhtml");
  assert.equal(input.type, "text");
  assert.equal(input.value, "isolated-model");
  assert.equal(input.id, "setting-model");
});

test("shared view elements retain their HTML namespace in legacy chrome documents", async () => {
  const compiled = await build({
    entryPoints: ["src/modules/views/BaseView.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "Views",
    logLevel: "silent",
  });
  const document = {
    createElement: () =>
      assert.fail(
        "Legacy createElement would create an XML element without dataset",
      ),
    createElementNS: (namespace, tag) => ({
      namespaceURI: namespace,
      tagName: tag,
    }),
  };
  const context = vm.createContext({
    Zotero: { getMainWindow: () => ({ document }) },
  });
  vm.runInContext(compiled.outputFiles[0].text, context);
  const view = new context.Views.BaseView("test-view");
  const element = view.createElement("div", { id: "task-row" });
  assert.equal(element.namespaceURI, "http://www.w3.org/1999/xhtml");
  assert.equal(element.id, "task-row");
});

function bootstrapHost() {
  const calls = [];
  const observers = new Set();
  const listeners = new Set();
  const host = {
    version: "6.0.27",
    AIButler: {
      hooks: {
        onStartup: async () => calls.push("startup"),
        onShutdown: async () => calls.push("shutdown"),
      },
    },
    logError: assert.fail,
    getMainWindow: () => window,
  };
  const window = {
    Zotero: host,
    document: { documentElement: { getAttribute: () => "navigator:browser" } },
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener),
  };
  const services = {
    scriptSecurityManager: { getSystemPrincipal: () => ({}) },
    obs: {
      addObserver: (observer) => observers.add(observer),
      removeObserver: (observer) => observers.delete(observer),
    },
    wm: {
      getMostRecentWindow: () => window,
      addListener: (listener) => calls.push(listener),
      removeListener: (listener) => calls.push(listener),
    },
    scriptloader: {
      loadSubScript: (uri, scope) => calls.push({ uri, scope }),
      loadSubScriptWithOptions: (uri, options) =>
        calls.push({ uri, scope: options.target, options }),
    },
    prefs: {
      getDefaultBranch: () => ({
        setBoolPref() {},
        setIntPref() {},
        setStringPref() {},
      }),
    },
    io: { newURI: (uri) => uri },
  };
  const context = vm.createContext({
    Services: services,
    Components: {
      utils: {
        import: (uri) =>
          uri.includes("Services")
            ? { Services: services }
            : { OS: { File: {}, Path: {} } },
        Sandbox: function () {
          return {};
        },
      },
      classes: {
        "@zotero.org/Zotero;1": {
          getService: () =>
            assert.fail(
              "Cold startup must not initialize the Zotero XPCOM service",
            ),
        },
        "@mozilla.org/addons/addon-manager-startup;1": {
          getService: () => ({
            registerChrome: (...args) => {
              calls.push(args);
              return { destruct: () => calls.push("destruct") };
            },
          }),
        },
      },
      interfaces: {},
    },
    APP_SHUTDOWN: 2,
  });
  return { context, calls, host, window, services, observers, listeners };
}

test("one XPI contains both host manifests without lowering modern support", () => {
  const zip = new AdmZip(
    fileURLToPath(
      new URL("../.scaffold/build/zotero-ai-butler.xpi", import.meta.url),
    ),
  );
  const manifest = JSON.parse(zip.readAsText("manifest.json"));
  assert.equal(manifest.applications.zotero.strict_min_version, "7.0.0");
  assert.equal(manifest.applications.zotero.strict_max_version, "10.*");
  const legacy = zip.readAsText("install.rdf");
  assert.match(legacy, /<em:minVersion>6\.0\.27<\/em:minVersion>/);
  assert.match(legacy, /<em:maxVersion>6\.\*<\/em:maxVersion>/);
  assert.match(legacy, /zotero@chnm\.gmu\.edu/);
  assert.doesNotMatch(legacy, /em:updateURL|__addon/);
  assert.ok(
    zip
      .readAsText("chrome.manifest")
      .includes("content aiButler legacy/content/"),
  );
  assert.ok(zip.getEntry("legacy/content/scripts/compatibility.js"));
  assert.ok(!zip.getEntry("content/scripts/compatibility.js"));
  assert.ok(zip.getEntry("content/scripts/aiButler.js"));
  assert.ok(zip.getEntry("legacy/content/scripts/aiButler.js"));
  assert.ok(zip.getEntry("content/legacyOptions.xul"));
  for (const entry of zip
    .getEntries()
    .filter((entry) => entry.entryName.endsWith(".html"))) {
    const assertPolyfill = entry.entryName.startsWith("legacy/")
      ? assert.match
      : assert.doesNotMatch;
    assertPolyfill(
      zip.readAsText(entry),
      /<head>\s*<script src="scripts\/compatibility\.js"><\/script>/i,
      entry.entryName,
    );
  }
});

test("legacy bootstrap resolves resourceURI and cleans its window listener", async () => {
  const { context, calls, host, observers, listeners } = bootstrapHost();
  vm.runInContext(await read(".scaffold/build/addon/bootstrap.js"), context);
  await context.startup(
    {
      id: "zotero-ai-butler@github.com",
      resourceURI: { spec: "file:///addon/" },
    },
    1,
  );
  const script = calls.find(
    (call) => call.uri === "file:///addon/legacy/content/scripts/aiButler.js",
  );
  assert.equal(script.scope.Zotero, host);
  assert.equal(script.scope.globalThis, script.scope);
  assert.ok(
    calls.some(
      (call) =>
        call.uri === "file:///addon/legacy/content/scripts/compatibility.js",
    ),
  );
  assert.ok(calls.includes("startup"));
  assert.equal(observers.size, 0);
  assert.equal(listeners.size, 0);
  await context.shutdown({}, 4);
  assert.ok(calls.includes("shutdown"));
  assert.equal(context.pluginScope, null);
});

test("cold startup waits for the host window without forcing host initialization", async () => {
  const { context, calls, window, services, observers } = bootstrapHost();
  services.wm.getMostRecentWindow = () => null;
  vm.runInContext(await read(".scaffold/build/addon/bootstrap.js"), context);
  const startup = context.startup(
    { resourceURI: { spec: "file:///addon/" } },
    1,
  );
  assert.equal(calls.length, 0);
  assert.equal(observers.size, 1);
  [...observers][0].observe(window, "chrome-document-global-created");
  await startup;
  assert.ok(calls.includes("startup"));
  assert.equal(observers.size, 0);
});

test("disabling before a host window exists cancels pending startup", async () => {
  const { context, calls, services, observers } = bootstrapHost();
  services.wm.getMostRecentWindow = () => null;
  vm.runInContext(await read(".scaffold/build/addon/bootstrap.js"), context);
  const startup = context.startup(
    { resourceURI: { spec: "file:///addon/" } },
    1,
  );
  await context.shutdown({}, 4);
  await startup;
  assert.equal(observers.size, 0);
  assert.equal(calls.length, 0);
});

test("modern bootstrap preserves native capabilities and permits trusted packaged scripts", async () => {
  const { context, calls, host } = bootstrapHost();
  host.version = "7.0.32";
  host.PreferencePanes = { register() {} };
  host.ItemPaneManager = { registerSection() {} };
  host.ItemTreeManager = { registerColumn() {} };
  host.Reader = { registerEventListener() {} };
  context.Zotero = host;
  context.IOUtils = {};
  context.PathUtils = {};
  context.Localization = function () {};
  context.ChromeUtils = { importESModule: () => ({}) };
  vm.runInContext(await read(".scaffold/build/addon/bootstrap.js"), context);
  await context.startup(
    { id: "zotero-ai-butler@github.com", rootURI: "jar:file:///addon.xpi!/" },
    1,
  );
  const script = calls.find(
    (call) => call.uri === "jar:file:///addon.xpi!/content/scripts/aiButler.js",
  );
  assert.equal(script.scope.IOUtils, context.IOUtils);
  assert.equal(script.scope.PathUtils, context.PathUtils);
  assert.equal(script.scope.Localization, context.Localization);
  assert.equal(script.options.allowUnsafeURL, true);
  assert.ok(!calls.some((call) => call.uri?.endsWith("prefs.js")));
  await context.shutdown({}, 4);
  assert.ok(calls.includes("destruct"));
});

test("legacy filesystem enumeration waits for resource cleanup", async () => {
  let closed = false;
  const context = vm.createContext({
    OS: {
      Path: {},
      File: {
        DirectoryIterator: class {
          async nextBatch() {
            return [{ path: "first" }, { path: "second" }];
          }
          async close() {
            await new Promise((resolve) => setTimeout(resolve, 10));
            closed = true;
          }
        },
      },
    },
  });
  vm.runInContext(
    await read(".scaffold/build/addon/legacy/content/scripts/compatibility.js"),
    context,
  );
  assert.deepEqual(Array.from(await context.IOUtils.getChildren("directory")), [
    "first",
    "second",
  ]);
  assert.equal(closed, true);
});

test("runtime polyfills are sandbox-local and do not replace modern filesystem APIs", async () => {
  const hostToSorted = Array.prototype.toSorted;
  const context = vm.createContext({ IOUtils: {}, PathUtils: {} });
  const nativeIO = context.IOUtils;
  const nativePaths = context.PathUtils;
  vm.runInContext("delete Array.prototype.toSorted", context);
  vm.runInContext(
    await read(".scaffold/build/addon/legacy/content/scripts/compatibility.js"),
    context,
  );
  assert.equal(vm.runInContext("typeof [].toSorted", context), "function");
  assert.equal(context.IOUtils, nativeIO);
  assert.equal(context.PathUtils, nativePaths);
  assert.equal(Array.prototype.toSorted, hostToSorted);
});

test("legacy filesystem defaults match native idempotent directory and removal contracts", async () => {
  const created = [];
  let removal;
  const context = vm.createContext({
    OS: {
      Path: { dirname: posix.dirname },
      File: {
        exists: async (path) => path === "/",
        makeDir: async (path, options) =>
          created.push({ path, ignoreExisting: options.ignoreExisting }),
        remove: async (path, options) => {
          removal = { path, ignoreAbsent: options.ignoreAbsent };
        },
      },
    },
  });
  vm.runInContext(
    await read(".scaffold/build/addon/legacy/content/scripts/compatibility.js"),
    context,
  );
  await context.IOUtils.makeDirectory("/parent/child");
  assert.deepEqual(created, [
    { path: "/parent", ignoreExisting: true },
    { path: "/parent/child", ignoreExisting: true },
  ]);
  await context.IOUtils.remove("/absent");
  assert.deepEqual(removal, { path: "/absent", ignoreAbsent: true });
});

test("legacy columns use Zotero 6 persistence sets and preserve later plugin patches", async () => {
  const compiled = await build({
    entryPoints: ["src/compatibility/legacyUi.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "LegacyUI",
    logLevel: "silent",
  });
  const item = {
    getField: (field) => {
      assert.notEqual(field, "aiButler-status");
      return "Native field";
    },
  };
  const originalField = item.getField;
  const view = {
    getColumns: () => [],
    getRow: () => ({ ref: item }),
    _renderCell() {},
    forceUpdate() {},
    tree: { invalidate() {} },
  };
  const originalColumns = view.getColumns;
  const window = {
    document: { createXULElement() {}, querySelectorAll: () => [] },
    ZoteroPane: { itemsView: view },
    addEventListener() {},
    removeEventListener() {},
  };
  const context = vm.createContext({
    Zotero: { version: "6.0.27" },
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(compiled.outputFiles[0].text, context);
  context.LegacyUI.registerLegacyWindow(window);
  context.LegacyUI.legacyItemColumns.registerColumn({
    dataKey: "aiButler-status",
    zoteroPersist: ["width"],
    dataProvider: () => "Completed",
  });
  const column = view.getColumns()[0];
  assert.ok(column.zoteroPersist.has("width"));
  assert.equal(view.getRow(0).ref.getField("aiButler-status"), "Completed");
  assert.equal(item.getField("title"), "Native field");
  const pluginColumns = view.getColumns;
  const laterColumns = function () {
    return pluginColumns.call(this).concat({ dataKey: "another-plugin" });
  };
  view.getColumns = laterColumns;
  context.LegacyUI.legacyItemColumns.unregisterColumn("aiButler-status");
  assert.equal(item.getField, originalField);
  assert.equal(view.getColumns, laterColumns);
  assert.equal(view.getColumns()[0].dataKey, "another-plugin");
  assert.notEqual(view.getColumns, originalColumns);
  context.LegacyUI.unregisterLegacyUi();
});

test("inline math preserves adjacent formulas and double-dollar boundaries without lookbehind", async () => {
  const compiled = await build({
    entryPoints: ["src/modules/noteMarkdown.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "NoteMarkdown",
    logLevel: "silent",
  });
  const context = vm.createContext({ Zotero: { version: "6.0.27" } });
  vm.runInContext(compiled.outputFiles[0].text, context);
  const rendered = context.NoteMarkdown.replaceInlineMath(
    "$a$\\(b\\)$c$ $$display$$ $d$",
    (formula) => `<${formula}>`,
  );
  assert.equal(rendered, "<a><b><c> $$display$$ <d>");
  assert.equal(
    context.NoteMarkdown.replaceInlineMath("$line\nbreak$", assert.fail),
    "$line\nbreak$",
  );
});

test("reader windows outside the main window receive disposable toolbar buttons", async () => {
  const compiled = await build({
    entryPoints: ["src/compatibility/legacyUi.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "LegacyUI",
    logLevel: "silent",
  });
  const listeners = new Map();
  const window = {
    document: {},
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
  };
  let removed = false;
  const toolbar = { querySelector: () => null, appendChild() {} };
  const document = { querySelector: () => toolbar, defaultView: window };
  const reader = { _window: window, _iframeWindow: { document } };
  const originalOpen = async function () {
    this._readers.push(reader);
    return reader;
  };
  const api = { _readers: [], open: originalOpen };
  const context = vm.createContext({
    Zotero: { Reader: api, logError: assert.fail },
  });
  vm.runInContext(compiled.outputFiles[0].text, context);
  context.LegacyUI.registerLegacyReaderToolbar(() => ({
    remove: () => {
      removed = true;
    },
  }));
  assert.equal(await api.open(), reader);
  context.LegacyUI.unregisterLegacyUi();
  assert.equal(removed, true);
  assert.equal(api.open, originalOpen);
  assert.equal(listeners.size, 0);
});
