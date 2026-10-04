/**
 * Opt-in integration test: actual AgentRunner, tools and LLMService against an API,
 * with an in-memory Zotero fixture. Never opens or modifies the user's library.
 * AGENT_TEST_API_URL / AGENT_TEST_API_KEY / AGENT_TEST_MODEL are required.
 * AGENT_TEST_PDF_MODEL enables a second test using an original Base64 PDF.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { build } from "esbuild";

const apiUrl = process.env.AGENT_TEST_API_URL;
const apiKey = process.env.AGENT_TEST_API_KEY;
const model = process.env.AGENT_TEST_MODEL;
if (!apiUrl || !apiKey || !model) {
  throw new Error(
    "Set AGENT_TEST_API_URL, AGENT_TEST_API_KEY and AGENT_TEST_MODEL.",
  );
}
const directory = path.resolve(".scaffold/agent-tests");
await mkdir(directory, { recursive: true });
const outfile = path.join(directory, "live-bundle.mjs");
await build({
  stdin: {
    contents: `export { AgentRunner } from './src/modules/agent/AgentRunner';
      export { defaultAgentOptions } from './src/modules/agent/types';
      export { createLibraryTools } from './src/modules/agent/tools/libraryTools';
      export { LLMService } from './src/modules/llmService';`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  define: { __env__: '"test"' },
  outfile,
  logLevel: "silent",
});

const verificationCode = `BUTLER-PDF-${randomBytes(5).toString("hex").toUpperCase()}`;
function makePdf() {
  const lines = [
    "Alpha: a synthetic research paper",
    "Original measured accuracy: 91.7 percent.",
    `Verification code: ${verificationCode}`,
    "Limitations: a single synthetic dataset; no clinical validation.",
  ];
  const stream = `BT /F1 14 Tf 50 760 Td ${lines.map((line, i) => `${i ? "0 -24 Td " : ""}(${line}) Tj`).join("\n")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
const pdf = makePdf();
const records = new Map();
function item(id, title, extra = {}) {
  const record = {
    id,
    key: `FIX${id}KEY`,
    libraryID: 1,
    deleted: false,
    itemType: "journalArticle",
    dateAdded: "2026-01-01 00:00:00",
    getField: (field) =>
      ({
        title,
        date: "2026",
        abstractNote: "Synthetic research fixture",
        DOI: `10.0000/fixture${id}`,
      })[field] || "",
    getCreators: () => [{ firstName: "Test", lastName: "Researcher" }],
    getTags: () => [],
    getCollections: () => [],
    getNotes: () => [id + 2],
    getAttachments: () => [id + 1],
    isRegularItem: () => true,
    isNote: () => false,
    isAttachment: () => false,
    ...extra,
  };
  records.set(id, record);
  return record;
}
for (const [id, title, score] of [
  [101, "Alpha", "90.0"],
  [201, "Beta", "85.2"],
]) {
  item(id, title);
  item(id + 1, `${title}.pdf`, {
    parentID: id,
    itemType: "attachment",
    attachmentContentType: "application/pdf",
    getFilePathAsync: async () => "fixture.pdf",
    isRegularItem: () => false,
    isAttachment: () => true,
  });
  item(id + 2, `${title} summary`, {
    parentID: id,
    itemType: "note",
    getNote: () =>
      `AI-generated note for ${title}. Reported accuracy ${score} percent. Single synthetic dataset; original paper has not been verified.`,
    getTags: () => [{ tag: "AI-Generated" }],
    isRegularItem: () => false,
    isNote: () => true,
  });
}
let requests = 0,
  pdfRequests = 0,
  writes = 0;
const endpoints = [
  {
    id: "fixture-main",
    name: "Live smoke coordinator",
    providerType: "openai-compat",
    apiUrl,
    apiKey,
    model,
    pdfProcessMode: "base64",
    enabled: true,
  },
];
if (process.env.AGENT_TEST_PDF_MODEL)
  endpoints.push({
    ...endpoints[0],
    id: "fixture-pdf",
    name: "Live smoke PDF reader",
    model: process.env.AGENT_TEST_PDF_MODEL,
    providerType: process.env.AGENT_TEST_PDF_PROVIDER || "openai-compat",
  });
const prefs = new Map(
  Object.entries({
    llmEndpoints: JSON.stringify(endpoints),
    maxRetries: "1",
    requestTimeout: "180000",
    enableMaxTokens: false,
    stream: false,
    autoContinuationRounds: "0",
    pdfProcessMode: "base64",
    llmRoutingStrategy: "priority",
  }),
);
globalThis.addon = { data: {} };
globalThis.ztoolkit = { log() {}, getGlobal: (name) => globalThis[name] };
// Only fixture plain text is parsed here; production uses Firefox DOMParser.
globalThis.DOMParser = class {
  parseFromString(text) {
    return { querySelectorAll: () => [], body: { textContent: text } };
  }
};
globalThis.IOUtils = { exists: async () => true };
globalThis.Zotero = {
  locale: "en-US",
  Prefs: {
    get: (key) => prefs.get(key.replace(/^extensions\.zotero\.aiButler\./, "")),
    set: (key, value) =>
      prefs.set(key.replace(/^extensions\.zotero\.aiButler\./, ""), value),
  },
  Libraries: {
    userLibraryID: 1,
    isEditable: () => true,
    get: () => ({ libraryID: 1, editable: true }),
  },
  URI: { getLibraryURI: () => "http://zotero.org/users/local/fixture" },
  Items: {
    getAsync: async (ids) =>
      Array.isArray(ids)
        ? ids.map((id) => records.get(id)).filter(Boolean)
        : records.get(ids),
  },
  Collections: { getByLibrary: () => [] },
  DB: {
    executeTransaction: async () => {
      writes++;
      throw new Error("Read-only test attempted a library write.");
    },
  },
  File: { getBinaryContentsAsync: async () => pdf.toString("binary") },
  Search: class {
    conditions = [];
    addCondition(...condition) {
      this.conditions.push(condition);
    }
    async search() {
      const notes = this.conditions.some(
        ([key, op, value]) =>
          key === "itemType" && op === "is" && value === "note",
      );
      const query =
        this.conditions
          .find(([key, op]) => op === "contains")?.[2]
          ?.toLowerCase() || "";
      return [...records.values()]
        .filter(
          (record) =>
            (notes ? record.isNote() : record.isRegularItem()) &&
            (!query ||
              `${record.getField("title")} ${record.getNote?.() || ""}`
                .toLowerCase()
                .includes(query)),
        )
        .map((record) => record.id);
    }
  },
  HTTP: {
    async request(method, url, options) {
      requests++;
      if (options.body?.includes("data:application/pdf;base64,")) pdfRequests++;
      const controller = new AbortController();
      options.requestObserver?.({ abort: () => controller.abort() });
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(options.timeout || 180000),
      ]);
      const response = await fetch(url, {
        method,
        headers: options.headers,
        body: options.body,
        signal,
      });
      const responseText = await response.text();
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        error.xmlhttp = { status: response.status, responseText };
        throw error;
      }
      return {
        responseText,
        response:
          options.responseType === "json"
            ? JSON.parse(responseText)
            : responseText,
        status: response.status,
      };
    },
  },
};
const { AgentRunner, defaultAgentOptions, createLibraryTools, LLMService } =
  await import(pathToFileURL(outfile));
function newSession(prompt, extra = {}) {
  return {
    id: "session-live-fixture",
    title: "Live fixture",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "idle",
    permission: "read-only",
    options: {
      ...defaultAgentOptions(1),
      endpointId: "fixture-main",
      maxOutputTokens: 4096,
      maxSteps: 20,
      ...extra,
    },
    messages: [{ role: "user", content: prompt }],
    events: [],
    plan: [],
    team: [],
    artifacts: {},
    pendingApprovals: [],
    context: {
      estimatedTokens: 0,
      compactions: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
  };
}
async function run(session) {
  const runner = new AgentRunner({
    turn: (request) => LLMService.agentTurn(request),
    tools: createLibraryTools(),
    save: async () => {},
    changed: () => {},
    approve: async () => {
      throw new Error("Read-only test requested approval.");
    },
    write: async () => {
      writes++;
      throw new Error("Read-only test attempted a mutation.");
    },
  });
  const started = Date.now();
  await runner.run(session, new AbortController().signal);
  const summary = {
    status: session.status,
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
    tools: session.events
      .filter((event) => event.type === "tool-start")
      .map((event) => event.toolName),
    team: session.team.map((member) => member.status),
    compactions: session.context.compactions,
    error: session.error,
  };
  console.log(JSON.stringify(summary));
  assert.equal(session.status, "completed", session.error);
  assert.equal(writes, 0);
  return (
    session.events
      .filter((event) => event.type === "assistant" && !event.memberId)
      .at(-1)?.text || ""
  );
}
if (
  !process.argv.includes("--pdf-only") &&
  !process.argv.includes("--compact-only")
) {
  const session = newSession(
    "Compare Alpha and Beta using the existing AI summary notes. First search the notes, then delegate independent verification of each note to two research teammates. Teammates must read the note text. Report both measured accuracies and limitations with Zotero source links. Do not read original PDFs or modify the library.",
  );
  const answer = await run(session);
  assert.ok(session.team.length >= 2, "Expected independent teammates");
  assert.match(answer, /90(?:\.0)?/);
  assert.match(answer, /85\.2/);
  assert.ok(
    session.events.some(
      (event) => event.type === "tool-start" && event.toolName === "read_note",
    ),
  );
  assert.match(answer, /zotero:\/\/select\//);
  console.log(
    "PASS live Qwen research loop, note disclosure, native tools and teammates",
  );
}
if (process.argv.includes("--compact-only")) {
  const session = newSession(
    "Remember the evidence code MEMORY-7319 and accuracy 91.7 for Alpha. Answer using the conversation evidence; no new tools are necessary.",
    { contextWindowTokens: 16384, maxOutputTokens: 2048 },
  );
  for (let i = 0; i < 24; i++) {
    session.messages.push({
      role: "assistant",
      content: `Verified Alpha evidence: code MEMORY-7319; accuracy 91.7. Reading round ${i}. ${"This synthetic study uses one dataset and has no clinical validation. ".repeat(80)}`,
    });
  }
  session.messages.push({
    role: "user",
    content:
      "State Alpha's evidence code, accuracy and limitation. Use existing evidence.",
  });
  const answer = await run(session);
  assert.ok(
    session.context.compactions > 0,
    "Expected automatic context compaction",
  );
  assert.match(answer, /MEMORY-7319/);
  assert.match(answer, /91\.7/);
  assert.ok(
    Object.values(session.artifacts).some((value) =>
      value.includes("Reading round 0"),
    ),
    "Original history must be recoverable",
  );
  console.log(
    "PASS live context compaction, evidence retention and continuation",
  );
}
if (
  process.env.AGENT_TEST_PDF_MODEL &&
  !process.argv.includes("--compact-only")
) {
  const session = newSession(
    "Use read_paper to read the ORIGINAL PDF of item 101. What are its exact verification code and measured accuracy? Report both verbatim and cite the paper. Do not rely on summary notes for these facts.",
    { deepReadEndpointId: "fixture-pdf", pdfPolicy: "pdf-base64" },
  );
  const answer = await run(session);
  assert.ok(pdfRequests > 0, "Expected a native Base64 PDF request");
  assert.ok(
    answer.includes(verificationCode),
    "The random PDF verification code was not recovered",
  );
  assert.match(answer, /91\.7/);
  assert.ok(
    !JSON.stringify(session).includes(pdf.toString("base64")),
    "PDF bytes must not enter Agent history",
  );
  console.log(
    "PASS isolated Base64 PDF specialist through LLMService; binary absent from parent history",
  );
}
console.log(JSON.stringify({ requests, pdfRequests, libraryWrites: writes }));
