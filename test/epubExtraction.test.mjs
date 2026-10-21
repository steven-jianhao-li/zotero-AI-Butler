import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { URL } from "node:url";
import vm from "node:vm";
import { transformSync } from "esbuild";

const locale = {
  getString: (key, options) =>
    key + (options?.args ? " " + JSON.stringify(options.args) : ""),
};

function loadSource(name, imports, globals = {}) {
  const module = { exports: {} };
  const { code } = transformSync(
    readFileSync(new URL("../src/" + name, import.meta.url), "utf8"),
    { loader: "ts", format: "cjs", target: "es2018" },
  );
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    Error,
    ...globals,
    require: (specifier) => imports[specifier] || {},
  });
  return module.exports;
}

function attachment(id, type, filename, dateAdded = "2026-01-01") {
  return {
    id,
    attachmentContentType: type,
    attachmentFilename: filename,
    dateAdded,
    isAttachment: () => true,
    getFilePathAsync: async () => "/fixtures/" + filename,
  };
}

function section(text, href = "chapter.xhtml") {
  return {
    href,
    doc: {
      body: {
        innerText: text,
        querySelectorAll: () => [],
      },
    },
  };
}

function extractionHost({
  native = "esm",
  supported = true,
  globals = {},
} = {}) {
  const calls = { imports: [], opened: [], closed: 0, logs: [], modes: [] };
  const state = {
    sections: [
      section("第一章\nFirst chapter."),
      section("第二章\nSecond chapter."),
    ],
    exists: true,
    attachments: [],
  };
  class Reader {
    constructor(path) {
      calls.opened.push(path);
      if (state.constructorError) throw state.constructorError;
    }
    async *getSectionDocuments() {
      for (const value of state.sections) {
        state.beforeSection?.(value);
        yield value;
      }
      if (state.readError) throw state.readError;
    }
    close() {
      calls.closed++;
      if (state.closeError) throw state.closeError;
    }
  }
  const loadModule = (kind, uri) => {
    calls.imports.push(uri);
    if (kind !== native) throw new Error("Module not available");
    return { EPUB: state.readerExport || Reader };
  };
  const Zotero = {
    Fulltext: supported ? { indexEPUB() {} } : {},
    Items: {
      getAsync: async (id) => state.attachments.find((a) => a.id === id),
    },
  };
  const host = {
    Zotero,
    ChromeUtils: {
      importESModule: (uri) => loadModule("esm", uri),
      import: (uri) => loadModule("jsm", uri),
    },
    IOUtils: { exists: async () => state.exists },
    ztoolkit: { log: (...args) => calls.logs.push(args) },
    ...globals,
  };
  const abort = loadSource("modules/llmproviders/shared/requestAbort.ts", {
    "../../../utils/locale": locale,
  });
  const epub = loadSource(
    "modules/epubExtractor.ts",
    {
      "../utils/locale": locale,
      "./llmproviders/shared/requestAbort": abort,
    },
    host,
  );
  const pdf = {
    isPdfAttachment: (a) => a.attachmentContentType === "application/pdf",
    getAllPdfAttachments: async () =>
      state.attachments.filter((a) => pdf.isPdfAttachment(a)),
    extractBase64FromItem: async () => "PDF_BASE64",
    extractTextFromItem: async (_item, mode) => {
      calls.modes.push(mode);
      return "PDF_TEXT";
    },
    extractTextFromAttachment: async () => "PDF_TEXT",
    cleanText: (text) => text.replace(/\s+/g, " ").trim(),
    truncateText: (text) => text.slice(0, 100000),
  };
  const snapshots = {
    getOldestWebSnapshotAttachment: async () =>
      state.attachments.find((a) => a.attachmentContentType === "text/html"),
    isWebSnapshotAttachment: async (a) =>
      a.attachmentContentType === "text/html",
    extractTextFromWebSnapshot: async () => "SNAPSHOT_TEXT",
  };
  const { ContentExtractor } = loadSource(
    "modules/contentExtractor.ts",
    {
      "../utils/locale": locale,
      "./pdfExtractor": { PDFExtractor: pdf },
      "./snapshotExtractor": { SnapshotExtractor: snapshots },
      "./epubExtractor": epub,
      "./llmproviders/shared/requestAbort": abort,
    },
    host,
  );
  const { LLMService } = loadSource(
    "modules/llmService.ts",
    {
      "../utils/locale": locale,
      "../utils/prefs": { getPref() {} },
      "./contentExtractor": { ContentExtractor },
      "./pdfExtractor": {
        PDFExtractor: pdf,
        PDFTextExtractionError: { find() {} },
      },
      "./epubExtractor": epub,
      "./llmproviders/shared/completion": {
        LLMIncompleteError: class extends Error {},
      },
      "./llmproviders/shared/requestAbort": abort,
    },
    host,
  );
  const item = { getAttachments: () => state.attachments.map((a) => a.id) };
  const book = attachment(1, "application/epub+zip", "book.epub");
  state.attachments.push(book);
  return {
    ...epub,
    ContentExtractor,
    LLMService,
    state,
    calls,
    host,
    item,
    book,
  };
}

for (const native of ["esm", "jsm"]) {
  test(`${native}: native EPUB modules load lazily and follow section order`, async () => {
    const h = extractionHost({ native });
    assert.deepEqual(h.calls.imports, []);
    const text = await h.EPUBExtractor.extractTextFromAttachment(h.book);
    assert.equal(text, "第一章\nFirst chapter.\n\n第二章\nSecond chapter.");
    assert.equal(h.calls.closed, 1);
    const imports = h.calls.imports.length;
    assert.equal(imports, native === "esm" ? 1 : 2);
    assert.equal(h.EPUBExtractor.isSupported(), true);
    assert.equal(h.calls.imports.length, imports);
  });
}

test("JSM-only hosts do not need importESModule", async () => {
  const h = extractionHost({ native: "jsm" });
  delete h.host.ChromeUtils.importESModule;
  assert.match(
    await h.EPUBExtractor.extractTextFromAttachment(h.book),
    /First chapter/,
  );
  assert.deepEqual(h.calls.imports, ["chrome://zotero/content/EPUB.jsm"]);
});

test("Zotero 6 skips EPUB safely without importing unsupported modules", async () => {
  const h = extractionHost({ supported: false });
  delete h.host.ChromeUtils.importESModule;
  assert.equal(await h.ContentExtractor.hasAnalyzableAttachment(h.item), false);
  assert.equal(
    await h.ContentExtractor.hasUsableAnalyzableAttachment(h.item),
    false,
  );
  assert.equal(
    await h.ContentExtractor.getUnavailableAttachmentMessage([h.item]),
    "epub-error-unavailable",
  );
  await assert.rejects(
    h.ContentExtractor.extractAnalyzableContentFromItem(h.item, false),
    {
      name: "EPUBExtractionError",
      message: "epub-error-unavailable",
      suppressTaskRetry: true,
    },
  );
  assert.deepEqual(h.calls.imports, []);
});

test("missing ChromeUtils, removed modules, and incompatible exports disable only EPUB", async () => {
  for (const options of [
    { globals: { ChromeUtils: undefined } },
    { native: "missing" },
    { invalidExport: true },
  ]) {
    const h = extractionHost(options);
    if (options.invalidExport) h.state.readerExport = class {};
    assert.equal(h.EPUBExtractor.isSupported(), false);
    const count = h.calls.imports.length;
    assert.equal(h.EPUBExtractor.isSupported(), false);
    assert.equal(h.calls.imports.length, count);
    const snapshot = attachment(2, "text/html", "snapshot.html");
    h.state.attachments.push(snapshot);
    const result = await h.ContentExtractor.extractAnalyzableContentFromItem(
      h.item,
      true,
    );
    assert.equal(result.kind, "web-snapshot");
    assert.equal(result.content, "SNAPSHOT_TEXT");
  }
});

test("attachment detection works without isEPUBAttachment on the host", () => {
  const h = extractionHost();
  assert.equal(h.EPUBExtractor.isEpubAttachment(h.book), true);
  assert.equal(
    h.EPUBExtractor.isEpubAttachment(attachment(2, "", "CHAPTER.EPUB")),
    true,
  );
  assert.equal(
    h.EPUBExtractor.isEpubAttachment({ isAttachment: () => false }),
    false,
  );
  assert.equal(
    h.EPUBExtractor.isEpubAttachment(
      attachment(3, "application/pdf", "paper.pdf"),
    ),
    false,
  );
});

test("linked URLs do not access file-only attachment properties", async () => {
  const h = extractionHost({ supported: false });
  h.state.attachments = [
    {
      id: 2,
      isAttachment: () => true,
      isFileAttachment: () => false,
      get attachmentFilename() {
        throw new Error("Not a file attachment");
      },
    },
  ];
  assert.equal(await h.ContentExtractor.hasAnalyzableAttachment(h.item), false);
  assert.deepEqual(h.calls.imports, []);
});

test("native reader closes after failures, empty books, and cancellation", async () => {
  const broken = extractionHost();
  broken.state.readError = new Error("Invalid spine");
  await assert.rejects(
    broken.EPUBExtractor.extractTextFromAttachment(broken.book),
    /epub-error-extraction-failed.*Invalid spine/,
  );
  assert.equal(broken.calls.closed, 1);

  const empty = extractionHost();
  empty.state.sections = [{ doc: {} }, section("   ")];
  await assert.rejects(
    empty.EPUBExtractor.extractTextFromAttachment(empty.book),
    /epub-error-no-readable-text/,
  );
  assert.equal(empty.calls.closed, 1);

  const cancelled = extractionHost();
  const signal = { aborted: false };
  cancelled.state.beforeSection = () => {
    signal.aborted = true;
  };
  await assert.rejects(
    cancelled.ContentExtractor.extractTextFromAnalyzableAttachment(
      cancelled.book,
      signal,
    ),
    { name: "LLMRequestAbortError" },
  );
  assert.equal(cancelled.calls.closed, 1);
});

test("unreadable files and bad EPUB containers produce actionable errors", async () => {
  const missing = extractionHost();
  missing.state.exists = false;
  assert.equal(
    await missing.ContentExtractor.hasUsableAnalyzableAttachment(missing.item),
    false,
  );
  await assert.rejects(
    missing.EPUBExtractor.extractTextFromAttachment(missing.book),
    /epub-error-file-unavailable/,
  );
  assert.equal(missing.calls.opened.length, 0);

  const broken = extractionHost();
  broken.state.constructorError = new Error("Not a ZIP file");
  await assert.rejects(
    broken.EPUBExtractor.extractTextFromAttachment(broken.book),
    /epub-error-extraction-failed.*Not a ZIP file/,
  );
});

test("cleanup failures do not discard successfully extracted text", async () => {
  const h = extractionHost();
  h.state.closeError = new Error("Close failed");
  assert.match(
    await h.EPUBExtractor.extractTextFromAttachment(h.book),
    /Second chapter/,
  );
  assert.equal(h.calls.logs.length, 1);
});

test("cancellation during file checks prevents EPUB parsing", async () => {
  const h = extractionHost();
  const signal = { aborted: false };
  h.host.IOUtils.exists = async () => {
    signal.aborted = true;
    return false;
  };
  await assert.rejects(
    h.EPUBExtractor.extractTextFromAttachment(h.book, signal),
    {
      name: "LLMRequestAbortError",
    },
  );
  assert.equal(h.calls.opened.length, 0);
});

test("PDF stays preferred and preserves its selected input policy on old and new hosts", async () => {
  for (const supported of [false, true]) {
    const h = extractionHost({ supported });
    const pdf = attachment(3, "application/pdf", "paper.pdf");
    h.state.attachments.push(pdf);
    assert.equal(
      (await h.ContentExtractor.getPreferredAnalyzableAttachments(h.item))[0],
      pdf,
    );
    const base64 = await h.ContentExtractor.extractAnalyzableContentFromItem(
      h.item,
      true,
      "base64",
    );
    assert.equal(base64.content, "PDF_BASE64");
    assert.equal(base64.isBase64, true);
    const text = await h.ContentExtractor.extractAnalyzableContentFromItem(
      h.item,
      false,
      "mineru",
    );
    assert.equal(text.content, "PDF_TEXT");
    assert.deepEqual(h.calls.modes, ["mineru"]);
    assert.deepEqual(h.calls.imports, []);
  }
});

test("old hosts continue analyzing webpage snapshots with an unsupported EPUB present", async () => {
  const h = extractionHost({ supported: false });
  const snapshot = attachment(2, "text/html", "snapshot.html");
  h.state.attachments.push(snapshot);
  assert.equal(
    await h.ContentExtractor.hasUsableAnalyzableAttachment(h.item),
    true,
  );
  const result = await h.ContentExtractor.extractAnalyzableContentFromItem(
    h.item,
    true,
    "base64",
  );
  assert.equal(result.kind, "web-snapshot");
  assert.equal(result.content, "SNAPSHOT_TEXT");
  assert.deepEqual(h.calls.imports, []);
});

test("the oldest EPUB is available to scanning and read as text under every PDF policy", async () => {
  const h = extractionHost();
  const older = attachment(
    2,
    "application/epub+zip",
    "older.epub",
    "2025-01-01",
  );
  h.state.attachments.push(older, attachment(3, "text/html", "snapshot.html"));
  assert.equal(
    await h.ContentExtractor.hasUsableAnalyzableAttachment(h.item),
    true,
  );
  assert.equal(
    (await h.ContentExtractor.getPreferredAnalyzableAttachments(h.item))[0],
    older,
  );
  for (const mode of ["base64", "text", "mineru"]) {
    const result = await h.ContentExtractor.extractAnalyzableContentFromItem(
      h.item,
      mode === "base64",
      mode,
    );
    assert.equal(result.attachment, older);
    assert.equal(result.kind, "epub");
    assert.equal(result.isBase64, false);
    assert.match(result.content, /Second chapter/);
  }
});

test("LLM content routing uses EPUB text for item and attachment requests under all policies", async () => {
  const h = extractionHost();
  const provider = {
    capabilities: { supportsPdfBase64: true, maxPdfFiles: 1 },
  };
  for (const policy of ["pdf-base64", "text", "mineru"]) {
    for (const kind of ["zotero-item", "analyzable-attachment"]) {
      const warnings = [];
      const result = await h.LLMService.resolveContent(
        provider,
        { kind, item: h.item, attachment: h.book, policy },
        warnings,
        true,
      );
      assert.equal(result.isBase64, false);
      assert.match(result.content, /First chapter.*Second chapter/);
      if (kind === "zotero-item")
        assert.ok(warnings.includes("llm-warning-epub-used"));
    }
  }
});

test("EPUB extraction failures do not rotate endpoints or masquerade as API failures", async () => {
  const h = extractionHost();
  h.state.readError = new Error("Invalid spine");
  await assert.rejects(
    h.LLMService.runEndpointAttempts(
      [{ id: "fixture", name: "Fixture", providerType: "fixture" }],
      3,
      {},
      true,
      () => h.EPUBExtractor.extractTextFromAttachment(h.book),
    ),
    { name: "EPUBExtractionError" },
  );
  assert.equal(h.calls.opened.length, 1);
});
