import { escapeHtml } from "./noteMarkdown";
import JSZip from "jszip";

export async function noteHtmlToDocxBytes(options: {
  html: string;
  title: string;
  kindLabel: string;
}): Promise<Uint8Array> {
  try {
    const htmlToDocx = await loadHtmlToDocx();
    const documentHtml = buildDocumentHtml(options);
    const result = await htmlToDocx(documentHtml, null, {
      title: `${options.kindLabel} - ${options.title}`,
      creator: "AI-Butler",
      font: "Microsoft YaHei",
      fontSize: 22,
      table: {
        row: { cantSplit: true },
        borderOptions: { size: 1, color: "d9d9d9" },
      },
      preprocessing: { skipHTMLMinify: true },
      imageProcessing: { suppressSharpWarning: true, svgHandling: "native" },
    });
    return await resultToBytes(result);
  } catch (error) {
    ztoolkit.log(
      "[AI-Butler][NoteExport] HTML 转 DOCX 依赖失败，使用内置 DOCX 生成器:",
      error,
    );
    return buildSimpleDocx(options);
  }
}

function buildDocumentHtml(options: {
  html: string;
  title: string;
  kindLabel: string;
}): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif; line-height: 1.55; color: #202124; }
    h1, h2, h3, h4, h5, h6 { color: #1f2937; margin-top: 18px; margin-bottom: 8px; }
    h1 { font-size: 22pt; border-bottom: 1px solid #d9d9d9; padding-bottom: 6px; }
    h2 { font-size: 17pt; }
    h3 { font-size: 14pt; }
    p { margin: 6px 0; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    th, td { border: 1px solid #d9d9d9; padding: 6px 8px; vertical-align: top; }
    pre { background: #f6f8fa; padding: 8px; white-space: pre-wrap; }
    code { font-family: Consolas, Menlo, monospace; }
    blockquote { border-left: 4px solid #cbd5e1; margin-left: 0; padding-left: 12px; color: #475569; }
    .math { font-family: Cambria Math, Times New Roman, serif; }
  </style>
</head>
<body>
  <h1>${escapeHtml(options.kindLabel)} - ${escapeHtml(options.title)}</h1>
  ${sanitizeNoteHtmlForDocx(options.html)}
</body>
</html>`;
}

export function sanitizeNoteHtmlForDocx(html: string): string {
  const doc = new DOMParser().parseFromString(
    `<div id="ai-butler-export-root">${html || ""}</div>`,
    "text/html",
  );
  const root = doc.getElementById("ai-butler-export-root");
  if (!root) return "";

  for (const element of Array.from(
    root.querySelectorAll("script, style"),
  ) as Element[]) {
    element.remove();
  }

  for (const element of Array.from(
    root.querySelectorAll("span.math"),
  ) as Element[]) {
    const text = element.textContent || "";
    element.textContent = text.replace(/^\$\\displaystyle\s*/, "$");
  }

  for (const element of Array.from(
    root.querySelectorAll("[style]"),
  ) as Element[]) {
    element.removeAttribute("style");
  }

  return String(root.innerHTML);
}

async function loadHtmlToDocx(): Promise<(...args: any[]) => Promise<unknown>> {
  const mod = (await import("@turbodocx/html-to-docx")) as any;
  const fn = mod.default || mod;
  if (typeof fn !== "function") {
    throw new Error("DOCX 转换依赖加载失败");
  }
  return fn;
}

async function resultToBytes(result: unknown): Promise<Uint8Array> {
  if (result instanceof Uint8Array) return result;
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (typeof Blob !== "undefined" && result instanceof Blob) {
    return new Uint8Array(await result.arrayBuffer());
  }
  const maybeBuffer = result as {
    buffer?: ArrayBuffer;
    byteOffset?: number;
    byteLength?: number;
  };
  if (maybeBuffer?.buffer instanceof ArrayBuffer) {
    return new Uint8Array(
      maybeBuffer.buffer,
      maybeBuffer.byteOffset || 0,
      maybeBuffer.byteLength,
    );
  }
  throw new Error("DOCX 转换结果格式不受支持");
}

async function buildSimpleDocx(options: {
  html: string;
  title: string;
  kindLabel: string;
}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES_XML);
  zip.folder("_rels")?.file(".rels", ROOT_RELS_XML);
  const word = zip.folder("word");
  word?.file("document.xml", buildDocumentXml(options));
  word?.file("styles.xml", STYLES_XML);
  word?.folder("_rels")?.file("document.xml.rels", DOCUMENT_RELS_XML);
  return await zip.generateAsync({ type: "uint8array" });
}

function buildDocumentXml(options: {
  html: string;
  title: string;
  kindLabel: string;
}): string {
  const paragraphs = [
    buildParagraph(`${options.kindLabel} - ${options.title}`, {
      bold: true,
      size: 32,
    }),
    ...htmlToWordParagraphs(options.html),
  ];

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${paragraphs.join("\n")}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>`;
}

function htmlToWordParagraphs(html: string): string[] {
  const doc = new DOMParser().parseFromString(
    `<div id="ai-butler-export-root">${sanitizeNoteHtmlForDocx(html)}</div>`,
    "text/html",
  );
  const root = doc.getElementById("ai-butler-export-root");
  if (!root) return [];
  const paragraphs: string[] = [];
  for (const child of Array.from(root.childNodes) as Node[]) {
    appendNodeParagraphs(child, paragraphs);
  }
  return paragraphs.length
    ? paragraphs
    : [buildParagraph(root.textContent || "")];
}

function appendNodeParagraphs(node: Node, paragraphs: string[]): void {
  if (node.nodeType === 3) {
    const text = (node.textContent || "").trim();
    if (text) paragraphs.push(buildParagraph(text));
    return;
  }
  if (!isElement(node)) return;

  const tag = node.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));
    paragraphs.push(
      buildParagraph(node.textContent || "", {
        bold: true,
        size: Math.max(22, 34 - level * 2),
      }),
    );
    return;
  }
  if (tag === "li") {
    paragraphs.push(buildParagraph(`• ${(node.textContent || "").trim()}`));
    return;
  }
  if (tag === "pre") {
    const text = node.textContent || "";
    for (const line of text.split(/\r?\n/)) {
      paragraphs.push(buildParagraph(line, { monospace: true }));
    }
    return;
  }
  if (tag === "table") {
    for (const row of Array.from(node.querySelectorAll("tr")) as Element[]) {
      const cells = (
        Array.from(row.querySelectorAll("th,td")) as Element[]
      ).map((cell) => (cell.textContent || "").trim());
      if (cells.length) paragraphs.push(buildParagraph(cells.join(" | ")));
    }
    return;
  }
  if (["p", "blockquote"].includes(tag)) {
    const text = (node.textContent || "").trim();
    if (text) paragraphs.push(buildParagraph(text));
    return;
  }

  for (const child of Array.from(node.childNodes) as Node[]) {
    appendNodeParagraphs(child, paragraphs);
  }
}

function isElement(node: Node | null): node is Element {
  return !!node && node.nodeType === 1;
}

function buildParagraph(
  text: string,
  options: { bold?: boolean; size?: number; monospace?: boolean } = {},
): string {
  const runProps = [
    options.bold ? "<w:b/>" : "",
    options.size ? `<w:sz w:val="${options.size}"/>` : "",
    options.monospace
      ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>'
      : "",
  ].join("");
  const props = runProps ? `<w:rPr>${runProps}</w:rPr>` : "";
  return `<w:p><w:r>${props}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/><w:sz w:val="22"/></w:rPr></w:style></w:styles>`;
