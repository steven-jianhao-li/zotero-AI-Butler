import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { parse as parseFluentResource } from "@fluent/syntax";

const LOCALES = ["en-US", "zh-CN"];
const FTL_FILES = ["addon.ftl", "mainWindow.ftl", "preferences.ftl"];
const ROOT = process.cwd();

function readAllFtlKeys(locale = "en-US") {
  const keys = new Set();
  for (const ftl of FTL_FILES) {
    for (const key of readKeys(
      path.join(ROOT, "addon", "locale", locale, ftl),
    )) {
      keys.add(key);
    }
  }
  return keys;
}

function readKeyEntries(file) {
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line, index) => ({
      key: /^([\w-]+)\s*=/.exec(line)?.[1],
      line: index + 1,
    }))
    .filter((entry) => entry.key);
}

function readKeys(file) {
  return readKeyEntries(file)
    .map((entry) => entry.key)
    .sort();
}

function readMessages(file) {
  const messages = new Map();
  let currentKey = null;
  let currentLines = [];
  const flush = () => {
    if (currentKey) messages.set(currentKey, currentLines.join("\n"));
  };
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^([\w-]+)\s*=\s*(.*)$/.exec(line);
    if (match) {
      flush();
      currentKey = match[1];
      currentLines = [match[2] || ""];
    } else if (currentKey && (/^\s+/.test(line) || /^\s*\./.test(line))) {
      currentLines.push(line);
    }
  }
  flush();
  return messages;
}

function readMessageAttributes(file) {
  const attributes = new Map();
  let currentKey = null;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const messageMatch = /^([\w-]+)\s*=/.exec(line);
    if (messageMatch) {
      currentKey = messageMatch[1];
      if (!attributes.has(currentKey)) attributes.set(currentKey, new Set());
      continue;
    }
    const attrMatch = /^\s+\.([\w-]+)\s*=/.exec(line);
    if (currentKey && attrMatch) {
      attributes.get(currentKey).add(attrMatch[1]);
    }
  }
  return attributes;
}

function fluentArgSet(message) {
  return new Set(
    [...message.matchAll(/\{\s*\$([A-Za-z_][\w-]*)\s*\}/g)].map(
      (match) => match[1],
    ),
  );
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

function walkFluentNode(node, visitor) {
  if (!node || typeof node !== "object") return;
  visitor(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) walkFluentNode(child, visitor);
    } else {
      walkFluentNode(value, visitor);
    }
  }
}

function messageReferences(entry) {
  if (entry.type !== "Message" && entry.type !== "Term") return [];
  const refs = [];
  const collect = (node) => {
    if (node.type === "MessageReference") refs.push(node.id.name);
  };
  walkFluentNode(entry.value, collect);
  for (const attribute of entry.attributes || []) {
    walkFluentNode(attribute.value, collect);
  }
  return refs;
}

function variableReferences(entry) {
  if (entry.type !== "Message" && entry.type !== "Term") return [];
  const refs = [];
  const collect = (node) => {
    if (node.type === "VariableReference") refs.push(node.id.name);
  };
  walkFluentNode(entry.value, collect);
  for (const attribute of entry.attributes || []) {
    walkFluentNode(attribute.value, collect);
  }
  return refs;
}

function readFluentArgSets(file) {
  const parsed = parseFluentResource(fs.readFileSync(file, "utf8"), {
    withSpans: false,
  });
  const argSets = new Map();
  for (const entry of parsed.body) {
    if (entry.type === "Message") {
      argSets.set(entry.id.name, new Set(variableReferences(entry)));
    }
  }
  return argSets;
}

let failed = false;
const allFtlKeysByLocale = new Map(
  LOCALES.map((locale) => [locale, readAllFtlKeys(locale)]),
);

for (const locale of LOCALES) {
  const seenAcrossFiles = new Map();
  for (const ftl of FTL_FILES) {
    const ftlPath = path.join(ROOT, "addon", "locale", locale, ftl);
    const seenInFile = new Map();
    for (const { key, line } of readKeyEntries(ftlPath)) {
      if (seenInFile.has(key)) {
        failed = true;
        console.error(
          `[i18n] Duplicate FTL key in ${locale}/${ftl}: ${key} at lines ${seenInFile.get(
            key,
          )} and ${line}`,
        );
      } else {
        seenInFile.set(key, line);
      }

      if (seenAcrossFiles.has(key)) {
        const previous = seenAcrossFiles.get(key);
        failed = true;
        console.error(
          `[i18n] Duplicate FTL key across files in ${locale}: ${key} is defined in ${previous.ftl}:${previous.line} and ${ftl}:${line}`,
        );
      } else {
        seenAcrossFiles.set(key, { ftl, line });
      }
    }
  }
}

for (const ftl of FTL_FILES) {
  const enPath = path.join(ROOT, "addon", "locale", "en-US", ftl);
  const enSource = fs.readFileSync(enPath, "utf8");
  const parsed = parseFluentResource(enSource, { withSpans: false });
  const junkEntries = parsed.body.filter((entry) => entry.type === "Junk");
  if (junkEntries.length) {
    failed = true;
    console.error(`[i18n] en-US/${ftl} has Fluent syntax errors`);
    for (const entry of junkEntries) {
      console.error(`  ${JSON.stringify(entry.annotations || [])}`);
    }
  }

  const chineseLines = enSource
    .split(/\r?\n/)
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => /[\u4e00-\u9fff]/.test(line));
  if (chineseLines.length) {
    failed = true;
    console.error(`[i18n] en-US/${ftl} contains Chinese text`);
    for (const { line, index } of chineseLines) {
      console.error(`  ${index}: ${line.trim()}`);
    }
  }
}

for (const locale of LOCALES) {
  for (const ftl of FTL_FILES) {
    const ftlPath = path.join(ROOT, "addon", "locale", locale, ftl);
    const source = fs.readFileSync(ftlPath, "utf8");
    const parsed = parseFluentResource(source, { withSpans: false });
    const junkEntries = parsed.body.filter((entry) => entry.type === "Junk");
    if (junkEntries.length) {
      failed = true;
      console.error(`[i18n] ${locale}/${ftl} has Fluent syntax errors`);
      for (const entry of junkEntries) {
        console.error(`  ${JSON.stringify(entry.annotations || [])}`);
      }
    }

    for (const entry of parsed.body) {
      if (
        (entry.type === "Message" || entry.type === "Term") &&
        !fluentEntryHasContent(entry)
      ) {
        failed = true;
        console.error(
          `[i18n] ${locale}/${ftl} has an empty Fluent entry: ${entry.id.name}`,
        );
      }
      for (const attr of emptyFluentAttributes(entry)) {
        failed = true;
        console.error(
          `[i18n] ${locale}/${ftl} has an empty Fluent attribute: ${entry.id.name}.${attr}`,
        );
      }
      const unknownRefs = messageReferences(entry).filter(
        (ref) => !allFtlKeysByLocale.get(locale).has(ref),
      );
      if (unknownRefs.length) {
        failed = true;
        console.error(
          `[i18n] ${locale}/${ftl} references unknown Fluent messages in ${entry.id.name}: ${unknownRefs.join(", ")}`,
        );
      }
    }
  }
}

for (const ftl of FTL_FILES) {
  const byLocale = Object.fromEntries(
    LOCALES.map((locale) => [
      locale,
      readKeys(path.join(ROOT, "addon", "locale", locale, ftl)),
    ]),
  );
  const [baseLocale, compareLocale] = LOCALES;
  const base = byLocale[baseLocale];
  const compare = byLocale[compareLocale];
  const missingInCompare = base.filter((key) => !compare.includes(key));
  const missingInBase = compare.filter((key) => !base.includes(key));
  if (missingInCompare.length || missingInBase.length) {
    failed = true;
    console.error(`[i18n] ${ftl} key mismatch`);
    if (missingInCompare.length) {
      console.error(
        `  Missing in ${compareLocale}: ${missingInCompare.join(", ")}`,
      );
    }
    if (missingInBase.length) {
      console.error(`  Missing in ${baseLocale}: ${missingInBase.join(", ")}`);
    }
  }
}

for (const ftl of FTL_FILES) {
  const argsByLocale = Object.fromEntries(
    LOCALES.map((locale) => [
      locale,
      readFluentArgSets(path.join(ROOT, "addon", "locale", locale, ftl)),
    ]),
  );
  const [baseLocale, compareLocale] = LOCALES;
  const baseMessages = argsByLocale[baseLocale];
  const compareMessages = argsByLocale[compareLocale];
  for (const [key, baseArgSet] of baseMessages.entries()) {
    if (!compareMessages.has(key)) continue;
    const baseArgs = [...baseArgSet].sort();
    const compareArgs = [...compareMessages.get(key)].sort();
    if (baseArgs.join("\0") !== compareArgs.join("\0")) {
      failed = true;
      console.error(
        `[i18n] FTL argument mismatch in ${ftl}: ${key}
` +
          `  ${baseLocale}: ${baseArgs.join(", ") || "(none)"}
` +
          `  ${compareLocale}: ${compareArgs.join(", ") || "(none)"}`,
      );
    }
  }
}

for (const ftl of FTL_FILES) {
  const attributesByLocale = Object.fromEntries(
    LOCALES.map((locale) => [
      locale,
      readMessageAttributes(path.join(ROOT, "addon", "locale", locale, ftl)),
    ]),
  );
  const [baseLocale, compareLocale] = LOCALES;
  const baseAttributes = attributesByLocale[baseLocale];
  const compareAttributes = attributesByLocale[compareLocale];
  for (const [key, baseAttrSet] of baseAttributes.entries()) {
    if (!compareAttributes.has(key)) continue;
    const baseAttrs = [...baseAttrSet].sort();
    const compareAttrs = [...compareAttributes.get(key)].sort();
    if (baseAttrs.join("\0") !== compareAttrs.join("\0")) {
      failed = true;
      console.error(
        `[i18n] FTL attribute mismatch in ${ftl}: ${key}
` +
          `  ${baseLocale}: ${baseAttrs.join(", ") || "(none)"}
` +
          `  ${compareLocale}: ${compareAttrs.join(", ") || "(none)"}`,
      );
    }
  }
}

const STATIC_I18N_PAGES = [
  "addon/content/mindmap.html",
  "addon/content/mindmapViewer.html",
  "addon/content/imageSummaryViewer.html",
];

const STATIC_PAGE_FTL_PREFIXES = {
  "addon/content/mindmap.html": "static-mindmap",
  "addon/content/mindmapViewer.html": "static-mindmap-viewer",
  "addon/content/imageSummaryViewer.html": "static-image-summary-viewer",
};

function lineNumberAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function jsPlaceholderSet(value) {
  return new Set(
    [...value.matchAll(/\{([A-Za-z_][\w-]*)\}/g)].map((match) => match[1]),
  );
}

function extractObjectEntries(source, objectName) {
  const pattern = "const\\s+" + objectName + "\\s*=\\s*\\{([\\s\\S]*?)\\};";
  const match = new RegExp(pattern).exec(source);
  if (!match) return null;
  const objectBody = match[1];
  const entries = new Map();
  const duplicates = [];
  const entryPattern =
    /^\s*([A-Za-z][\w-]*)\s*:\s*(["'`])([\s\S]*?)\2\s*,?\s*$/gm;
  for (const entryMatch of objectBody.matchAll(entryPattern)) {
    const key = entryMatch[1];
    const value = entryMatch[3];
    const line = lineNumberAt(source, match.index + entryMatch.index);
    if (entries.has(key)) {
      duplicates.push({
        key,
        firstLine: entries.get(key).line,
        duplicateLine: line,
      });
    } else {
      entries.set(key, { value, line });
    }
  }
  return { entries, duplicates };
}

function sortedKeys(entries) {
  return [...entries.keys()].sort();
}

function camelToKebab(value) {
  return value.replace(/[A-Z]/g, (match) => "-" + match.toLowerCase());
}

function ftlValueAsStaticJsValue(value) {
  return value.replace(/\{\s*\$([A-Za-z_][\w-]*)\s*\}/g, "{$1}");
}

function collectStaticPageReferences(source) {
  const references = [];
  for (const match of source.matchAll(
    /window\.aiButlerL10n(?:Args)?\(\s*(["'])([^"']+)\1/g,
  )) {
    references.push({ key: match[2], line: lineNumberAt(source, match.index) });
  }
  for (const match of source.matchAll(
    /data-i18n-(?:title|text)=(["'])([^"']+)\1/g,
  )) {
    references.push({ key: match[2], line: lineNumberAt(source, match.index) });
  }
  return references;
}

function headTitleText(source) {
  return /<head>[\s\S]*?<title>([\s\S]*?)<\/title>/i.exec(source)?.[1] || "";
}

function strippedMarkupForTextAudit(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "");
}

function visibleTextNodeHits(source) {
  const stripped = strippedMarkupForTextAudit(source);
  const hits = [];
  for (const match of stripped.matchAll(/>([^<>]+)</g)) {
    const text = match[1].replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (!/[A-Za-z\u4e00-\u9fff]/.test(text)) continue;
    if (/^(?:PNG|OPML)$/.test(text.replace(/[^A-Za-z]/g, ""))) continue;
    hits.push({ text, line: lineNumberAt(stripped, match.index) });
  }
  return hits;
}

for (const rel of STATIC_I18N_PAGES) {
  const fullPath = path.join(ROOT, rel);
  if (!fs.existsSync(fullPath)) continue;
  const source = fs.readFileSync(fullPath, "utf8");
  const zhDictionary = extractObjectEntries(source, "zh");
  const enDictionary = extractObjectEntries(source, "en");
  if (!zhDictionary || !enDictionary) {
    failed = true;
    console.error(`[i18n] Static page is missing zh/en dictionaries: ${rel}`);
    continue;
  }

  for (const [locale, dictionary] of [
    ["zh", zhDictionary],
    ["en", enDictionary],
  ]) {
    for (const duplicate of dictionary.duplicates) {
      failed = true;
      console.error(
        `[i18n] Duplicate static page dictionary key in ${rel} (${locale}): ${duplicate.key} at lines ${duplicate.firstLine} and ${duplicate.duplicateLine}`,
      );
    }
  }

  const zhKeys = sortedKeys(zhDictionary.entries);
  const enKeys = sortedKeys(enDictionary.entries);
  const missingInEn = zhKeys.filter((key) => !enKeys.includes(key));
  const missingInZh = enKeys.filter((key) => !zhKeys.includes(key));
  if (missingInEn.length || missingInZh.length) {
    failed = true;
    console.error(`[i18n] Static page dictionary key mismatch: ${rel}`);
    if (missingInEn.length)
      console.error(`  Missing in en: ${missingInEn.join(", ")}`);
    if (missingInZh.length)
      console.error(`  Missing in zh: ${missingInZh.join(", ")}`);
  }

  for (const [key, enEntry] of enDictionary.entries) {
    if (/[\u4e00-\u9fff]/.test(enEntry.value)) {
      failed = true;
      console.error(
        `[i18n] Static page English dictionary contains Chinese text in ${rel}:${enEntry.line} (${key})`,
      );
    }

    const zhEntry = zhDictionary.entries.get(key);
    if (!zhEntry) continue;
    const zhPlaceholders = [...jsPlaceholderSet(zhEntry.value)].sort();
    const enPlaceholders = [...jsPlaceholderSet(enEntry.value)].sort();
    if (zhPlaceholders.join("\0") !== enPlaceholders.join("\0")) {
      failed = true;
      console.error(
        `[i18n] Static page placeholder mismatch in ${rel}: ${key}
` +
          `  zh: ${zhPlaceholders.join(", ") || "(none)"}
` +
          `  en: ${enPlaceholders.join(", ") || "(none)"}`,
      );
    }
  }

  const ftlPrefix = STATIC_PAGE_FTL_PREFIXES[rel];
  if (ftlPrefix) {
    const zhAddonMessages = readMessages(
      path.join(ROOT, "addon", "locale", "zh-CN", "addon.ftl"),
    );
    const enAddonMessages = readMessages(
      path.join(ROOT, "addon", "locale", "en-US", "addon.ftl"),
    );
    for (const key of zhKeys) {
      const ftlKey = ftlPrefix + "-" + camelToKebab(key);
      const zhFtl = zhAddonMessages.get(ftlKey);
      const enFtl = enAddonMessages.get(ftlKey);
      const zhStatic = zhDictionary.entries.get(key)?.value;
      const enStatic = enDictionary.entries.get(key)?.value;
      if (zhFtl === undefined || enFtl === undefined) {
        failed = true;
        console.error(
          `[i18n] Static page dictionary key ${rel}:${key} is missing formal FTL key ${ftlKey}.`,
        );
      } else {
        if (ftlValueAsStaticJsValue(zhFtl) !== zhStatic) {
          failed = true;
          console.error(
            `[i18n] Static page zh dictionary does not match ${ftlKey}: ${rel}:${key}`,
          );
        }
        if (ftlValueAsStaticJsValue(enFtl) !== enStatic) {
          failed = true;
          console.error(
            `[i18n] Static page en dictionary does not match ${ftlKey}: ${rel}:${key}`,
          );
        }
      }
    }
  }
  for (const { key, line } of collectStaticPageReferences(source)) {
    if (!zhDictionary.entries.has(key) || !enDictionary.entries.has(key)) {
      failed = true;
      console.error(
        `[i18n] Static page references missing dictionary key in ${rel}:${line}: ${key}`,
      );
    }
  }

  for (const { text, line } of visibleTextNodeHits(source)) {
    failed = true;
    console.error(
      `[i18n] Static page has hard-coded visible text in ${rel}:${line}: ${text}`,
    );
  }

  const initialTitle = headTitleText(source).trim();
  if (initialTitle) {
    failed = true;
    console.error(
      `[i18n] Static page must localize document title at runtime instead of hard-coding <title>${initialTitle}</title>: ${rel}`,
    );
  }
  for (const match of source.matchAll(/<img\b[^>]*\salt=(["'])([^"']+)\1/gi)) {
    if (match[2].trim()) {
      failed = true;
      console.error(
        `[i18n] Static page image alt must be set through localization instead of hard-coded text in ${rel}:${lineNumberAt(
          source,
          match.index,
        )}`,
      );
    }
  }

  for (const match of source.matchAll(/<title>\s*Mind Map\s*<\/title>/g)) {
    failed = true;
    console.error(
      `[i18n] Static page must not hard-code exported OPML title in ${rel}:${lineNumberAt(
        source,
        match.index,
      )}`,
    );
  }

  if (rel === "addon/content/mindmapViewer.html") {
    const requiredSnippets = [
      'frameTitle: "思维导图预览"',
      'frameTitle: "Mind map preview"',
      'window.aiButlerL10n("frameTitle")',
    ];
    for (const snippet of requiredSnippets) {
      if (!source.includes(snippet)) {
        failed = true;
        console.error(
          `[i18n] Mind map viewer is missing localized iframe title snippet: ${snippet}`,
        );
      }
    }
    if (source.includes('title="Mindmap"')) {
      failed = true;
      console.error(
        '[i18n] Mind map viewer must not hard-code iframe title="Mindmap".',
      );
    }
  }
}

const MIGRATED_FORBIDDEN_TEXT = [
  {
    file: "src/modules/views/TaskQueueView.ts",
    texts: [
      "📋 任务队列管理",
      "总任务",
      "搜索标题",
      "🗑️ 清除已完成",
      "暂无任务",
      "双击可定位到对应文献",
      "创建时间",
      "完成时间",
      "重试次数",
      "补全精读",
      "终止当前 AI 总结输出",
      "已复制错误详情",
    ],
  },
  {
    file: "src/modules/views/SummaryView.ts",
    texts: [
      "AI 总结输出",
      "完整追问",
      "在这里输入您的问题",
      "请输入问题内容",
      "没有可用的论文上下文",
      "删除该提问-响应对",
      "折叠/展开",
      "准备好开始追问",
      "等待 AI 总结",
      "已请求:",
      "查看任务队列",
      "正在打开任务队列",
    ],
  },
  {
    file: "src/modules/libraryScannerDialog.ts",
    texts: [
      "扫描缺",
      "已选择:",
      "确认并加入队列",
      "所有文献都已有",
      "加入队列失败",
    ],
  },
  {
    file: "src/modules/views/LibraryScannerView.ts",
    texts: [
      "扫描缺",
      "正在扫描",
      "复制错误详情",
      "扫描过程中出现错误",
      "所有文献都已有",
      "全选/全不选",
      "请先选择要分析的文献",
    ],
  },
  {
    file: "src/modules/views/DashboardView.ts",
    texts: [
      "📊 仪表盘",
      "AI 管家正在",
      "管家已为您",
      "扫描未总结论文",
      "新手教程 / 重温教程",
      "暂无最近活动",
      "已启动自动扫描",
      "处理失败",
    ],
  },
  {
    file: "src/modules/views/SettingsView.ts",
    texts: ["🧩 模型平台", "🔌 API 配置", "AI 总结提示词"],
  },
  {
    file: "src/modules/views/settings/ApiSettingsPage.ts",
    texts: [
      'd.errorName || "Unknown"',
      'd.errorMessage || error?.message || "Unknown"',
      'd.requestUrl || "Unknown"',
      'd.requestBody || "Unknown"',
      "preview.textContent = `预览：",
      "选择模型；如未获取列表，将自动获取",
      "🔄 获取中...",
      "正在从供应商获取模型列表",
      "已获取 ${models.length} 个模型",
      "获取失败：${message}",
      "显示/隐藏密钥",
      "添加更多密钥",
      "删除此密钥",
      "正在测试连接…",
      "密钥 ${keyIndex + 1} 测试失败",
    ],
  },
  {
    file: "src/modules/views/settings/DataSettingsPage.ts",
    texts: [
      "💾 数据管理",
      "包含任务队列清理",
      "🧹 清空已完成任务",
      "🗑️ 清空所有任务",
      "导出设置(JSON)",
      "导入设置(JSON)",
      "恢复所有默认设置",
      "已清空已完成任务",
      "已恢复默认设置",
    ],
  },
  {
    file: "src/modules/views/SetupWizard.ts",
    texts: [
      "下一步",
      "一键初始化配置",
      "显示密钥",
      "获取中...",
      "正在获取模型列表",
      "保存并应用配置",
      "确认并应用",
    ],
  },
  {
    file: "src/modules/views/settings/UiSettingsPage.ts",
    texts: [
      "🎨 界面设置",
      "自动滚动到最新输出",
      'createSettingsPanel(\n      "右键菜单个性化"',
      "折叠到「AI 管家」子菜单",
      "侧边栏功能与排序",
      "上移",
      "下移",
    ],
  },
  {
    file: "src/modules/views/settings/ImageSummarySettingsPage.ts",
    texts: [
      "🖼️ 一图总结设置",
      "快速开始",
      "推荐首次配置使用",
      "应用生图预设",
      "❌ 请先填写 API Key",
      "正在测试连接…",
      "官方 Endpoint：",
      "显示/隐藏密钥",
      "一图总结设置已保存",
    ],
  },
  {
    file: "src/modules/views/settings/NoteExportSettingsPage.ts",
    texts: [
      "📤 笔记自动导出",
      "尚未添加监听分类",
      "添加当前选中分类",
      "跳过已有文件",
      "● 已就绪",
      "AI 精读 DOCX",
    ],
  },
  {
    file: "src/modules/views/settings/MindmapSettingsPage.ts",
    texts: [
      "🧠 思维导图设置",
      'textContent: "🧠 思维导图设置"',
      "当前使用：默认提示词（未保存自定义）",
      "留空使用默认提示词模板...",
      'createSectionTitle("📂 导出路径设置")',
      'fp.init(win, "选择导出目录"',
      "📊 当前配置预览",
    ],
  },
  {
    file: "src/modules/views/settings/ModelPlatformSettingsPage.ts",
    texts: ["🧩 模型平台", "添加并管理一个或多个大模型供应商"],
  },
  {
    file: "src/modules/views/ui/EndpointSettingsPanel.ts",
    texts: [
      "添加大模型供应商",
      "路由策略",
      "最大 API 请求次数",
      "多模型同时总结",
      "供应商类型：",
      "API 地址 *",
      "API 密钥 *",
      "测试连接",
      "连接成功",
    ],
  },
  {
    file: "src/hooks.ts",
    texts: [
      "清空分类 AI 管家笔记",
      "将处理分类",
      "只清空 AI 管家的 AI 总结",
      "同时清空后续追问记录",
      "该操作不可逆",
      "导出该分类 AI 笔记",
      "导出目录",
      "选择或输入导出目录",
      "遇到已导出文件时",
      "开始导出",
      "AI 管家 - 与 AI 对话讨论当前论文",
      "无法获取当前文献信息",
      "该 PDF 没有关联的父条目",
      "请先在设置中配置至少一个可用的 LLM Endpoint",
      "一图总结任务已加入队列",
      "思维导图任务已加入队列",
      "表格功能已在设置中关闭",
      "已将 1 个重分析任务加入高优队列",
    ],
  },
  {
    file: "src/modules/ItemPaneSection.ts",
    texts: [
      "openDialog not available",
      "Failed to open viewer window",
      "Document body not available",
      "Unknown XML parsing error",
      "Line ${line}, Column ${col}",
      "XML Parsing Error\n${errorText}",
      "Location: ${errorLocation}",
      "Context:\n${errorContext}",
    ],
  },
  {
    file: "src/modules/llmNoteMetadata.ts",
    texts: [
      "LLM note block not found:",
      "Provider: ${metadata.providerName}",
      "Model: ${metadata.modelId",
      "Generated: ${generatedText}",
      'metadata.providerName || "Unknown provider"',
      'metadata.modelId || "(unknown)"',
    ],
  },
  {
    file: "src/modules/llmproviders/OpenRouterProvider.ts",
    texts: [
      "HTTP ${status}: Request failed",
      "Request failed",
      "OpenRouter Request Failed",
      "OpenRouter request failed",
    ],
  },
  {
    file: "src/modules/llmService.ts",
    texts: [
      "LLM endpoint not found:",
      "LLM endpoint is disabled:",
      "Unknown provider type for endpoint",
      "does not support multi-file generation",
      "Chat requests do not support multi-file input.",
      "All configured LLM endpoints failed.",
    ],
  },
  {
    file: "src/modules/llmEndpointManager.ts",
    texts: ["No enabled LLM endpoints are configured."],
  },
  {
    file: "src/modules/views/MainWindow.ts",
    texts: [
      "Cannot open AI Butler window: openDialog is not available on Zotero main window",
    ],
  },
  {
    file: "src/modules/pdfExtractor.ts",
    texts: [
      "No attachments found for this item",
      "No PDF attachment found for this item",
      "Failed to extract text from PDF or PDF is empty",
      "PDF file path not found",
      "Attachment is not a PDF",
      "Failed to get PDF file path",
      "PDF file is empty or cannot be read",
      "Failed to read or encode PDF:",
    ],
  },
  {
    file: "src/modules/mineruIntegration.ts",
    texts: [
      "MinerU API Key not configured.",
      "No PDF attachment found.",
      "PDF file path not found.",
      "MinerU Task completed but no full_zip_url returned.",
      "MinerU Task failed processing.",
      "MinerU Task timed out after",
      "Failed to get upload URL:",
      "Failed to put upload file",
      "Failed to poll MinerU task",
      "Failed to download zip file from",
      "No valid Markdown file found in the extracted zip.",
    ],
  },
  {
    file: "src/modules/imageClient.ts",
    texts: [
      "Downloaded file is not a supported image",
      "Image download succeeded, but the response could not be identified as PNG, JPEG, WebP, or GIF.",
      "Empty image URL",
      'res?.status || "Unknown"',
    ],
  },
  {
    file: "src/modules/imageNoteGenerator.ts",
    texts: ["Unsupported generated image content type:"],
  },
  {
    file: "src/modules/noteGenerator.ts",
    texts: [
      "Template changed; resuming with the template saved in the note.",
      "Template changed; saved note has no template snapshot, resuming with the current template.",
      "This slot is already done; retry skipped.",
    ],
  },
  {
    file: "src/modules/taskQueue.ts",
    texts: [
      "AI artifact already exists; skipped",
      "AI artifact already complete; marked completed",
    ],
  },
  {
    file: "src/modules/ItemPaneSection.ts",
    texts: [
      "重新渲染 AI 管家侧边栏",
      "表格归纳</span>",
      "🔄 重新生成",
      "⏳ 生成中...",
      "🖼️ 生成一图总结",
      "🧠 生成思维导图",
      "💬 快速追问",
      "输入问题...",
      "保存为笔记",
      "复制回答",
      "笔记渲染失败",
      "放大查看",
      "打开图片所在文件夹",
    ],
  },
];

for (const { file, texts } of MIGRATED_FORBIDDEN_TEXT) {
  const fullPath = path.join(ROOT, file);
  if (!fs.existsSync(fullPath)) continue;
  const source = fs.readFileSync(fullPath, "utf8");
  for (const text of texts) {
    if (source.includes(text)) {
      failed = true;
      console.error(
        "[i18n] Migrated file still hard-codes UI text: " +
          file +
          " -> " +
          text,
      );
    }
  }
}

const SCAN_ROOTS = ["src", "addon/content", "scripts"];
const ENCODING_SCAN_ROOTS = [
  ...SCAN_ROOTS,
  "addon/locale",
  "test",
  "typings",
  "doc",
];
const IGNORE_FILES = [
  /markmap-bundle\.js$/,
  /katex/i,
  /mathjax/i,
  /utils[\\/]prompts\.ts$/,
  /utils[\\/]locale\.ts$/,
  /scripts[\\/]check-i18n\.mjs$/,
  /scripts[\\/]check-i18n-build\.mjs$/,
];
const CHINESE_OR_ESCAPE = String.raw`(?:[\u4e00-\u9fff]|\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\})`;
const quotedTextWithChinese =
  String.raw`[\`'\"][^\`'\"\n]*` + CHINESE_OR_ESCAPE;
const USER_VISIBLE_PATTERNS = [
  new RegExp(String.raw`textContent\s*[:=]\s*` + quotedTextWithChinese),
  new RegExp(String.raw`innerHTML\s*[:=]\s*` + quotedTextWithChinese),
  new RegExp(String.raw`(?:\.title|title)\s*[:=]\s*` + quotedTextWithChinese),
  new RegExp(String.raw`placeholder\s*[:=]\s*` + quotedTextWithChinese),
  new RegExp(
    String.raw`setAttribute\(\s*[\"\'](?:title|placeholder|label|tooltiptext)[\"\']\s*,\s*` +
      quotedTextWithChinese,
  ),
  new RegExp(String.raw`label\s*[:=]\s*` + quotedTextWithChinese),
  new RegExp(String.raw`message\s*[:=]\s*` + quotedTextWithChinese),
  new RegExp(String.raw`detail\s*[:=]\s*` + quotedTextWithChinese),
  new RegExp(String.raw`createStyledButton\(\s*` + quotedTextWithChinese),
  new RegExp(String.raw`createFormGroup\(\s*` + quotedTextWithChinese),
  new RegExp(String.raw`createSectionTitle\(\s*` + quotedTextWithChinese),
  new RegExp(
    String.raw`createLine\(\s*\{[^}]*text\s*:\s*` + quotedTextWithChinese,
  ),
  new RegExp(String.raw`showLoadingState\(\s*` + quotedTextWithChinese),
  new RegExp(String.raw`notifyProgress\([^\n]*,\s*` + quotedTextWithChinese),
  new RegExp(String.raw`(?:throw\s+)?new Error\(\s*` + quotedTextWithChinese),
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs|xhtml|html|ftl|d\.ts|md)$/.test(entry.name))
      out.push(full);
  }
  return out;
}

const MOJIBAKE_PATTERNS = [
  /\u9983|\u9241/,
  /鎬|瀵|鏈|鍙|缂|鏀|閫|鎵|姝|鈴\?|涓篜|涓篛|鎻掍|鏈|涓昏|鐢ㄦ|鍔犺|鍥介|璧勬/,
  /锟斤拷|Ã.|Â.|â€¦|â€™|â€œ|â€|ðŸ/,
];
const encodingHits = [];
const hits = [];
for (const root of ENCODING_SCAN_ROOTS) {
  for (const file of walk(path.join(ROOT, root))) {
    const rel = path.relative(ROOT, file);
    if (IGNORE_FILES.some((pattern) => pattern.test(rel))) continue;
    const sourceText = fs.readFileSync(file, "utf8");
    sourceText.split(/\r?\n/).forEach((line, index) => {
      if (
        line.includes("\uFFFD") ||
        MOJIBAKE_PATTERNS.some((pattern) => pattern.test(line))
      ) {
        encodingHits.push(`${rel}:${index + 1}: ${line.trim().slice(0, 160)}`);
      }
    });
  }
}

for (const root of SCAN_ROOTS) {
  for (const file of walk(path.join(ROOT, root))) {
    const rel = path.relative(ROOT, file);
    if (IGNORE_FILES.some((pattern) => pattern.test(rel))) continue;
    const sourceText = fs.readFileSync(file, "utf8");
    if (/function\s+t\s*\(\s*key\s*:\s*string\b/.test(sourceText)) {
      failed = true;
      console.error(
        `[i18n] Local translation helper in ${rel} must type key as FluentMessageId, not plain string.`,
      );
    }
    sourceText.split(/\r?\n/).forEach((line, index) => {
      if (USER_VISIBLE_PATTERNS.some((pattern) => pattern.test(line))) {
        hits.push(`${rel}:${index + 1}: ${line.trim().slice(0, 160)}`);
      }
    });
  }
}

const AST_UI_CALLS = new Set([
  "createFormGroup",
  "createStyledButton",
  "createButton",
  "createInput",
  "createLine",
  "setNote",
  "appendContent",
  "startItem",
  "createSelect",
  "createNotice",
  "notify",
  "pickFolder",
  "prompt",
  "confirm",
  "alert",
  "showLoadingState",
  "showDeepReadNotice",
  "notifyDeepReadSlotProgress",
  "notifyProgress",
  "progressCallback",
]);

function calleeName(expression) {
  if (!expression) return "";
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return "";
}

function nearestUiCall(node) {
  let current = node.parent;
  while (current) {
    if (ts.isCallExpression(current)) {
      const name = calleeName(current.expression);
      const calleeTextValue = current.expression.getText();
      if (AST_UI_CALLS.has(name) || /\.warnings\.push$/.test(calleeTextValue))
        return current;
    }
    if (ts.isNewExpression(current)) {
      const exprText = current.expression.getText();
      if (/\b(?:ProgressWindow|ImageGenerationError)$/.test(exprText))
        return current;
    }
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isArrowFunction(current)
    ) {
      return null;
    }
    current = current.parent;
  }
  return null;
}

function collectAstUiChineseStrings(file, rel) {
  if (!/\.tsx?$/.test(file)) return;
  const source = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const seen = new Set();
  function visit(node) {
    const text =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
        ? node.text
        : ts.isTemplateExpression(node)
          ? node.getText(sourceFile)
          : null;
    if (text && /[\u4e00-\u9fff]/.test(text) && nearestUiCall(node)) {
      const line =
        sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const snippet = node
        .getText(sourceFile)
        .replace(/\s+/g, " ")
        .slice(0, 160);
      const hit = `${rel}:${line}: ${snippet}`;
      if (!seen.has(hit)) {
        seen.add(hit);
        hits.push(hit);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

for (const root of SCAN_ROOTS) {
  for (const file of walk(path.join(ROOT, root))) {
    const rel = path.relative(ROOT, file);
    if (IGNORE_FILES.some((pattern) => pattern.test(rel))) continue;
    collectAstUiChineseStrings(file, rel);
  }
}

for (const file of walk(path.join(ROOT, "src"))) {
  const rel = path.relative(ROOT, file);
  if (rel === path.join("src", "utils", "locale.ts")) continue;
  const source = fs.readFileSync(file, "utf8");
  if (source.includes("installLegacyUiTextTranslation")) {
    failed = true;
    console.error(
      `[i18n] legacy bridge must not be installed from ${rel}; migrate UI text to FTL keys instead.`,
    );
  }
}

const allFtlKeys = readAllFtlKeys("en-US");

const allFtlAttributes = new Map();
for (const ftl of FTL_FILES) {
  const attrs = readMessageAttributes(
    path.join(ROOT, "addon", "locale", "en-US", ftl),
  );
  for (const [key, attrSet] of attrs.entries()) {
    if (!allFtlAttributes.has(key)) allFtlAttributes.set(key, new Set());
    for (const attr of attrSet) allFtlAttributes.get(key).add(attr);
  }
}

const allFtlArgs = new Map();
for (const ftl of FTL_FILES) {
  const messages = readMessages(
    path.join(ROOT, "addon", "locale", "en-US", ftl),
  );
  for (const [key, message] of messages.entries()) {
    allFtlArgs.set(key, fluentArgSet(message));
  }
}

const typingsPath = path.join(ROOT, "typings", "i10n.d.ts");
if (fs.existsSync(typingsPath)) {
  const typingsSource = fs.readFileSync(typingsPath, "utf8");
  const typingKeys = new Set(
    [...typingsSource.matchAll(/\|\s*['"]([^'"]+)['"]/g)].map(
      (match) => match[1],
    ),
  );
  const missingInTypings = [...allFtlKeys].filter(
    (key) => !typingKeys.has(key),
  );
  const extraInTypings = [...typingKeys].filter((key) => !allFtlKeys.has(key));
  if (missingInTypings.length || extraInTypings.length) {
    failed = true;
    console.error(
      "[i18n] typings/i10n.d.ts is out of sync with en-US FTL keys",
    );
    if (missingInTypings.length) {
      console.error(
        `  Missing in typings: ${missingInTypings.sort().join(", ")}`,
      );
    }
    if (extraInTypings.length) {
      console.error(`  Extra in typings: ${extraInTypings.sort().join(", ")}`);
    }
  }
}

function reportMissingKey(rel, line, key, context) {
  failed = true;
  console.error(
    `[i18n] Missing FTL key referenced from ${rel}:${line}: ${key} (${context})`,
  );
}

function validatePotentialFtlKey(rel, line, key, context) {
  if (!/^[a-z][a-z0-9-]*$/.test(key) || !key.includes("-")) return;
  if (!allFtlKeys.has(key)) reportMissingKey(rel, line, key, context);
}

const UI_FACTORY_TEXT_ARGUMENT_FUNCTIONS = new Set([
  "createFormGroup",
  "createStyledButton",
  "createSectionTitle",
  "createNotice",
]);
const UI_LITERAL_ATTRIBUTES = new Set([
  "title",
  "placeholder",
  "label",
  "tooltiptext",
  "aria-label",
  "alt",
]);
const UI_LITERAL_PROPERTIES = new Set([
  "textContent",
  "title",
  "placeholder",
  "label",
  "tooltiptext",
  "innerText",
  "innerHTML",
  "outerHTML",
  "alt",
]);
const UI_LITERAL_OBJECT_PROPERTIES = new Set([
  "label",
  "title",
  "description",
  "message",
  "detail",
  "placeholder",
  "tooltip",
  "tooltiptext",
  "text",
  "aria-label",
  "alt",
]);
const INTERNAL_ERROR_LITERALS = new Set([
  "NetworkError: XHR onerror",
  "clipboard api unavailable",
  "document host unavailable",
  "no document",
  "Host element has no ownerDocument",
]);

function isMeaningfulUiLiteral(text) {
  const trimmed = text.trim();
  if (!/[A-Za-z\u4e00-\u9fff]/.test(trimmed)) return false;
  if (!trimmed) return false;
  if (/^https?:/i.test(trimmed)) return false;
  if (/^[a-z0-9._/-]+$/i.test(trimmed)) return false;
  if (
    /@keyframes|\b(?:font-family|background|border-radius|transform):/i.test(
      trimmed,
    )
  )
    return false;
  if (/^<[^>]+>$/.test(trimmed)) return false;
  return true;
}

function shouldCheckObjectUiLiteral(rel) {
  return /^(?:src|src[\/])/.test(rel);
}

function reportHardcodedUiLiteral(rel, line, text, context) {
  if (!isMeaningfulUiLiteral(text)) return;
  failed = true;
  console.error(
    `[i18n] Hard-coded UI literal in ${rel}:${line}: ${JSON.stringify(
      text,
    )} (${context}). Use an FTL key instead.`,
  );
}

function collectReferencedLocaleKeys(file, rel) {
  if (!/\.tsx?$/.test(file)) return;
  const source = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const hasLocalTranslationHelper =
    /function\s+t\s*\(\s*key\s*:\s*(?:FluentMessageId|string)\b/.test(source);
  const localeFunctions = new Set([
    "getString",
    "getLocaleID",
    "localizeText",
    "localizeTitle",
    "localizePlaceholder",
    "localizeLabel",
    "localizeTooltip",
    "localizeAttribute",
  ]);

  function lineOf(node) {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  }

  function isInsideRuntimeScope(node) {
    let current = node.parent;
    while (current) {
      if (
        ts.isFunctionDeclaration(current) ||
        ts.isMethodDeclaration(current) ||
        ts.isArrowFunction(current) ||
        ts.isFunctionExpression(current) ||
        ts.isConstructorDeclaration(current) ||
        ts.isGetAccessor(current) ||
        ts.isSetAccessor(current)
      ) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  function propertyName(node) {
    return ts.isIdentifier(node.name)
      ? node.name.text
      : ts.isStringLiteral(node.name)
        ? node.name.text
        : "";
  }

  function objectProperty(objectNode, name) {
    if (!objectNode || !ts.isObjectLiteralExpression(objectNode)) return null;
    return (
      objectNode.properties.find(
        (property) =>
          ts.isPropertyAssignment(property) && propertyName(property) === name,
      ) || null
    );
  }

  function objectLiteralKeys(objectNode) {
    if (!objectNode || !ts.isObjectLiteralExpression(objectNode)) return null;
    const keys = [];
    for (const property of objectNode.properties) {
      if (ts.isPropertyAssignment(property)) {
        const name = propertyName(property);
        if (name) keys.push(name);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        keys.push(property.name.text);
      } else if (ts.isSpreadAssignment(property)) {
        return null;
      }
    }
    return new Set(keys);
  }

  function localeOptionsArg(name, node) {
    if (name === "getString" || name === "t") return node.arguments[1];
    if (name === "localizeAttribute") return node.arguments[3];
    if (
      name === "localizeText" ||
      name === "localizeTitle" ||
      name === "localizePlaceholder" ||
      name === "localizeLabel" ||
      name === "localizeTooltip"
    ) {
      return node.arguments[2];
    }
    return undefined;
  }

  function validateExplicitLocaleKey(name, node, keyArg, key) {
    if (!allFtlKeys.has(key)) {
      reportMissingKey(rel, lineOf(keyArg), key, name);
    }
    validateLocaleCallArgs(name, node, keyArg, key);
  }

  function validateConditionalLocaleKeys(name, node, keyArg) {
    if (ts.isParenthesizedExpression(keyArg)) {
      validateConditionalLocaleKeys(name, node, keyArg.expression);
      return;
    }
    if (ts.isStringLiteralLike(keyArg)) {
      validateExplicitLocaleKey(name, node, keyArg, keyArg.text);
      return;
    }
    if (ts.isConditionalExpression(keyArg)) {
      validateConditionalLocaleKeys(name, node, keyArg.whenTrue);
      validateConditionalLocaleKeys(name, node, keyArg.whenFalse);
    }
  }

  function validateLocaleCallArgs(name, node, keyArg, key) {
    const requiredArgs = allFtlArgs.get(key);
    if (!requiredArgs || requiredArgs.size === 0) return;
    const optionsArg = localeOptionsArg(name, node);
    if (!optionsArg || ts.isStringLiteralLike(optionsArg)) {
      failed = true;
      console.error(
        `[i18n] FTL key ${key} referenced from ${rel}:${lineOf(
          keyArg,
        )} requires args (${[...requiredArgs].sort().join(", ")}) but no args object was provided.`,
      );
      return;
    }
    if (!ts.isObjectLiteralExpression(optionsArg)) return;
    const argsObject =
      name === "t"
        ? optionsArg
        : objectProperty(optionsArg, "args")?.initializer;
    if (!argsObject) {
      failed = true;
      console.error(
        `[i18n] FTL key ${key} referenced from ${rel}:${lineOf(
          keyArg,
        )} requires args (${[...requiredArgs].sort().join(", ")}) but options.args is missing.`,
      );
      return;
    }
    const providedArgs = objectLiteralKeys(argsObject);
    if (!providedArgs) return;
    const missingArgs = [...requiredArgs].filter(
      (arg) => !providedArgs.has(arg),
    );
    if (missingArgs.length) {
      failed = true;
      console.error(
        `[i18n] FTL key ${key} referenced from ${rel}:${lineOf(
          keyArg,
        )} is missing args: ${missingArgs.sort().join(", ")}.`,
      );
    }
  }

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const name = ts.isIdentifier(expression)
        ? expression.text
        : ts.isPropertyAccessExpression(expression)
          ? expression.name.text
          : "";
      const isLocalTranslationHelper =
        name === "t" && hasLocalTranslationHelper;
      if (
        (name === "getString" || isLocalTranslationHelper) &&
        !isInsideRuntimeScope(node)
      ) {
        failed = true;
        console.error(
          `[i18n] ${name} must not run at module load time in ${rel}:${lineOf(
            node,
          )}; use a getter/function so the current Zotero locale is initialized first.`,
        );
      }
      if (
        UI_FACTORY_TEXT_ARGUMENT_FUNCTIONS.has(name) ||
        name === "createTextNode"
      ) {
        const firstArg = node.arguments[0];
        if (firstArg && ts.isStringLiteralLike(firstArg)) {
          reportHardcodedUiLiteral(rel, lineOf(firstArg), firstArg.text, name);
        }
      }

      if (name === "setAttribute") {
        const attrArg = node.arguments[0];
        const valueArg = node.arguments[1];
        if (
          attrArg &&
          valueArg &&
          ts.isStringLiteralLike(attrArg) &&
          UI_LITERAL_ATTRIBUTES.has(attrArg.text) &&
          ts.isStringLiteralLike(valueArg)
        ) {
          reportHardcodedUiLiteral(
            rel,
            lineOf(valueArg),
            valueArg.text,
            `setAttribute(${attrArg.text})`,
          );
        }
      }

      if (localeFunctions.has(name) || isLocalTranslationHelper) {
        const keyArg =
          name === "getString" || name === "getLocaleID" || name === "t"
            ? node.arguments[0]
            : name === "localizeAttribute"
              ? node.arguments[2]
              : node.arguments[1];
        if (keyArg && ts.isTemplateExpression(keyArg)) {
          failed = true;
          console.error(
            `[i18n] Dynamic FTL key in ${rel}:${lineOf(
              keyArg,
            )} cannot be statically verified. Use an explicit key map instead.`,
          );
        }
        if (keyArg) validateConditionalLocaleKeys(name, node, keyArg);
        if (keyArg && ts.isStringLiteralLike(keyArg)) {
          const key = keyArg.text;

          const branchArg = node.arguments[1];
          if (
            name === "getString" &&
            branchArg &&
            ts.isStringLiteralLike(branchArg)
          ) {
            const attr = branchArg.text;
            if (!allFtlAttributes.get(key)?.has(attr)) {
              failed = true;
              console.error(
                `[i18n] Missing FTL attribute referenced from ${rel}:${lineOf(
                  branchArg,
                )}: ${key}.${attr}`,
              );
            }
          }
        }
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const value = node.right;
      let propertyName = "";
      if (ts.isPropertyAccessExpression(node.left)) {
        propertyName = node.left.name.text;
      } else if (
        ts.isElementAccessExpression(node.left) &&
        ts.isStringLiteralLike(node.left.argumentExpression)
      ) {
        propertyName = node.left.argumentExpression.text;
      }
      if (
        UI_LITERAL_PROPERTIES.has(propertyName) &&
        ts.isStringLiteralLike(value)
      ) {
        reportHardcodedUiLiteral(rel, lineOf(value), value.text, propertyName);
      }
    }

    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      const firstArg = node.arguments?.[0];
      if (
        node.expression.text === "Error" &&
        firstArg &&
        ts.isStringLiteralLike(firstArg) &&
        !INTERNAL_ERROR_LITERALS.has(firstArg.text) &&
        !/^Cannot mount onboarding overlay:/.test(firstArg.text)
      ) {
        reportHardcodedUiLiteral(rel, lineOf(firstArg), firstArg.text, "Error");
      }
    }

    if (ts.isPropertyAssignment(node)) {
      const propertyName = ts.isIdentifier(node.name)
        ? node.name.text
        : ts.isStringLiteral(node.name)
          ? node.name.text
          : "";
      if (
        /^(?:nameKey|labelKey|titleKey|descriptionKey|placeholderKey|tooltipKey)$/.test(
          propertyName,
        )
      ) {
        const value = node.initializer;
        if (ts.isStringLiteralLike(value)) {
          validatePotentialFtlKey(rel, lineOf(value), value.text, propertyName);
        }
      }
      if (
        shouldCheckObjectUiLiteral(rel) &&
        UI_LITERAL_OBJECT_PROPERTIES.has(propertyName)
      ) {
        const value = node.initializer;
        if (ts.isStringLiteralLike(value)) {
          reportHardcodedUiLiteral(
            rel,
            lineOf(value),
            value.text,
            `object.${propertyName}`,
          );
        }
      }
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const variableName = node.name.text;
      if (
        /(?:TITLE|LABEL|NAME|DESCRIPTION|PLACEHOLDER|TOOLTIP)_KEYS?/.test(
          variableName,
        ) &&
        node.initializer
      ) {
        const visitInitializer = (child) => {
          if (ts.isStringLiteralLike(child)) {
            validatePotentialFtlKey(
              rel,
              lineOf(child),
              child.text,
              variableName,
            );
          }
          ts.forEachChild(child, visitInitializer);
        };
        visitInitializer(node.initializer);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

function collectDataL10nIds(file, rel) {
  if (!/\.(?:xhtml|html)$/.test(file)) return;
  const source = fs.readFileSync(file, "utf8");
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/data-l10n-id=["']([^"']+)["']/g)) {
      const key = match[1];
      if (!allFtlKeys.has(key)) {
        reportMissingKey(rel, index + 1, key, "data-l10n-id");
      }
    }
  });
}

for (const root of SCAN_ROOTS) {
  for (const file of walk(path.join(ROOT, root))) {
    const rel = path.relative(ROOT, file);
    if (IGNORE_FILES.some((pattern) => pattern.test(rel))) continue;
    collectReferencedLocaleKeys(file, rel);
    collectDataL10nIds(file, rel);
  }
}

if (encodingHits.length) {
  failed = true;
  console.error(
    `[i18n] Found ${encodingHits.length} lines containing U+FFFD or common mojibake patterns, usually caused by broken UTF-8 decoding.`,
  );
  for (const hit of encodingHits.slice(0, 80)) console.error(`  ${hit}`);
  if (encodingHits.length > 80) {
    console.error(`  ... ${encodingHits.length - 80} more`);
  }
}

if (hits.length) {
  failed = true;
  console.error(
    `[i18n] Found ${hits.length} possible hard-coded Chinese UI strings.`,
  );
  console.error(
    "[i18n] Migrate user-visible UI text to FTL keys instead of relying on the removed legacy bridge.",
  );
  for (const hit of hits.slice(0, 80)) console.error(`  ${hit}`);
  if (hits.length > 80) console.error(`  ... ${hits.length - 80} more`);
}

if (failed) process.exit(1);
console.log("[i18n] FTL locale key sets are consistent.");
