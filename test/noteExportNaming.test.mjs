import assert from "node:assert/strict";
import { atob, btoa, Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { URL } from "node:url";
import { TextDecoder, TextEncoder } from "node:util";
import vm from "node:vm";
import { transformSync } from "esbuild";

const compiled = new Map();
function loadSource(name, imports = {}, globals = {}) {
  if (!compiled.has(name)) {
    compiled.set(
      name,
      transformSync(
        readFileSync(
          new URL(`../src/modules/${name}.ts`, import.meta.url),
          "utf8",
        ),
        { loader: "ts", format: "cjs", target: "es2018" },
      ).code,
    );
  }
  const module = { exports: {} };
  vm.runInNewContext(compiled.get(name), {
    module,
    exports: module.exports,
    require: (name) => {
      assert.ok(name in imports, `Missing import fixture: ${name}`);
      return imports[name];
    },
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    ztoolkit: { log() {} },
    ...globals,
  });
  return module.exports;
}

function fixture() {
  const preferences = new Map();
  const files = new Map();
  const directories = new Set();
  const parent = { id: 1, name: "机器学习", parentID: false };
  const collection = {
    id: 2,
    name: "Transformer",
    parentID: 1,
    getChildItems: () => [42],
  };
  const item = {
    id: 42,
    key: "ABCD1234",
    getDisplayTitle: () => "Attention Is All You Need",
    getField: (field) =>
      ({ title: item.getDisplayTitle(), date: "2017-06-12" })[field],
    getCreatorsJSON: () => [
      { creatorType: "author", firstName: "Ashish", lastName: "Vaswani" },
    ],
    getAttachments: () => [],
    getCollections: () => [2],
    isRegularItem: () => true,
  };
  const locale = { getString: (key) => key };
  const globals = {
    Zotero: {
      Collections: {
        get: (id) => ({ 1: parent, 2: collection })[id],
        getByParent: () => [],
      },
      Items: { getAsync: async (id) => (id === 42 ? item : undefined) },
    },
    PathUtils: { join: path.win32.join },
    IOUtils: {
      exists: async (name) => files.has(name) || directories.has(name),
      makeDirectory: async (name) => directories.add(name),
      write: async (name, bytes) => files.set(name, bytes),
    },
  };
  const paths = loadSource(
    "noteExportPaths",
    { "../utils/locale": locale },
    globals,
  );
  const metadata = loadSource("llmNoteMetadata", { "../utils/locale": locale });
  const naming = loadSource("noteExportNaming", {
    "./llmNoteMetadata": metadata,
    "./noteExportPaths": paths,
  });
  const config = loadSource("noteExportConfig", {
    "./noteExportNaming": naming,
    "../utils/prefs": {
      getPref: (key) => preferences.get(key),
      setPref: (key, value) => preferences.set(key, value),
    },
  });
  const wrap = (modelId, kind = "summary") =>
    metadata.LLMNoteMetadataService.wrapHtml("<p>Saved note</p>", {
      schema: "AI_BUTLER_LLM_NOTE_BLOCK",
      version: 1,
      blockId: `${kind}-${modelId}`,
      task: kind,
      providerId: "saved-provider",
      providerName: "Saved provider",
      modelId,
      generatedAt: "2026-08-01T00:00:00.000Z",
    });
  const notes = {
    summary: { rawHtml: wrap("saved-summary-model"), note: {} },
    deepRead: { rawHtml: wrap("saved-deep-model", "deepRead"), note: {} },
  };
  const deepRead = { hasIncompleteDeepReadContent: () => false };
  const service = loadSource(
    "noteExportService",
    {
      "./aiNoteService": {
        AiNoteService: { findNoteRecord: async (_, kind) => notes[kind] },
      },
      "./noteExportConfig": config,
      "./noteExportNaming": naming,
      "./noteExportPaths": paths,
      "./noteExportDocxConverter": {
        noteHtmlToDocxBytes: async () => new TextEncoder().encode("docx"),
      },
      "./noteExportMarkdown": { noteHtmlToMarkdown: async () => "markdown" },
      "./deepReadEngine": deepRead,
      "../utils/locale": locale,
    },
    globals,
  );
  const automatic = loadSource(
    "autoNoteExportManager",
    {
      "./noteExportConfig": config,
      "./noteExportService": service,
      "./taskQueue": {},
    },
    globals,
  );
  const collectionPath = paths.getCollectionPathInfo(collection);
  const values = naming.getNoteExportFilenameValues({
    item,
    collectionPath,
    kind: "summary",
    html: notes.summary.rawHtml,
  });
  return {
    ...naming,
    ...config,
    ...service,
    ...automatic,
    item,
    collection,
    collectionPath,
    notes,
    values,
    preferences,
    files,
    wrap,
  };
}

test("new and existing installs use the collection hierarchy and paper title (#395)", () => {
  const f = fixture();
  assert.equal(
    f.getNoteExportConfig().filenameTemplate,
    f.DEFAULT_NOTE_EXPORT_FILENAME_TEMPLATE,
  );
  assert.equal(
    f.formatNoteExportFilename(
      f.getNoteExportConfig().filenameTemplate,
      f.values,
      "md",
    ),
    "机器学习 - Transformer - Attention Is All You Need - summary.md",
  );
  assert.equal(
    f.formatNoteExportFilename(
      f.DEFAULT_NOTE_EXPORT_FILENAME_TEMPLATE,
      { ...f.values, noteType: "deep-read" },
      "docx",
    ),
    "机器学习 - Transformer - Attention Is All You Need - deep-read.docx",
  );
});

test("templates persist and empty or invalid preferences safely fall back", () => {
  const f = fixture();
  const template = "{firstAuthor} ({year}) - {title} - {itemKey} - {noteType}";
  f.setNoteExportConfig({ filenameTemplate: ` ${template} ` });
  assert.equal(f.getNoteExportConfig().filenameTemplate, template);
  assert.equal(
    f.formatNoteExportFilename(template, f.values, "md"),
    "Vaswani (2017) - Attention Is All You Need - ABCD1234 - summary.md",
  );
  for (const invalid of [
    "{unknown}",
    "{title",
    "title}",
    "{{title}}",
    "{}",
    "{constructor}",
  ]) {
    assert.equal(f.isValidNoteExportFilenameTemplate(invalid), false);
    f.preferences.set("noteExportFilenameTemplate", invalid);
    assert.equal(
      f.getNoteExportConfig().filenameTemplate,
      f.DEFAULT_NOTE_EXPORT_FILENAME_TEMPLATE,
    );
  }
  f.setNoteExportConfig({ filenameTemplate: "  " });
  assert.equal(
    f.getNoteExportConfig().filenameTemplate,
    f.DEFAULT_NOTE_EXPORT_FILENAME_TEMPLATE,
  );
});

test("optional fields use item metadata and the note's recorded models", () => {
  const f = fixture();
  const values = f.getNoteExportFilenameValues({
    item: {
      ...f.item,
      getCreatorsJSON: () => [
        { creatorType: "editor", lastName: "Editor" },
        { creatorType: "author", name: "Research Institute" },
      ],
    },
    collectionPath: f.collectionPath,
    kind: "summary",
    html:
      f.wrap("provider/model-a") +
      f.wrap("model-b") +
      f.wrap("provider/model-a"),
  });
  assert.equal(values.firstAuthor, "Research Institute");
  assert.equal(values.model, "provider/model-a + model-b");
  assert.equal(values.collection, "Transformer");
  assert.equal(values.year, "2017");
  assert.equal(
    f.formatNoteExportFilename("{collection} - {model}", values, "md"),
    "Transformer - provider_model-a + model-b - summary.md",
  );
});

test("missing metadata and untitled items have stable names without current API settings", () => {
  const f = fixture();
  const values = f.getNoteExportFilenameValues({
    item: {
      ...f.item,
      getDisplayTitle: () => "",
      getField: () => "",
      getCreatorsJSON: () => [],
    },
    collectionPath: f.collectionPath,
    kind: "summary",
    html: "<p>Legacy note without metadata</p>",
  });
  assert.equal(values.model, "");
  assert.equal(values.firstAuthor, "");
  assert.equal(values.year, "");
  assert.equal(
    f.formatNoteExportFilename("{title}", values, "md"),
    "item-ABCD1234 - summary.md",
  );
  assert.equal(
    f.formatNoteExportFilename("{model}", values, "md"),
    "item-ABCD1234 - summary.md",
  );
});

test("omitting noteType or supplying an extension cannot merge the two note kinds", () => {
  const f = fixture();
  for (const extension of ["md", "docx"]) {
    const summary = f.formatNoteExportFilename(
      "{title}.md",
      f.values,
      extension,
    );
    const deep = f.formatNoteExportFilename(
      "{title}.md",
      { ...f.values, noteType: "deep-read" },
      extension,
    );
    assert.equal(summary, `Attention Is All You Need - summary.${extension}`);
    assert.equal(deep, `Attention Is All You Need - deep-read.${extension}`);
  }
});

test("filenames stay single safe path segments, including reserved Windows names", () => {
  const f = fixture();
  const filename = f.formatNoteExportFilename(
    "../../{title} - {noteType}",
    { ...f.values, title: 'A/B\\C:*?"<>|\u0001' },
    "md",
  );
  assert.doesNotMatch(filename, /[<>:"/\\|?*]/);
  assert.ok([...filename].every((char) => char.charCodeAt(0) >= 32));
  assert.equal(path.win32.basename(filename), filename);
  assert.equal(
    f.formatNoteExportFilename("CON.{noteType}", f.values, "md"),
    "_CON.summary.md",
  );
  assert.equal(
    f
      .formatNoteExportFilename("{title}...   ", f.values, "md")
      .endsWith("summary.md"),
    true,
  );
});

test("long Unicode names retain type, uniqueness, and matching MD/DOCX stems", () => {
  const f = fixture();
  const values = { ...f.values, title: "论文📚".repeat(100) };
  const template = "{collectionPath} - {title} - {noteType}";
  const summary = f.formatNoteExportFilename(template, values, "md");
  const docx = f.formatNoteExportFilename(template, values, "docx");
  const deep = f.formatNoteExportFilename(
    template,
    { ...values, noteType: "deep-read" },
    "md",
  );
  const other = f.formatNoteExportFilename(
    template,
    { ...values, title: `${values.title}different` },
    "md",
  );
  for (const name of [summary, docx, deep, other]) {
    assert.ok(Buffer.byteLength(name, "utf8") <= 240);
    assert.doesNotMatch(name, /\uFFFD/);
  }
  assert.match(summary, /summary-[a-f0-9]+\.md$/);
  assert.match(deep, /deep-read-[a-f0-9]+\.md$/);
  assert.equal(summary.slice(0, -3), docx.slice(0, -5));
  assert.notEqual(summary, other);
  assert.equal(f.formatNoteExportFilename(template, values, "md"), summary);
});

test("collection export writes all four configured names and preserves skip/overwrite", async () => {
  const f = fixture();
  f.setNoteExportConfig({ rootPath: "C:\\Exports" });
  const first = await f.NoteExportService.exportCollection({
    collection: f.collection,
  });
  assert.equal(first.failedItems, 0);
  assert.equal(first.exportedFiles, 4);
  const expected = ["summary", "deep-read"].flatMap((kind) =>
    ["docx", "md"].map(
      (ext) =>
        `机器学习 - Transformer - Attention Is All You Need - ${kind}.${ext}`,
    ),
  );
  assert.deepEqual(
    [...f.files.keys()].map((name) => path.win32.basename(name)).sort(),
    expected.sort(),
  );
  const savedPath = [...f.files.keys()].find((name) =>
    name.endsWith("summary.md"),
  );
  const manualEdit = new TextEncoder().encode("Manually edited");
  f.files.set(savedPath, manualEdit);
  const second = await f.NoteExportService.exportCollection({
    collection: f.collection,
  });
  assert.equal(second.skippedFiles, 4);
  assert.equal(second.exportedFiles, 0);
  assert.equal(f.files.get(savedPath), manualEdit);
  const overwrite = await f.NoteExportService.exportCollection({
    collection: f.collection,
    conflictStrategy: "overwrite",
  });
  assert.equal(overwrite.exportedFiles, 4);
  assert.equal(new TextDecoder().decode(f.files.get(savedPath)), "markdown");
});

test("automatic export uses the same saved custom template and each note's own model", async () => {
  const f = fixture();
  f.setNoteExportConfig({
    enabled: true,
    rootPath: "C:\\Exports",
    watchedCollectionIds: [2],
    filenameTemplate: "{title} - {model}",
  });
  assert.equal(
    await f.AutoNoteExportManager.getInstance().exportIfEligible(42),
    true,
  );
  assert.deepEqual(
    [...f.files.keys()].map((name) => path.win32.basename(name)).sort(),
    ["md", "docx"]
      .flatMap((ext) => [
        `Attention Is All You Need - saved-summary-model - summary.${ext}`,
        `Attention Is All You Need - saved-deep-model - deep-read.${ext}`,
      ])
      .sort(),
  );
});
