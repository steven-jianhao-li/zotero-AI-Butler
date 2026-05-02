import { ProgressWindowHelper } from "zotero-plugin-toolkit";

type ProgressWindowOptions = {
  window?: Window;
  closeOnClick?: boolean;
  closeTime?: number;
  closeOtherProgressWindows?: boolean;
};

type ProgressLineOptions = {
  type?: string;
  icon?: string;
  text?: string;
  progress?: number;
  idx?: number;
};

type ToastLine = {
  type: string;
  icon?: string;
  text: string;
  progress?: number;
};

const HTML_NS = "http://www.w3.org/1999/xhtml";
const STYLE_ID = "ai-butler-modern-progress-window-style";
const STACK_ID = "ai-butler-modern-progress-window-stack";

/**
 * A drop-in replacement for ztoolkit's ProgressWindow helper.
 *
 * Zotero 8 renders the native ProgressWindow with dated chrome styling. This
 * class keeps the same fluent API used across the project, but paints the UI as
 * a lightweight toast in the active Zotero window.
 */
export class ModernProgressWindow extends ProgressWindowHelper {
  private static readonly iconURIs = new Map<string, string>();
  private static readonly openWindows = new Set<ModernProgressWindow>();

  private readonly options: ProgressWindowOptions;
  private readonly linesData: ToastLine[] = [];
  private readonly descriptions: string[] = [];
  private headline: string;
  private headlineIcon?: string;
  private headlinePostText = "";
  private root: HTMLElement | null = null;
  private targetWindow: Window | null = null;
  private closeTimer: number | null = null;
  private pendingMouseOverClose: number | null = null;
  private hasMouseOver = false;

  public constructor(header: string, options: ProgressWindowOptions = {}) {
    super(header, { ...options, closeTime: -1 });
    this.headline = header;
    this.options = {
      closeOnClick: options.closeOnClick ?? true,
      closeTime: options.closeTime ?? 5000,
      closeOtherProgressWindows: options.closeOtherProgressWindows,
      window: options.window,
    };

    if (this.options.closeOtherProgressWindows) {
      ModernProgressWindow.closeAll();
    }
  }

  public static override setIconURI(key: string, uri: string): void {
    ModernProgressWindow.iconURIs.set(key, uri);
    ProgressWindowHelper.setIconURI(key, uri);
  }

  public createLine(options: ProgressLineOptions): this {
    this.linesData.push({
      type: this.normalizeType(options.type),
      icon: this.resolveIcon(options.type, options.icon),
      text: options.text ?? "",
      progress: options.progress,
    });
    this.render();
    return this;
  }

  public changeLine(options: ProgressLineOptions): this {
    if (this.linesData.length === 0) {
      return this.createLine(options);
    }

    const idx =
      typeof options.idx === "number" &&
      options.idx >= 0 &&
      options.idx < this.linesData.length
        ? options.idx
        : 0;
    const line = this.linesData[idx];

    if (typeof options.type !== "undefined") {
      line.type = this.normalizeType(options.type);
    }
    if (
      typeof options.icon !== "undefined" ||
      typeof options.type !== "undefined"
    ) {
      line.icon = this.resolveIcon(options.type, options.icon);
    }
    if (typeof options.text !== "undefined") {
      line.text = options.text;
    }
    if (typeof options.progress === "number") {
      line.progress = options.progress;
    }

    this.render();
    return this;
  }

  public show(closeTime?: number): this {
    if (typeof closeTime !== "undefined") {
      this.options.closeTime = closeTime;
    }

    const doc = this.resolveDocument();
    if (!doc) {
      return this.showNativeFallback();
    }

    this.targetWindow = doc.defaultView ?? this.options.window ?? null;
    this.ensureStyles(doc);
    const stack = this.ensureStack(doc);

    if (!this.root) {
      this.root = this.createToastElement(doc);
      stack.prepend(this.root);
    }

    this.render();
    ModernProgressWindow.openWindows.add(this);

    this.targetWindow?.requestAnimationFrame(() => {
      this.root?.classList.add("ai-butler-toast--visible");
    });

    if (this.options.closeTime && this.options.closeTime > 0) {
      this.startCloseTimer(this.options.closeTime);
    }

    return this;
  }

  public override changeHeadline(
    text: string,
    icon?: string,
    postText?: string,
  ): this {
    this.headline = text;
    this.headlineIcon = icon;
    this.headlinePostText = postText ?? "";
    this.render();
    return this;
  }

  public override addLines(
    labels: string | { [key: string | number | symbol]: string },
    icons: string | { [key: string | number | symbol]: string },
  ): this {
    if (typeof labels === "string") {
      this.createLine({
        text: labels,
        icon: typeof icons === "string" ? icons : undefined,
      });
      return this;
    }

    for (const key of Object.keys(labels)) {
      const icon = typeof icons === "string" ? icons : icons[key];
      this.createLine({ text: labels[key], icon });
    }
    return this;
  }

  public override addDescription(text: string): this {
    this.descriptions.push(text);
    this.render();
    return this;
  }

  public override startCloseTimer(ms: number, requireMouseOver = false): this {
    this.clearCloseTimer();
    if (requireMouseOver && !this.hasMouseOver) {
      this.pendingMouseOverClose = ms;
      return this;
    }

    if (ms > 0 && this.targetWindow) {
      this.closeTimer = this.targetWindow.setTimeout(() => this.close(), ms);
    }
    return this;
  }

  public override close(): this {
    this.clearCloseTimer();
    this.pendingMouseOverClose = null;
    ModernProgressWindow.openWindows.delete(this);

    const root = this.root;
    if (!root) {
      return this;
    }

    root.classList.remove("ai-butler-toast--visible");
    root.classList.add("ai-butler-toast--closing");

    const remove = () => {
      root.remove();
      if (this.root === root) {
        this.root = null;
      }
    };

    if (this.targetWindow) {
      this.targetWindow.setTimeout(remove, 180);
    } else {
      remove();
    }

    return this;
  }

  private static closeAll(): void {
    for (const win of [...ModernProgressWindow.openWindows]) {
      win.close();
    }
  }

  private resolveDocument(): Document | null {
    if (this.options.window?.document?.documentElement) {
      return this.options.window.document;
    }

    try {
      const recentWindow = Services.wm.getMostRecentWindow("") as Window | null;
      if (recentWindow?.document?.documentElement) {
        return recentWindow.document;
      }
    } catch {
      // Fall through to Zotero main window.
    }

    try {
      const mainWindow = Zotero.getMainWindow();
      if (mainWindow?.document?.documentElement) {
        return mainWindow.document;
      }
    } catch {
      // Zotero may not be ready yet.
    }

    return null;
  }

  private ensureStyles(doc: Document): void {
    if (doc.getElementById(STYLE_ID)) {
      return;
    }

    const style = this.createHtmlElement(doc, "style");
    style.id = STYLE_ID;
    style.textContent = `
#${STACK_ID} {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(360px, calc(100vw - 44px));
  pointer-events: none;
}

.ai-butler-toast {
  box-sizing: border-box;
  width: 100%;
  padding: 13px 15px 14px;
  border: 1px solid rgba(20, 35, 60, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.96);
  color: #172033;
  box-shadow: 0 14px 38px rgba(20, 35, 60, 0.18), 0 2px 8px rgba(20, 35, 60, 0.08);
  font: menu;
  opacity: 0;
  transform: translateY(8px) scale(0.985);
  transition: opacity 160ms ease, transform 160ms ease;
  pointer-events: auto;
  overflow: hidden;
  backdrop-filter: blur(16px);
}

.ai-butler-toast--visible {
  opacity: 1;
  transform: translateY(0) scale(1);
}

.ai-butler-toast--closing {
  opacity: 0;
  transform: translateY(8px) scale(0.985);
}

.ai-butler-toast__headline {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-bottom: 7px;
  font-size: 13px;
  font-weight: 650;
  line-height: 1.35;
}

.ai-butler-toast__headline img {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}

.ai-butler-toast__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-butler-toast__body {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.ai-butler-toast__line {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr);
  gap: 9px;
  align-items: start;
  color: #596579;
  font-size: 13px;
  line-height: 1.45;
}

.ai-butler-toast__mark {
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 999px;
  background: #4f7cff;
  box-shadow: 0 0 0 3px rgba(79, 124, 255, 0.14);
}

.ai-butler-toast__mark--success {
  background: #2eae63;
  box-shadow: 0 0 0 3px rgba(46, 174, 99, 0.16);
}

.ai-butler-toast__mark--error {
  background: #dc3f4d;
  box-shadow: 0 0 0 3px rgba(220, 63, 77, 0.16);
}

.ai-butler-toast__mark--warning {
  background: #d89a18;
  box-shadow: 0 0 0 3px rgba(216, 154, 24, 0.18);
}

.ai-butler-toast__mark img {
  width: 14px;
  height: 14px;
  display: block;
  margin: -3px 0 0 -3px;
}

.ai-butler-toast__text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.ai-butler-toast__progress {
  grid-column: 2;
  height: 3px;
  margin-top: 1px;
  border-radius: 999px;
  background: rgba(79, 124, 255, 0.14);
  overflow: hidden;
}

.ai-butler-toast__progress-bar {
  height: 100%;
  border-radius: inherit;
  background: #4f7cff;
  transition: width 180ms ease;
}

.ai-butler-toast__description {
  color: #6b7484;
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

#${STACK_ID}.ai-butler-toast-stack--dark .ai-butler-toast {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(34, 38, 46, 0.96);
  color: #f4f6f8;
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.34), 0 2px 10px rgba(0, 0, 0, 0.18);
}

#${STACK_ID}.ai-butler-toast-stack--dark .ai-butler-toast__line {
  color: #c4cbd6;
}

#${STACK_ID}.ai-butler-toast-stack--dark .ai-butler-toast__description {
  color: #aeb7c4;
}
`;

    const parent = doc.head ?? doc.documentElement;
    if (!parent) {
      return;
    }
    parent.appendChild(style);
  }

  private ensureStack(doc: Document): HTMLElement {
    const existing = doc.getElementById(STACK_ID);
    if (existing) {
      const stack = existing as HTMLElement;
      stack.classList.toggle("ai-butler-toast-stack--dark", this.isDarkMode());
      return stack;
    }

    const stack = this.createHtmlElement(doc, "div");
    stack.id = STACK_ID;
    stack.className = "ai-butler-toast-stack";
    stack.classList.toggle("ai-butler-toast-stack--dark", this.isDarkMode());
    const parent = doc.documentElement ?? doc.body;
    parent?.appendChild(stack);
    return stack;
  }

  private createToastElement(doc: Document): HTMLElement {
    const root = this.createHtmlElement(doc, "div");
    root.className = "ai-butler-toast";
    root.setAttribute("role", "status");

    if (this.options.closeOnClick) {
      root.addEventListener("click", () => this.close());
    }
    root.addEventListener("mouseenter", () => {
      this.hasMouseOver = true;
      if (this.pendingMouseOverClose !== null) {
        const ms = this.pendingMouseOverClose;
        this.pendingMouseOverClose = null;
        this.startCloseTimer(ms);
      }
    });

    const headline = this.createHtmlElement(doc, "div");
    headline.className = "ai-butler-toast__headline";

    const title = this.createHtmlElement(doc, "span");
    title.className = "ai-butler-toast__title";
    headline.appendChild(title);

    const body = this.createHtmlElement(doc, "div");
    body.className = "ai-butler-toast__body";

    root.append(headline, body);
    return root;
  }

  private render(): void {
    if (!this.root) {
      return;
    }

    const doc = this.root.ownerDocument;
    if (!doc) {
      return;
    }
    const headline = this.root.querySelector(".ai-butler-toast__headline");
    const body = this.root.querySelector(".ai-butler-toast__body");
    if (!headline || !body) {
      return;
    }
    const headlineElement = headline as HTMLElement;
    const bodyElement = body as HTMLElement;

    this.replaceChildren(headlineElement);
    if (this.headlineIcon) {
      const icon = this.createHtmlElement(doc, "img");
      icon.src = this.headlineIcon;
      icon.alt = "";
      headlineElement.appendChild(icon);
    }

    const title = this.createHtmlElement(doc, "span");
    title.className = "ai-butler-toast__title";
    title.textContent = `${this.headline}${this.headlinePostText}`;
    headlineElement.appendChild(title);

    this.replaceChildren(bodyElement);
    for (const line of this.linesData) {
      bodyElement.appendChild(this.createLineElement(doc, line));
    }
    for (const description of this.descriptions) {
      const desc = this.createHtmlElement(doc, "div");
      desc.className = "ai-butler-toast__description";
      desc.textContent = description;
      bodyElement.appendChild(desc);
    }
  }

  private createLineElement(doc: Document, line: ToastLine): HTMLElement {
    const row = this.createHtmlElement(doc, "div");
    row.className = "ai-butler-toast__line";

    const mark = this.createHtmlElement(doc, "span");
    mark.className = `ai-butler-toast__mark ai-butler-toast__mark--${line.type}`;
    if (line.icon) {
      const icon = this.createHtmlElement(doc, "img");
      icon.src = line.icon;
      icon.alt = "";
      mark.appendChild(icon);
    }

    const text = this.createHtmlElement(doc, "div");
    text.className = "ai-butler-toast__text";
    text.textContent = line.text;

    row.append(mark, text);

    if (
      typeof line.progress === "number" &&
      line.progress >= 0 &&
      line.progress < 100
    ) {
      const progress = this.createHtmlElement(doc, "div");
      progress.className = "ai-butler-toast__progress";

      const bar = this.createHtmlElement(doc, "div");
      bar.className = "ai-butler-toast__progress-bar";
      bar.style.width = `${Math.max(0, Math.min(100, line.progress))}%`;
      progress.appendChild(bar);
      row.appendChild(progress);
    }

    return row;
  }

  private showNativeFallback(): this {
    this.win.changeHeadline(
      this.headline,
      this.headlineIcon,
      this.headlinePostText,
    );
    for (const line of this.linesData) {
      const itemProgress = new this.win.ItemProgress(
        line.icon ?? "",
        line.text,
      );
      if (typeof line.progress === "number") {
        itemProgress.setProgress(line.progress);
      }
    }
    for (const description of this.descriptions) {
      this.win.addDescription(description);
    }
    this.win.show();
    if (this.options.closeTime && this.options.closeTime > 0) {
      this.win.startCloseTimer(this.options.closeTime);
    }
    return this;
  }

  private normalizeType(type: string | undefined): string {
    if (type === "fail") {
      return "error";
    }
    if (type === "success" || type === "error" || type === "warning") {
      return type;
    }
    return "default";
  }

  private resolveIcon(
    type: string | undefined,
    explicitIcon: string | undefined,
  ): string | undefined {
    if (explicitIcon) {
      return explicitIcon;
    }
    if (type && ModernProgressWindow.iconURIs.has(type)) {
      return ModernProgressWindow.iconURIs.get(type);
    }
    return undefined;
  }

  private clearCloseTimer(): void {
    if (this.closeTimer !== null && this.targetWindow) {
      this.targetWindow.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  private isDarkMode(): boolean {
    try {
      if (Services.prefs.getBoolPref("zotero.theme.dark", false)) {
        return true;
      }
    } catch {
      // Continue with other checks.
    }

    try {
      if (Services.prefs.getBoolPref("ui.systemUsesDarkTheme", false)) {
        return true;
      }
    } catch {
      // Continue with media query.
    }

    try {
      const mediaQuery = this.targetWindow?.matchMedia(
        "(prefers-color-scheme: dark)",
      );
      return Boolean(mediaQuery?.matches);
    } catch {
      return false;
    }
  }

  private createHtmlElement<K extends keyof HTMLElementTagNameMap>(
    doc: Document,
    tag: K,
  ): HTMLElementTagNameMap[K] {
    return doc.createElementNS(HTML_NS, tag) as HTMLElementTagNameMap[K];
  }

  private replaceChildren(element: HTMLElement): void {
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }
}
