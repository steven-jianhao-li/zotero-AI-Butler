import { withZoteroBrowserGlobals } from "./noteExportBrowserGlobals";

export async function noteHtmlToMarkdown(html: string): Promise<string> {
  try {
    return await withZoteroBrowserGlobals(async () => {
      const TurndownService = await loadTurndown();
      const service = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        bulletListMarker: "-",
        strongDelimiter: "**",
      });

      try {
        const gfm = await import("turndown-plugin-gfm");
        const plugin = (gfm as any).gfm || (gfm as any).default?.gfm;
        if (plugin) service.use(plugin);
      } catch (error) {
        ztoolkit.log(
          "[AI-Butler][NoteExport] GFM Markdown 插件加载失败:",
          error,
        );
      }

      service.addRule("zoteroMath", {
        filter: (node: HTMLElement) =>
          node.nodeName === "SPAN" && node.classList.contains("math"),
        replacement: (_content: string, node: HTMLElement) =>
          node.textContent || "",
      });

      const markdown = service.turndown(sanitizeHtmlForMarkdown(html));
      return `${markdown.trim()}\n`;
    });
  } catch (error) {
    ztoolkit.log(
      "[AI-Butler][NoteExport] Turndown 在 Zotero 运行时不可用，使用内置 Markdown 转换:",
      error,
    );
    return `${simpleHtmlToMarkdown(html).trim()}\n`;
  }
}

function sanitizeHtmlForMarkdown(html: string): string {
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
  return String(root.innerHTML);
}

async function loadTurndown(): Promise<any> {
  const mod = (await import("turndown")) as any;
  return mod.default || mod;
}

function simpleHtmlToMarkdown(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(
      `<div id="ai-butler-export-root">${sanitizeHtmlForMarkdown(html)}</div>`,
      "text/html",
    );
    const root = doc.getElementById("ai-butler-export-root");
    if (!root) return stripHtml(html);
    const lines: string[] = [];
    for (const child of Array.from(root.childNodes) as Node[]) {
      appendMarkdownNode(child, lines);
    }
    return lines.join("\n\n");
  } catch {
    return stripHtml(html);
  }
}

function appendMarkdownNode(node: Node, lines: string[]): void {
  if (node.nodeType === 3) {
    const text = (node.textContent || "").trim();
    if (text) lines.push(text);
    return;
  }
  if (node.nodeType !== 1) return;
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  const text = (element.textContent || "").trim();
  if (!text) return;

  if (/^h[1-6]$/.test(tag)) {
    lines.push(`${"#".repeat(Number(tag.slice(1)))} ${text}`);
    return;
  }
  if (tag === "li") {
    lines.push(`- ${text}`);
    return;
  }
  if (tag === "pre") {
    lines.push(`\`\`\`\n${text}\n\`\`\``);
    return;
  }
  if (tag === "table") {
    for (const row of Array.from(element.querySelectorAll("tr")) as Element[]) {
      const cells = (
        Array.from(row.querySelectorAll("th,td")) as Element[]
      ).map((cell) => (cell.textContent || "").trim());
      if (cells.length) lines.push(`| ${cells.join(" | ")} |`);
    }
    return;
  }
  if (["p", "blockquote"].includes(tag)) {
    lines.push(text);
    return;
  }

  for (const child of Array.from(element.childNodes) as Node[]) {
    appendMarkdownNode(child, lines);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
