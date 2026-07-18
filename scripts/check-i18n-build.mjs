import fs from "node:fs";
import path from "node:path";
import { parse as parseFluentResource } from "@fluent/syntax";
import pkg from "../package.json" with { type: "json" };
const { config } = pkg;

const ROOT = process.cwd();
const BUILD_ROOT = path.join(ROOT, ".scaffold", "build", "addon");
const LOCALES = ["en-US", "zh-CN"];
const FTL_FILES = ["addon.ftl", "mainWindow.ftl", "preferences.ftl"];
const REF = config.addonRef;
let failed = false;

function fail(message) {
  failed = true;
  console.error(`[i18n-build] ${message}`);
}

function patternText(pattern) {
  if (!pattern?.elements?.length) return "";
  return pattern.elements
    .map((element) => {
      if (element.type === "TextElement") return element.value || "";
      if (element.type === "Placeable") return "{}";
      return "";
    })
    .join("")
    .trim();
}

function fluentEntryHasContent(entry) {
  if (entry.type !== "Message" && entry.type !== "Term") return true;
  if (patternText(entry.value)) return true;
  return (entry.attributes || []).some((attribute) =>
    patternText(attribute.value),
  );
}

function emptyFluentAttributes(entry) {
  if (entry.type !== "Message" && entry.type !== "Term") return [];
  return (entry.attributes || [])
    .filter((attribute) => !patternText(attribute.value))
    .map((attribute) => attribute.id.name);
}

function hasMojibake(source) {
  return /\uFFFD|\u9983|\u9241|锟斤拷|Ã.|Â.|â€¦|â€™|â€œ|â€|ðŸ|鎬|瀵|鏈|鍙|缂|鏀|閫|鎵|姝|鈴\?/.test(
    source,
  );
}

function assertNoScaffoldPlaceholders(rel, source) {
  if (
    /__(?:addonRef|addonName|addonID|buildVersion|description|homepage|author|updateURL)__/.test(
      source,
    )
  ) {
    fail(`Built file still contains scaffold placeholders: ${rel}`);
  }
}

function readSourceKeys(locale, ftl) {
  const sourcePath = path.join(ROOT, "addon", "locale", locale, ftl);
  return fs
    .readFileSync(sourcePath, "utf8")
    .split(/\r?\n/)
    .map((line) => /^([\w-]+)\s*=/.exec(line)?.[1])
    .filter(Boolean)
    .sort();
}

function normalizeFluentNode(node) {
  if (node === null || node === undefined) return node;
  if (Array.isArray(node)) return node.map((item) => normalizeFluentNode(item));
  if (typeof node !== "object") return node;

  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => key !== "span")
      .map(([key, value]) => [key, normalizeFluentNode(value)]),
  );
}

function messagesById(parsed) {
  return new Map(
    parsed.body
      .filter((entry) => entry.type === "Message")
      .map((entry) => [entry.id.name, entry]),
  );
}

function assertBuiltMessageBodiesMatchSource(locale, ftl, built) {
  const sourcePath = path.join(ROOT, "addon", "locale", locale, ftl);
  const source = fs.readFileSync(sourcePath, "utf8");
  const sourceParsed = parseFluentResource(source, { withSpans: false });
  const sourceMessages = messagesById(sourceParsed);
  const builtMessages = messagesById(built.parsed);

  for (const [sourceKey, sourceEntry] of sourceMessages) {
    const builtKey = `${REF}-${sourceKey}`;
    const builtEntry = builtMessages.get(builtKey);
    if (!builtEntry) continue;

    const sourceBody = normalizeFluentNode({
      value: sourceEntry.value,
      attributes: sourceEntry.attributes || [],
    });
    const builtBody = normalizeFluentNode({
      value: builtEntry.value,
      attributes: builtEntry.attributes || [],
    });

    if (JSON.stringify(builtBody) !== JSON.stringify(sourceBody)) {
      fail(
        `Built FTL body differs from source: locale/${locale}/${REF}-${ftl}: ${builtKey}`,
      );
    }
  }
}
function readBuildMessages(locale, ftl) {
  const buildName = `${REF}-${ftl}`;
  const buildPath = path.join(BUILD_ROOT, "locale", locale, buildName);
  if (!fs.existsSync(buildPath)) {
    fail(`Missing built FTL file: locale/${locale}/${buildName}`);
    return { keys: [], source: "", parsed: { body: [] }, buildPath };
  }
  const source = fs.readFileSync(buildPath, "utf8");
  const parsed = parseFluentResource(source, { withSpans: false });
  const junkEntries = parsed.body.filter((entry) => entry.type === "Junk");
  if (junkEntries.length) {
    fail(`Built FTL has Fluent syntax errors: locale/${locale}/${buildName}`);
  }
  for (const entry of parsed.body) {
    if (
      (entry.type === "Message" || entry.type === "Term") &&
      !fluentEntryHasContent(entry)
    ) {
      fail(
        `Built FTL has an empty entry: locale/${locale}/${buildName}: ${entry.id.name}`,
      );
    }
    for (const attr of emptyFluentAttributes(entry)) {
      fail(
        `Built FTL has an empty attribute: locale/${locale}/${buildName}: ${entry.id.name}.${attr}`,
      );
    }
  }
  if (hasMojibake(source)) {
    fail(
      `Built FTL contains common mojibake markers: locale/${locale}/${buildName}`,
    );
  }
  const keys = parsed.body
    .filter((entry) => entry.type === "Message")
    .map((entry) => entry.id.name)
    .sort();
  return { keys, source, parsed, buildPath };
}

function assertSame(label, actual, expected) {
  const missing = expected.filter((key) => !actual.includes(key));
  const extra = actual.filter((key) => !expected.includes(key));
  if (missing.length || extra.length) {
    fail(`${label} key mismatch`);
    if (missing.length) console.error(`  Missing: ${missing.join(", ")}`);
    if (extra.length) console.error(`  Extra: ${extra.join(", ")}`);
  }
}

if (!fs.existsSync(BUILD_ROOT)) {
  fail("Build addon directory does not exist. Run npm run build first.");
} else {
  const builtKeysByLocaleAndFile = new Map();
  for (const locale of LOCALES) {
    for (const ftl of FTL_FILES) {
      const sourceKeys = readSourceKeys(locale, ftl);
      const expectedBuiltKeys = sourceKeys.map((key) => `${REF}-${key}`).sort();
      const built = readBuildMessages(locale, ftl);
      builtKeysByLocaleAndFile.set(`${locale}/${ftl}`, built.keys);

      assertSame(
        `Built ${locale}/${REF}-${ftl}`,
        built.keys,
        expectedBuiltKeys,
      );
      assertBuiltMessageBodiesMatchSource(locale, ftl, built);

      for (const key of built.keys) {
        if (!key.startsWith(`${REF}-`)) {
          fail(
            `Built key is not prefixed with ${REF}-: ${locale}/${REF}-${ftl}: ${key}`,
          );
        }
      }

      if (locale === "en-US" && /[\u4e00-\u9fff]/.test(built.source)) {
        fail(
          `Built English FTL contains Chinese text: locale/${locale}/${REF}-${ftl}`,
        );
      }
    }
  }

  const prefsXhtml = path.join(BUILD_ROOT, "content", "preferences.xhtml");
  if (!fs.existsSync(prefsXhtml)) {
    fail("Missing built preferences.xhtml");
  } else {
    const source = fs.readFileSync(prefsXhtml, "utf8");
    assertNoScaffoldPlaceholders("content/preferences.xhtml", source);
    if (hasMojibake(source)) {
      fail("Built preferences.xhtml contains common mojibake markers");
    }
    if (!source.includes(`href="${REF}-preferences.ftl"`)) {
      fail(`Built preferences.xhtml does not link ${REF}-preferences.ftl`);
    }
    const preferenceKeys =
      builtKeysByLocaleAndFile.get("en-US/preferences.ftl") || [];
    let dataL10nCount = 0;
    for (const match of source.matchAll(/data-l10n-id=["\']([^"\']+)["\']/g)) {
      dataL10nCount += 1;
      const key = match[1];
      if (!key.startsWith(`${REF}-`)) {
        fail(`Built preferences.xhtml data-l10n-id is not prefixed: ${key}`);
      }
      if (!preferenceKeys.includes(key)) {
        fail(
          `Built preferences.xhtml data-l10n-id is missing from built preferences FTL: ${key}`,
        );
      }
    }
    if (dataL10nCount === 0) {
      fail("Built preferences.xhtml has no data-l10n-id attributes");
    }
  }

  for (const rel of [
    "content/mindmap.html",
    "content/mindmapViewer.html",
    "content/imageSummaryViewer.html",
  ]) {
    const fullPath = path.join(BUILD_ROOT, rel);
    if (!fs.existsSync(fullPath)) {
      fail(`Missing built static page: ${rel}`);
      continue;
    }
    const pageSource = fs.readFileSync(fullPath, "utf8");
    assertNoScaffoldPlaceholders(rel, pageSource);
    if (hasMojibake(pageSource)) {
      fail(`Built static page contains common mojibake markers: ${rel}`);
    }
    if (!pageSource.includes("window.aiButlerL10n")) {
      fail(`Built static page is missing aiButlerL10n helper: ${rel}`);
    }
  }
}

if (failed) process.exit(1);
console.log("[i18n-build] Built locale artifacts are consistent.");
