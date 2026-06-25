import {
  BorderStyle,
  Document as DocxDocument,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  WidthType,
} from "docx";
import JSZip from "jszip";
import { withZoteroBrowserGlobals } from "./noteExportBrowserGlobals";

type DocxBlock = Paragraph | Table;

type RunStyle = {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  code?: boolean;
};

export async function noteHtmlToDocxBytes(options: {
  html: string;
  title: string;
  kindLabel: string;
}): Promise<Uint8Array> {
  try {
    return await withZoteroBrowserGlobals(async () => {
      const doc = new DocxDocument({
        title: `${options.kindLabel} - ${options.title}`,
        creator: "AI-Butler",
        styles: {
          default: {
            document: {
              run: { font: "Microsoft YaHei", size: 22 },
              paragraph: { spacing: { after: 120, line: 360 } },
            },
          },
        },
        sections: [
          {
            properties: {
              page: {
                margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
              },
            },
            children: buildDocxBlocks(options),
          },
        ],
      });
      return new Uint8Array(await Packer.toArrayBuffer(doc));
    });
  } catch (error) {
    ztoolkit.log(
      "[AI-Butler][NoteExport] docx 依赖生成失败，使用内置 DOCX 生成器:",
      error,
    );
    return buildSimpleDocx(options);
  }
}

function buildDocxBlocks(options: {
  html: string;
  title: string;
  kindLabel: string;
}): DocxBlock[] {
  const doc = new DOMParser().parseFromString(
    `<div id="ai-butler-export-root">${sanitizeNoteHtmlForDocx(options.html)}</div>`,
    "text/html",
  );
  const root = doc.getElementById("ai-butler-export-root");
  const blocks: DocxBlock[] = [];

  if (root) {
    for (const child of Array.from(root.childNodes) as Node[]) {
      appendDocxBlocks(child, blocks);
    }
  }

  const remainingText = normalizeText(root?.textContent || "");
  if (!blocks.length && remainingText) {
    blocks.push(new Paragraph({ text: remainingText }));
  }
  return blocks;
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

  normalizeTablesForDocx(doc, root);

  for (const element of Array.from(
    root.querySelectorAll("[style]"),
  ) as Element[]) {
    element.removeAttribute("style");
  }

  return String(root.innerHTML);
}

function normalizeTablesForDocx(doc: Document, root: Element): void {
  for (const table of Array.from(
    root.querySelectorAll("table"),
  ) as HTMLTableElement[]) {
    const normalizedTable = doc.createElement("table");
    for (const row of Array.from(
      table.querySelectorAll("tr"),
    ) as HTMLTableRowElement[]) {
      const normalizedRow = doc.createElement("tr");
      const cells = Array.from(
        row.querySelectorAll("th,td"),
      ) as HTMLTableCellElement[];
      for (const cell of cells) {
        const normalizedCell = doc.createElement(cell.tagName.toLowerCase());
        normalizedCell.setAttribute(
          "colspan",
          String(Math.max(1, cell.colSpan || 1)),
        );
        normalizedCell.setAttribute(
          "rowspan",
          String(Math.max(1, cell.rowSpan || 1)),
        );
        normalizedCell.textContent =
          normalizeText(cell.textContent || "") || " ";
        normalizedRow.appendChild(normalizedCell);
      }
      if (!cells.length) {
        const emptyCell = doc.createElement("td");
        emptyCell.setAttribute("colspan", "1");
        emptyCell.setAttribute("rowspan", "1");
        emptyCell.textContent = " ";
        normalizedRow.appendChild(emptyCell);
      }
      normalizedTable.appendChild(normalizedRow);
    }
    if (!normalizedTable.querySelector("tr")) {
      const row = doc.createElement("tr");
      const cell = doc.createElement("td");
      cell.setAttribute("colspan", "1");
      cell.setAttribute("rowspan", "1");
      cell.textContent = normalizeText(table.textContent || "") || " ";
      row.appendChild(cell);
      normalizedTable.appendChild(row);
    }
    table.replaceWith(normalizedTable);
  }
}

function appendDocxBlocks(node: Node, blocks: DocxBlock[]): void {
  if (node.nodeType === 3) {
    const text = normalizeText(node.textContent || "");
    if (text) blocks.push(new Paragraph({ children: [textRun(text)] }));
    return;
  }
  if (!isElement(node)) return;

  const tag = node.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) {
    blocks.push(buildHeading(node, Number(tag.slice(1))));
    return;
  }
  if (["p", "div", "section", "article"].includes(tag)) {
    appendParagraphLike(node, blocks);
    return;
  }
  if (["ul", "ol"].includes(tag)) {
    appendList(node, blocks, tag === "ol");
    return;
  }
  if (tag === "pre") {
    appendPreformatted(node, blocks);
    return;
  }
  if (tag === "blockquote") {
    appendBlockquote(node, blocks);
    return;
  }
  if (tag === "table") {
    blocks.push(buildTable(node));
    return;
  }
  if (tag === "br") {
    blocks.push(new Paragraph({ text: "" }));
    return;
  }

  for (const child of Array.from(node.childNodes) as Node[]) {
    appendDocxBlocks(child, blocks);
  }
}

function appendParagraphLike(element: Element, blocks: DocxBlock[]): void {
  const blockTags = new Set([
    "div",
    "p",
    "section",
    "article",
    "ul",
    "ol",
    "pre",
    "blockquote",
    "table",
  ]);
  const hasBlockChild = Array.from(element.children).some((child) =>
    blockTags.has(child.tagName.toLowerCase()),
  );
  if (hasBlockChild) {
    for (const child of Array.from(element.childNodes) as Node[]) {
      appendDocxBlocks(child, blocks);
    }
    return;
  }
  for (const children of inlineRunGroups(element)) {
    if (children.length) blocks.push(new Paragraph({ children }));
  }
}

function appendList(
  element: Element,
  blocks: DocxBlock[],
  ordered: boolean,
): void {
  const items = Array.from(element.children).filter(
    (child) => child.tagName.toLowerCase() === "li",
  );
  items.forEach((item, index) => {
    const prefix = ordered ? `${index + 1}. ` : "• ";
    blocks.push(
      new Paragraph({
        indent: { left: 360, hanging: 240 },
        children: [textRun(prefix), ...inlineRuns(item)],
      }),
    );
  });
}

function appendPreformatted(element: Element, blocks: DocxBlock[]): void {
  const text = element.textContent || "";
  for (const line of text.split(/\r?\n/)) {
    blocks.push(
      new Paragraph({
        spacing: { before: 60, after: 60 },
        children: [textRun(line || " ", { code: true })],
      }),
    );
  }
}

function appendBlockquote(element: Element, blocks: DocxBlock[]): void {
  for (const children of inlineRunGroups(element)) {
    if (!children.length) continue;
    blocks.push(
      new Paragraph({
        indent: { left: 360 },
        border: {
          left: { style: BorderStyle.SINGLE, size: 12, color: "CBD5E1" },
        },
        children,
      }),
    );
  }
}

function buildHeading(element: Element, level: number): Paragraph {
  const headingMap = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ] as const;
  return new Paragraph({
    heading: headingMap[Math.max(0, Math.min(5, level - 1))],
    spacing: { before: 240, after: 120 },
    children: inlineRuns(element, { bold: level <= 3 }),
  });
}

function buildTable(element: Element): Table {
  const rows = Array.from(
    element.querySelectorAll("tr"),
  ) as HTMLTableRowElement[];
  const tableRows = rows.length
    ? rows.map(buildTableRow)
    : [
        new TableRow({
          children: [buildTableCell(element.textContent || " ")],
        }),
      ];
  return new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: tableBorder(),
      bottom: tableBorder(),
      left: tableBorder(),
      right: tableBorder(),
      insideHorizontal: tableBorder(),
      insideVertical: tableBorder(),
    },
  });
}

function buildTableRow(row: HTMLTableRowElement): TableRow {
  const cells = Array.from(
    row.querySelectorAll("th,td"),
  ) as HTMLTableCellElement[];
  return new TableRow({
    children: cells.length
      ? cells.map((cell) => buildTableCell(cell.textContent || " ", cell))
      : [buildTableCell(" ")],
  });
}

function buildTableCell(text: string, cell?: HTMLTableCellElement): TableCell {
  return new TableCell({
    columnSpan: Math.max(1, cell?.colSpan || 1),
    rowSpan: Math.max(1, cell?.rowSpan || 1),
    margins: { top: 120, bottom: 120, left: 120, right: 120 },
    children: [
      new Paragraph({ children: [textRun(normalizeText(text) || " ")] }),
    ],
  });
}

function tableBorder(): {
  style: typeof BorderStyle.SINGLE;
  size: number;
  color: string;
} {
  return { style: BorderStyle.SINGLE, size: 1, color: "D9D9D9" };
}

function inlineRuns(element: Element, inherited: RunStyle = {}): TextRun[] {
  const runs: TextRun[] = [];
  for (const child of Array.from(element.childNodes) as Node[]) {
    appendInlineRuns(child, runs, inherited);
  }
  return runs;
}

function inlineRunGroups(
  element: Element,
  inherited: RunStyle = {},
): TextRun[][] {
  const groups: TextRun[][] = [[]];
  for (const child of Array.from(element.childNodes) as Node[]) {
    appendInlineRunGroups(child, groups, inherited);
  }
  return groups.filter((group) => group.length > 0);
}

function appendInlineRunGroups(
  node: Node,
  groups: TextRun[][],
  inherited: RunStyle,
): void {
  if (node.nodeType === 3) {
    const text = normalizeText(node.textContent || "");
    if (text) groups[groups.length - 1].push(textRun(text, inherited));
    return;
  }
  if (!isElement(node)) return;

  const tag = node.tagName.toLowerCase();
  if (tag === "br") {
    groups.push([]);
    return;
  }
  const style = getInlineStyle(tag, inherited);
  for (const child of Array.from(node.childNodes) as Node[]) {
    appendInlineRunGroups(child, groups, style);
  }
}

function appendInlineRuns(
  node: Node,
  runs: TextRun[],
  inherited: RunStyle,
): void {
  if (node.nodeType === 3) {
    const text = normalizeText(node.textContent || "");
    if (text) runs.push(textRun(text, inherited));
    return;
  }
  if (!isElement(node)) return;

  const tag = node.tagName.toLowerCase();
  if (tag === "br") {
    runs.push(textRun(" ", inherited));
    return;
  }
  const style = getInlineStyle(tag, inherited);
  for (const child of Array.from(node.childNodes) as Node[]) {
    appendInlineRuns(child, runs, style);
  }
}

function getInlineStyle(tag: string, inherited: RunStyle): RunStyle {
  return {
    ...inherited,
    bold: inherited.bold || ["strong", "b", "th"].includes(tag),
    italics: inherited.italics || ["em", "i"].includes(tag),
    underline: inherited.underline || tag === "u",
    code: inherited.code || tag === "code",
  };
}

function textRun(text: string, style: RunStyle = {}): TextRun {
  return new TextRun({
    text,
    bold: style.bold,
    italics: style.italics,
    underline: style.underline ? { type: UnderlineType.SINGLE } : undefined,
    font: style.code ? "Consolas" : "Microsoft YaHei",
    size: 22,
  });
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
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
  const paragraphs = htmlToWordParagraphs(options.html);

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
    : [buildXmlParagraph(root.textContent || "")];
}

function appendNodeParagraphs(node: Node, paragraphs: string[]): void {
  if (node.nodeType === 3) {
    const text = normalizeText(node.textContent || "");
    if (text) paragraphs.push(buildXmlParagraph(text));
    return;
  }
  if (!isElement(node)) return;

  const tag = node.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));
    paragraphs.push(
      buildXmlParagraph(node.textContent || "", {
        bold: true,
        size: Math.max(22, 34 - level * 2),
      }),
    );
    return;
  }
  if (tag === "li") {
    paragraphs.push(
      buildXmlParagraph(`• ${normalizeText(node.textContent || "")}`),
    );
    return;
  }
  if (tag === "pre") {
    const text = node.textContent || "";
    for (const line of text.split(/\r?\n/))
      paragraphs.push(buildXmlParagraph(line, { monospace: true }));
    return;
  }
  if (tag === "table") {
    for (const row of Array.from(node.querySelectorAll("tr")) as Element[]) {
      const cells = (
        Array.from(row.querySelectorAll("th,td")) as Element[]
      ).map((cell) => normalizeText(cell.textContent || ""));
      if (cells.length) paragraphs.push(buildXmlParagraph(cells.join(" | ")));
    }
    return;
  }
  if (["p", "blockquote"].includes(tag)) {
    for (const line of textLinesByBreak(node)) {
      paragraphs.push(buildXmlParagraph(line));
    }
    return;
  }

  for (const child of Array.from(node.childNodes) as Node[]) {
    appendNodeParagraphs(child, paragraphs);
  }
}

function isElement(node: Node | null): node is Element {
  return !!node && node.nodeType === 1;
}

function textLinesByBreak(element: Element): string[] {
  const lines = [""];
  appendTextLinesByBreak(element, lines);
  return lines.map(normalizeText).filter(Boolean);
}

function appendTextLinesByBreak(node: Node, lines: string[]): void {
  if (node.nodeType === 3) {
    lines[lines.length - 1] += node.textContent || "";
    return;
  }
  if (!isElement(node)) return;

  if (node.tagName.toLowerCase() === "br") {
    lines.push("");
    return;
  }
  for (const child of Array.from(node.childNodes) as Node[]) {
    appendTextLinesByBreak(child, lines);
  }
}

function buildXmlParagraph(
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
