import { getString } from "../../../utils/locale";
import type { FluentMessageId } from "../../../../typings/i10n";

export function t(
  key: FluentMessageId,
  args?: Record<string, unknown>,
): string {
  return getString(key, args ? { args } : {});
}

export function documentOf(node: HTMLElement): Document {
  const doc = node.ownerDocument;
  if (!doc) throw new Error("Host element has no ownerDocument");
  return doc;
}

export function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(
  doc: Document,
  label: string,
  onClick: () => void,
  className = "agent-button",
): HTMLButtonElement {
  const node = element(doc, "button", className, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

export function select(
  doc: Document,
  label: string,
  choices: Array<{ value: string; label: string }>,
): HTMLSelectElement {
  const node = element(doc, "select", "agent-select");
  node.setAttribute("aria-label", label);
  node.title = label;
  for (const choice of choices) {
    const option = element(doc, "option", "", choice.label);
    option.value = choice.value;
    node.append(option);
  }
  return node;
}
