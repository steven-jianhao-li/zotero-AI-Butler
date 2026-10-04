import { Lexer, type MarkedToken, type Token } from "marked";
import { documentOf, element } from "./dom";

/** Allow source citations without permitting privileged or executable schemes. */
export function agentCitationURL(href: string): string | undefined {
  const value = decodeEntities(href).trim();
  if (
    [...value].some(
      (character) =>
        character.charCodeAt(0) <= 32 ||
        character.charCodeAt(0) === 127 ||
        character === "\\",
    )
  )
    return undefined;
  if (
    /^zotero:\/\/select\/(?:library|groups\/[1-9]\d*)\/items\/[A-Z0-9]{8}$/.test(
      value,
    )
  )
    return value;
  if (!/^https?:\/\//i.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.hostname && !url.username && !url.password) return url.href;
  } catch {
    // Incomplete streamed links remain ordinary text until they are valid.
  }
  return undefined;
}

/** Build a small Markdown DOM vocabulary; model HTML never reaches an HTML sink. */
export function renderAgentMarkdown(host: HTMLElement, source: string): void {
  host.replaceChildren();
  host.classList.add("agent-markdown");
  try {
    // A private lexer keeps unrelated marked extensions out of this boundary.
    const tokens = new Lexer({ gfm: true, breaks: false }).lex(source);
    appendTokens(host, tokens);
  } catch (error) {
    host.classList.remove("agent-markdown");
    host.textContent = source;
    ztoolkit.log("[AI-Butler Agent] Markdown rendering failed", error);
  }
}

function appendTokens(host: HTMLElement, tokens: Token[], depth = 0): void {
  const doc = documentOf(host);
  const text = (value: string) => host.appendChild(doc.createTextNode(value));
  for (const rawToken of tokens) {
    if (depth > 32) {
      text(rawToken.raw);
      continue;
    }
    // This lexer has no extensions; all emitted tokens use marked's built-ins.
    const token = rawToken as MarkedToken;
    switch (token.type) {
      case "space":
      case "def":
        break;
      case "paragraph":
      case "blockquote":
      case "strong":
      case "em":
      case "del": {
        const tags = {
          paragraph: "p",
          blockquote: "blockquote",
          strong: "strong",
          em: "em",
          del: "del",
        } as const;
        const node = element(doc, tags[token.type], "");
        appendTokens(node, token.tokens, depth + 1);
        host.append(node);
        break;
      }
      case "heading": {
        const tags = ["h2", "h3", "h4", "h5", "h6", "h6"] as const;
        const node = element(doc, tags[token.depth - 1] || "h6", "");
        appendTokens(node, token.tokens, depth + 1);
        host.append(node);
        break;
      }
      case "code": {
        const pre = element(doc, "pre", "");
        pre.tabIndex = 0;
        pre.append(element(doc, "code", "", token.text));
        host.append(pre);
        break;
      }
      case "codespan":
        host.append(element(doc, "code", "", token.text));
        break;
      case "br":
      case "hr":
        host.append(element(doc, token.type, ""));
        break;
      case "list": {
        const list = element(doc, token.ordered ? "ol" : "ul", "");
        if (token.ordered && typeof token.start === "number")
          list.setAttribute("start", String(token.start));
        appendTokens(list, token.items, depth + 1);
        host.append(list);
        break;
      }
      case "list_item": {
        const item = element(doc, "li", "");
        appendTokens(item, token.tokens, depth + 1);
        host.append(item);
        break;
      }
      case "checkbox":
        text(token.checked ? "☑ " : "☐ ");
        break;
      case "table": {
        const wrapper = element(doc, "div", "agent-markdown-table");
        wrapper.tabIndex = 0;
        const table = element(doc, "table", "");
        const head = element(doc, "thead", "");
        const body = element(doc, "tbody", "");
        for (const [index, cells] of [token.header, ...token.rows].entries()) {
          const row = element(doc, "tr", "");
          for (const cell of cells) {
            const node = element(doc, index === 0 ? "th" : "td", "");
            if (cell.align) node.style.textAlign = cell.align;
            if (index === 0) node.setAttribute("scope", "col");
            appendTokens(node, cell.tokens, depth + 1);
            row.append(node);
          }
          (index === 0 ? head : body).append(row);
        }
        table.append(head, body);
        wrapper.append(table);
        host.append(wrapper);
        break;
      }
      case "link": {
        const href = agentCitationURL(token.href);
        if (!href) {
          appendTokens(host, token.tokens, depth + 1);
          break;
        }
        const link = element(doc, "a", "");
        link.href = href;
        link.title = token.title || href;
        link.rel = "noopener noreferrer";
        appendTokens(link, token.tokens, depth + 1);
        link.addEventListener("click", (event) => {
          event.preventDefault();
          Zotero.launchURL(href);
        });
        host.append(link);
        break;
      }
      case "image":
        // Image descriptions are useful evidence; remote resources are not loaded.
        text(decodeEntities(token.text));
        break;
      case "text":
        if (token.tokens) appendTokens(host, token.tokens, depth + 1);
        else text(decodeEntities(token.text));
        break;
      case "escape":
        text(token.text);
        break;
      case "html":
        text(token.raw);
        break;
      default:
        text(rawToken.raw);
    }
  }
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: "\u00a0",
  };
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (all, key: string) => {
      if (!key.startsWith("#")) return named[key.toLowerCase()] || all;
      const hex = key[1].toLowerCase() === "x";
      const code = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : all;
    },
  );
}
