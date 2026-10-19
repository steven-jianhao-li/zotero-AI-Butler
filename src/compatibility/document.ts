import { isLegacyHost } from "./host";

export function prepareDocument(doc: Document): void {
  if (!isLegacyHost()) return;
  if (!doc.createXULElement) {
    doc.createXULElement = ((tag: string) =>
      doc.createElementNS(
        "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        tag,
      )) as Document["createXULElement"];
  }
  const prototype = doc.defaultView?.Element.prototype;
  if (prototype && !prototype.replaceChildren) {
    Object.defineProperty(prototype, "replaceChildren", {
      configurable: true,
      writable: true,
      value: function (this: Element, ...children: (Node | string)[]) {
        const fragment = doc.createDocumentFragment();
        fragment.append(...children);
        this.textContent = "";
        this.appendChild(fragment);
      },
    });
  }
}
