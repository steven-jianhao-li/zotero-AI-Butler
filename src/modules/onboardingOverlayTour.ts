import { MainWindow } from "./views/MainWindow";
import { showSetupWizard, openExternalUrl } from "./views/SetupWizard";
import { ONBOARDING_DOCS_URL } from "./onboardingContent";

export type OverlayTourSource = "startup" | "dashboard" | "settings";

type OverlayTourPlacement = "top" | "right" | "bottom" | "left" | "center";

type OverlayTourStep = {
  id: string;
  title: string;
  description: string;
  target?: string | (() => Element | null);
  placement?: OverlayTourPlacement;
  action?: {
    label: string;
    run: () => void | Promise<void>;
  };
  fallbackDescription?: string;
};

type OverlayTourOptions = {
  onComplete: () => void;
  onOpenFallback: () => void | Promise<void>;
};

type OverlayTourState = {
  win: Window;
  doc: Document;
  root: HTMLElement;
  masks: HTMLElement[];
  highlight: HTMLElement;
  card: HTMLElement;
  index: number;
  steps: OverlayTourStep[];
  options: OverlayTourOptions;
  reposition: () => void;
  keyHandler: (event: KeyboardEvent) => void;
};

const OVERLAY_ID = "ai-butler-onboarding-overlay-tour";

let activeTour: OverlayTourState | null = null;

const tourSteps: OverlayTourStep[] = [
  {
    id: "toolbar",
    title: "第一步：这里是 🤖 AI 管家入口",
    description:
      "点击文献列表上方的 🤖 按钮，可以打开仪表盘、任务队列、快捷设置和教程。这个入口适合日常查看插件状态。",
    target: "#ai-butler-library-toolbar-btn",
    placement: "bottom",
    fallbackDescription:
      "如果没有看到 🤖 按钮，请确认当前在 Zotero 文献库主窗口，并等待插件工具栏加载完成。",
  },
  {
    id: "items",
    title: "第二步：在这里选择论文",
    description:
      "在中间的文献列表中选择一篇带 PDF 附件的论文。AI 总结、精读、追问、一图总结等功能都围绕选中的论文展开。",
    target: () =>
      queryFirst([
        "#zotero-items-tree",
        "#items-tree-main-default",
        "#item-tree-main-default",
        "#zotero-items-pane",
        ".items-tree",
      ]),
    placement: "right",
    fallbackDescription:
      "请回到 Zotero 文献库主窗口，在中间文献列表选中一篇论文。",
  },
  {
    id: "item-menu",
    title: "第三步：右键论文使用 AI 管家",
    description:
      "选中论文后右键，可以在 AI 管家菜单中立即生成总结、精读、思维导图、一图总结或打开追问。右键菜单只有在菜单打开时才会出现在界面上。",
    target: () =>
      queryFirst([
        "#zotero-itemmenu-ai-butler-root",
        "#zotero-itemmenu-ai-butler-summary",
        "#zotero-items-tree",
        "#items-tree-main-default",
        "#zotero-items-pane",
      ]),
    placement: "right",
    fallbackDescription:
      "请先选中一篇论文并右键；如果菜单没有展开，本步骤会先高亮论文列表。",
  },
  {
    id: "collections",
    title: "第四步：右键分类做集合级任务",
    description:
      "左侧分类/集合区域可以触发集合级功能，例如文献综述、表格填充、导出或清理 AI 笔记。",
    target: () =>
      queryFirst([
        "#zotero-collections-tree",
        "#collections-tree",
        "#zotero-collections-pane",
        ".collections-tree",
      ]),
    placement: "right",
    fallbackDescription:
      "如果当前布局隐藏了左侧分类栏，请展开 Zotero 左侧集合面板后再查看。",
  },
  {
    id: "sidebar",
    title: "第五步：右侧边栏查看 AI 内容",
    description:
      "选中文献后，右侧条目面板会显示 AI 管家区块，用于查看 AI 笔记、一图总结、思维导图和快速追问。",
    target: () =>
      queryFirst([
        '[data-pane="ai-butler-chat-section"]',
        "#ai-butler-quick-chat-btn",
        ".ai-butler-note-section",
        "#zotero-item-pane",
        "#item-pane",
        '[data-pane="item-pane"]',
      ]),
    placement: "left",
    fallbackDescription:
      "如果没有看到右侧 AI 管家区块，请先选中一篇论文；侧边栏模块也可能被用户隐藏。",
  },
  {
    id: "setup",
    title: "第六步：配置 API Key 后开始使用",
    description:
      "首次使用建议打开一键初始化配置。它会复用同一套配置向导，帮你写入模型端点、API Key、PDF 处理模式和常用参数。",
    placement: "center",
    action: {
      label: "一键初始化配置",
      run: () => showSetupWizard(Zotero.getMainWindow().document),
    },
  },
  {
    id: "finish",
    title: "完成：开始让 AI 管家处理论文",
    description:
      "教程完成后，本设备不会再自动弹出当前版本。之后仍可在仪表盘或设置页重新打开交互式引导，也可以查看图文教程和在线文档。",
    placement: "center",
    action: {
      label: "打开在线文档",
      run: () => openExternalUrl(ONBOARDING_DOCS_URL),
    },
  },
];

export async function startOnboardingOverlayTour(
  source: OverlayTourSource,
  options: OverlayTourOptions,
): Promise<boolean> {
  const win = Zotero.getMainWindow();
  const doc = win?.document;
  if (!win || !doc?.documentElement) return false;

  closeOnboardingOverlayTour();

  const root = doc.createElement("div");
  root.id = OVERLAY_ID;
  Object.assign(root.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483646",
    pointerEvents: "auto",
    fontFamily: "system-ui, -apple-system, sans-serif",
  } as Partial<CSSStyleDeclaration>);

  const masks = Array.from({ length: 4 }, () => {
    const mask = doc.createElement("div");
    Object.assign(mask.style, {
      position: "fixed",
      backgroundColor: "rgba(0, 0, 0, 0.58)",
      transition: "all 0.18s ease",
      pointerEvents: "auto",
    } as Partial<CSSStyleDeclaration>);
    root.appendChild(mask);
    return mask;
  });

  const highlight = doc.createElement("div");
  Object.assign(highlight.style, {
    position: "fixed",
    border: "3px solid #00d4a1",
    borderRadius: "12px",
    boxShadow:
      "0 0 0 4px rgba(0, 212, 161, 0.22), 0 10px 32px rgba(0,0,0,0.28)",
    transition: "all 0.18s ease",
    pointerEvents: "none",
    display: "none",
  } as Partial<CSSStyleDeclaration>);

  const card = doc.createElement("div");
  Object.assign(card.style, {
    position: "fixed",
    width: "min(390px, calc(100vw - 32px))",
    maxHeight: "calc(100vh - 32px)",
    overflow: "auto",
    backgroundColor: "var(--ai-bg, #fff)",
    color: "var(--ai-text, #222)",
    border: "1px solid rgba(89, 192, 188, 0.35)",
    borderRadius: "16px",
    boxShadow: "0 18px 50px rgba(0,0,0,0.34)",
    padding: "18px",
    boxSizing: "border-box",
    transition: "all 0.18s ease",
  } as Partial<CSSStyleDeclaration>);

  root.appendChild(highlight);
  root.appendChild(card);
  doc.documentElement.appendChild(root);

  const state: OverlayTourState = {
    win,
    doc,
    root,
    masks,
    highlight,
    card,
    index: 0,
    steps: tourSteps,
    options,
    reposition: () => renderActiveStep(),
    keyHandler: (event) => {
      if (event.key === "Escape") {
        closeOnboardingOverlayTour();
      } else if (event.key === "ArrowRight") {
        goNext();
      } else if (event.key === "ArrowLeft") {
        goPrev();
      }
    },
  };

  activeTour = state;
  win.addEventListener("resize", state.reposition);
  win.addEventListener("scroll", state.reposition, true);
  doc.addEventListener("keydown", state.keyHandler, true);

  ztoolkit.log(`[AI-Butler] 启动覆盖式新手教程: ${source}`);
  renderActiveStep();
  return true;
}

export function closeOnboardingOverlayTour(): void {
  if (!activeTour) return;
  const state = activeTour;
  state.win.removeEventListener("resize", state.reposition);
  state.win.removeEventListener("scroll", state.reposition, true);
  state.doc.removeEventListener("keydown", state.keyHandler, true);
  state.root.remove();
  activeTour = null;
}

function renderActiveStep(): void {
  const state = activeTour;
  if (!state) return;
  const step = state.steps[state.index];
  const target = resolveTarget(step);
  const rect = target ? getVisibleRect(target) : null;

  if (rect) {
    renderSpotlight(state, rect);
    renderCard(state, step, rect);
  } else {
    renderFullMask(state);
    renderCard(state, step, null);
  }
}

function renderSpotlight(state: OverlayTourState, rect: DOMRect): void {
  const padding = 8;
  const left = Math.max(0, rect.left - padding);
  const top = Math.max(0, rect.top - padding);
  const right = Math.min(state.win.innerWidth, rect.right + padding);
  const bottom = Math.min(state.win.innerHeight, rect.bottom + padding);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);

  setBox(state.masks[0], 0, 0, state.win.innerWidth, top);
  setBox(
    state.masks[1],
    0,
    bottom,
    state.win.innerWidth,
    state.win.innerHeight - bottom,
  );
  setBox(state.masks[2], 0, top, left, height);
  setBox(state.masks[3], right, top, state.win.innerWidth - right, height);

  Object.assign(state.highlight.style, {
    display: "block",
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  } as Partial<CSSStyleDeclaration>);
}

function renderFullMask(state: OverlayTourState): void {
  setBox(state.masks[0], 0, 0, state.win.innerWidth, state.win.innerHeight);
  for (let i = 1; i < state.masks.length; i++) {
    setBox(state.masks[i], 0, 0, 0, 0);
  }
  state.highlight.style.display = "none";
}

function renderCard(
  state: OverlayTourState,
  step: OverlayTourStep,
  rect: DOMRect | null,
): void {
  const total = state.steps.length;
  const isLast = state.index === total - 1;
  const missingTarget = !rect && step.target;
  state.card.innerHTML = "";

  const progress = state.doc.createElement("div");
  progress.textContent = `${state.index + 1} / ${total}`;
  Object.assign(progress.style, {
    color: "#00a67e",
    fontSize: "12px",
    fontWeight: "800",
    marginBottom: "8px",
  } as Partial<CSSStyleDeclaration>);

  const title = state.doc.createElement("div");
  title.textContent = step.title;
  Object.assign(title.style, {
    fontSize: "19px",
    fontWeight: "800",
    marginBottom: "10px",
    lineHeight: "1.35",
  } as Partial<CSSStyleDeclaration>);

  const desc = state.doc.createElement("div");
  desc.textContent = missingTarget
    ? step.fallbackDescription || step.description
    : step.description;
  Object.assign(desc.style, {
    color: "var(--ai-text-muted, #666)",
    fontSize: "14px",
    lineHeight: "1.65",
  } as Partial<CSSStyleDeclaration>);

  const actions = state.doc.createElement("div");
  Object.assign(actions.style, {
    display: "flex",
    justifyContent: "space-between",
    gap: "8px",
    flexWrap: "wrap",
    marginTop: "18px",
  } as Partial<CSSStyleDeclaration>);

  const left = state.doc.createElement("div");
  Object.assign(left.style, { display: "flex", gap: "8px", flexWrap: "wrap" });
  if (state.index > 0)
    left.appendChild(createTourButton("上一步", "#607d8b", goPrev));
  left.appendChild(
    createTourButton("图文教程", "#9e9e9e", () => void openFallback()),
  );

  const right = state.doc.createElement("div");
  Object.assign(right.style, { display: "flex", gap: "8px", flexWrap: "wrap" });
  if (step.action) {
    right.appendChild(
      createTourButton(
        step.action.label,
        "#3f51b5",
        () => void step.action?.run(),
      ),
    );
  }
  right.appendChild(
    createTourButton(isLast ? "完成教程" : "下一步", "#00a67e", () => {
      if (isLast) finishTour();
      else goNext();
    }),
  );
  right.appendChild(
    createTourButton("跳过", "#9e9e9e", closeOnboardingOverlayTour),
  );

  actions.appendChild(left);
  actions.appendChild(right);
  state.card.append(progress, title, desc, actions);

  positionCard(state, step, rect);
}

function positionCard(
  state: OverlayTourState,
  step: OverlayTourStep,
  rect: DOMRect | null,
): void {
  const margin = 16;
  const cardWidth = Math.min(390, state.win.innerWidth - 32);
  const cardHeight = Math.min(
    state.card.scrollHeight || 260,
    state.win.innerHeight - 32,
  );
  let left = (state.win.innerWidth - cardWidth) / 2;
  let top = (state.win.innerHeight - cardHeight) / 2;

  if (rect) {
    const placement = step.placement || "bottom";
    if (placement === "right") {
      left = rect.right + margin;
      top = rect.top;
    } else if (placement === "left") {
      left = rect.left - cardWidth - margin;
      top = rect.top;
    } else if (placement === "top") {
      left = rect.left;
      top = rect.top - cardHeight - margin;
    } else if (placement === "bottom") {
      left = rect.left;
      top = rect.bottom + margin;
    }
  }

  left = clamp(left, margin, state.win.innerWidth - cardWidth - margin);
  top = clamp(top, margin, state.win.innerHeight - cardHeight - margin);
  Object.assign(state.card.style, {
    width: `${cardWidth}px`,
    left: `${left}px`,
    top: `${top}px`,
  } as Partial<CSSStyleDeclaration>);
}

function createTourButton(
  label: string,
  color: string,
  onClick: () => void,
): HTMLButtonElement {
  const doc = activeTour?.doc || Zotero.getMainWindow().document;
  const button = doc.createElement("button");
  button.textContent = label;
  Object.assign(button.style, {
    border: `1px solid ${color}`,
    borderRadius: "8px",
    backgroundColor: "#fff",
    color,
    padding: "8px 12px",
    fontSize: "13px",
    fontWeight: "700",
    cursor: "pointer",
  } as Partial<CSSStyleDeclaration>);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function goNext(): void {
  if (!activeTour) return;
  activeTour.index = Math.min(
    activeTour.steps.length - 1,
    activeTour.index + 1,
  );
  renderActiveStep();
}

function goPrev(): void {
  if (!activeTour) return;
  activeTour.index = Math.max(0, activeTour.index - 1);
  renderActiveStep();
}

async function openFallback(): Promise<void> {
  const options = activeTour?.options;
  closeOnboardingOverlayTour();
  await options?.onOpenFallback();
}

function finishTour(): void {
  const options = activeTour?.options;
  options?.onComplete();
  new ztoolkit.ProgressWindow("AI Butler", { closeTime: 2400 })
    .createLine({ text: "✅ 新手教程已完成", type: "success" })
    .show();
  closeOnboardingOverlayTour();
}

function resolveTarget(step: OverlayTourStep): Element | null {
  try {
    if (!step.target) return null;
    if (typeof step.target === "function") return step.target();
    return Zotero.getMainWindow().document.querySelector(step.target);
  } catch {
    return null;
  }
}

function queryFirst(selectors: string[]): Element | null {
  const doc = Zotero.getMainWindow().document;
  for (const selector of selectors) {
    const element = doc.querySelector(selector);
    if (element && getVisibleRect(element)) return element;
  }
  return null;
}

function getVisibleRect(element: Element): DOMRect | null {
  const rect = element.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return null;
  const win = Zotero.getMainWindow();
  if (rect.bottom <= 0 || rect.right <= 0) return null;
  if (rect.top >= win.innerHeight || rect.left >= win.innerWidth) return null;
  return rect;
}

function setBox(
  element: HTMLElement,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  Object.assign(element.style, {
    left: `${Math.max(0, left)}px`,
    top: `${Math.max(0, top)}px`,
    width: `${Math.max(0, width)}px`,
    height: `${Math.max(0, height)}px`,
  } as Partial<CSSStyleDeclaration>);
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}
