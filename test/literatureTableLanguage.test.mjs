import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { URL } from "node:url";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { marked } from "marked";

function fixture(language, reply) {
  const item = { id: 1, libraryID: 7, getField: () => "Example" };
  const pdf = { parentID: item.id };
  const requests = [];
  const saves = [];
  let note;
  let failSave = false;
  const globals = {
    ztoolkit: { log() {} },
    Zotero: {
      Items: { getAsync: async () => item },
      DB: { executeTransaction: (callback) => callback() },
      Item: class {
        setNote(html) {
          this.html = html;
        }
        getNote() {
          return this.html;
        }
        addTag() {}
        saveTx() {
          return this.save();
        }
        save() {
          if (failSave) throw new Error("save failed");
          saves.push(this);
          note = this;
        }
        erase() {
          if (this === note) note = undefined;
        }
      },
    },
  };
  const prefs = {
    getPref: (key) =>
      ({ outputLanguage: language, tableStrategy: "skip" })[key],
  };
  const locale = {
    getString: (key, options) =>
      [key, ...Object.values(options?.args || {})].join(" "),
  };
  function load(path, imports) {
    const module = { exports: {} };
    const code = readFileSync(
      new URL("../src/" + path + ".ts", import.meta.url),
      "utf8",
    );
    vm.runInNewContext(
      transformSync(code, { loader: "ts", format: "cjs" }).code,
      {
        module,
        require: (name) => imports[name] || {},
        ...globals,
      },
    );
    return module.exports;
  }
  const output = load("utils/outputLanguage", { "./prefs": prefs });
  const table = load("modules/literatureTable", { "../utils/locale": locale });
  const { LiteratureReviewService: service } = load(
    "modules/literatureReviewService",
    {
      marked: { marked },
      "../utils/prefs": prefs,
      "../utils/locale": locale,
      "../utils/outputLanguage": output,
      "../utils/prompts": {
        getConfiguredTableFillPrompt: () => "Fill " + "${tableTemplate}",
      },
      "./literatureTable": table,
      "./llmService": {
        generate: async (request) => {
          requests.push(
            output.applyOutputLanguageToPrompt(request.prompt, {
              task: request.task,
            }),
          );
          return {
            text:
              request.task === "table"
                ? typeof reply === "function"
                  ? await reply()
                  : reply
                : "Answer",
          };
        },
      },
      "./llmNoteMetadata": {
        LLMNoteMetadataService: { fromResponse: () => null },
      },
      "./noteMarkdown": { replaceInlineMath: (text) => text },
    },
  );
  service.findTableNoteItem = async () => note;
  service.postProcessCitations = async (text) => text;
  service.createStandaloneReviewNote = async () => ({});
  return {
    requests,
    saves,
    service,
    item,
    fill: (schema, prompt = "Fill ${tableTemplate}") =>
      service.fillTableForSingleAttachment(item, pdf, schema, prompt),
    append: (schema, keys) =>
      service.generateTargetedAnswer({}, [pdf], "Question", "Answer", schema, {
        selectedTableEntries: keys,
        appendedTableEntries: keys,
      }),
    read: () => service.findTableNote(item),
    seed: (content) => service.saveTableNote(item, content),
    failSave: () => {
      failSave = true;
    },
  };
}

const zhHeader = "| 指标 | 结果 | 证据 |\n|:---|---|---:|";
const zhTemplate = zhHeader + "\n| 样本 | | |\n| 发现 | | |";
const filled =
  zhHeader + "\n| 样本 | Ten | p. 3 |\n| 发现 | Effective | p. 4 |";
const enTemplate = "| Field | Value |\n|---|---|\n| Sample | |";

test("full fills translate values in either direction while keeping exact headers and keys", async () => {
  const zh = fixture("English", filled);
  assert.equal(await zh.fill(zhTemplate), filled);
  assert.match(zh.requests[0], /cell values in English/);
  assert.match(zh.requests[0], /first-column row keys.*verbatim/);
  assert.doesNotMatch(zh.requests[0], /entire final answer/);

  const response = enTemplate.replace("Sample | |", "Sample | 十例 |");
  const en = fixture("简体中文", response);
  assert.equal(await en.fill(enTemplate), response);
  assert.match(en.requests[0], /仅用简体中文填写内容单元格/);
  assert.match(en.requests[0], /逐字保留模板的表头/);
});

test("translated headers, translated keys, missing rows and wrong widths cannot replace a full table", async () => {
  for (const response of [
    filled.replace("指标", "Measure"),
    filled.replace("样本", "Sample"),
    filled.split("\n").slice(0, -1).join("\n"),
    filled.replace("Ten | p. 3", "Ten"),
  ]) {
    const f = fixture("English", response);
    await assert.rejects(
      f.fill(zhTemplate),
      /table-(schema-mismatch|missing-entries)/,
    );
    assert.equal(f.saves.length, 0);
  }
});

test("an empty output setting and a custom format-only prompt retain their original fill behavior", async () => {
  assert.equal(
    await fixture("", "custom result").fill(enTemplate),
    "custom result",
  );
  assert.equal(
    await fixture("English", "custom result").fill(enTemplate, "Use my format"),
    "custom result",
  );
});

test("append uses each paper's header and accepts multiple bare rows, duplicates and unrelated rows", async () => {
  const first = "| 剂量 | 10 mg | p. 2 |";
  const second = "| A\\|B $& | Both | p. 3 |";
  const f = fixture(
    "English",
    [first, first, "| Other | ignored | p. 1 |", second].join("\n"),
  );
  const original =
    filled + "\n\nA saved note with literal &lt; and | punctuation.";
  await f.seed(original);
  await f.append(enTemplate, ["样本", "剂量", "A\\|B $&"]);
  assert.equal(
    await f.read(),
    original.replace(
      "\n\nA saved",
      () => "\n" + first + "\n" + second + "\n\nA saved",
    ),
  );
  assert.ok(f.requests[0].includes(zhHeader));
  assert.ok(f.requests[0].includes("| A\\|B $& | | |"));
  assert.ok(f.requests[1].includes(first));
  assert.ok(!f.requests[1].includes("Effective"));
  assert.equal(f.saves.length, 2);

  await f.append(enTemplate, ["剂量"]);
  assert.equal(f.saves.length, 2);
  assert.equal(f.requests.length, 3); // only the final question on the repeat
});

test("append creates a table from the supplied schema when the paper has no cached table", async () => {
  const result = "| Field | Value |\n|---|---|\n| Method | 随机抽样 |";
  const f = fixture("中文", result);
  await f.append(enTemplate, ["Method"]);
  assert.equal(await f.read(), result);
});

test("translated or missing append keys surface an error before any partial save or final answer", async () => {
  for (const original of ["", filled]) {
    for (const response of [
      "| Dose | Ten | p. 1 |\n| Safety | Yes | p. 2 |",
      "| 剂量 | Ten | p. 1 |",
      zhHeader + "\n| 剂量 | Ten | p. 1 |\n| Safety | Yes | p. 2 |",
      "| 剂量 | Ten |\n| 安全性 | Yes | p. 2 |",
    ]) {
      const f = fixture("English", response);
      if (original) await f.seed(original);
      await assert.rejects(
        f.append(zhTemplate, ["剂量", "安全性"]),
        /Example.*table-(schema-mismatch|missing-entries)/,
      );
      assert.equal(await f.read(), original || null);
      assert.equal(f.requests.length, 1);
      assert.equal(f.saves.length, original ? 1 : 0);
    }
  }
});

test("skip and a failed overwrite both keep the previous note", async () => {
  const f = fixture("English", "");
  await f.seed(filled);
  await f.seed("skipped");
  assert.equal(await f.read(), filled);
  f.failSave();
  await assert.rejects(
    f.service.saveTableNote(f.item, "new", true),
    /save failed/,
  );
  assert.equal(await f.read(), filled);
});

test("an append cannot overwrite a table changed while the provider was answering", async () => {
  const newer = filled + "\n| Added | By another task | p. 3 |";
  const f = fixture("English", async () => {
    await f.service.saveTableNote(f.item, newer, true);
    return "| 剂量 | Ten | p. 1 |";
  });
  await f.seed(filled);
  await assert.rejects(f.append(zhTemplate, ["剂量"]), /table-changed/);
  assert.equal(await f.read(), newer);
});

test("cached papers with different schemas keep their headers and report missing selected keys", () => {
  const { service } = fixture("English", "");
  const selected = service.filterTableResultsByEntries(
    new Map([
      [1, filled],
      [2, "| Field | Value |\n|---|---|\n| Sample | Ten |"],
    ]),
    ["样本", "Sample"],
  );
  const evidence = service.aggregateTableContents(selected);
  assert.ok(evidence.includes(zhHeader));
  assert.ok(evidence.includes("| Field | Value |"));
  assert.ok(evidence.includes("table-missing-entries Sample"));
  assert.ok(evidence.includes("table-missing-entries 样本"));
  assert.ok(!evidence.includes("Effective"));
});
