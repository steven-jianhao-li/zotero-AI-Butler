/**
 * 流式 Markdown 渲染器
 *
 * 解决的问题：流式回答时每个 delta（通常 1–4 个字符）都触发一次
 * 「整篇已生成内容 → Markdown + KaTeX → innerHTML 全量替换」，
 * 复杂度 O(N²) 且同步跑在 UI 线程上，导致 Zotero 6（Gecko 60）界面
 * 在回答结束前完全无响应。
 *
 * 本模块把渲染拆成两个阶段：
 *
 * 1. 流式期（`plain-until-final` 策略）：只把新增文本 append 到同一个文本节点
 *    （`Text.appendData`，O(1) 摊销，不解析、不重建 DOM），并按 `intervalMs`
 *    合并刷新，避免每个 delta 都触发布局；
 * 2. 收尾（`finalize`）：一次性渲染 Markdown（含公式），只做一次。
 *
 * `markdown-coalesced` 策略用于必须即时呈现 Markdown 结构的场景（如总结/精读
 * 输出窗口，期间还会插入标题等非流式片段）：仍然走 Markdown 渲染，但同样按
 * `intervalMs` 合并，渲染次数从「每 chunk 一次」降到「每 interval 一次」。
 *
 * 所有时间源与调度器都可注入，便于用假时钟做纯逻辑单测（不触碰全局对象，
 * 也不依赖真实 DOM）。
 *
 * @module streamingMarkdownRenderer
 */

export type StreamingMarkdownPolicy =
  "plain-until-final" | "markdown-coalesced";

export type StreamingRenderHost = HTMLElement;

export type StreamingMarkdownRendererOptions = {
  /** 每次需要写入时重新解析宿主，元素被移除时返回 null 即可安全跳过 */
  mount: () => StreamingRenderHost | null;
  /** 流式期固定前缀（例如「AI 助手」标签），只在开始流式时写一次 */
  renderStreamingSeed?: () => string;
  /** 收尾时一次性渲染 Markdown（可含公式），可追加后缀 HTML */
  renderFinal: (markdown: string, suffixHtml?: string) => string;
  /** markdown-coalesced 策略下每次合并刷新的渲染函数 */
  renderCoalesced?: (markdown: string) => string;
  /** 默认 plain-until-final */
  policy?: StreamingMarkdownPolicy;
  /** 两次 DOM 写入的最小间隔，默认 120ms */
  intervalMs?: number;
  /** 不可见时跳过 DOM 写入（内容仍会累积） */
  isVisible?: () => boolean;
  /** 写入可见 DOM 后调用（滚动、公式调度等放这里） */
  onAfterRender?: () => void;
  /** 以下三个用于测试注入 */
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
};

export type StreamingRenderStats = {
  /** 流式期实际写入 DOM 的次数 */
  streamingWrites: number;
  /** 收尾渲染次数（正常为 1） */
  finalRender: number;
  /** 累计收到的 delta 数 */
  pushes: number;
};

const DEFAULT_INTERVAL_MS = 120;

export class StreamingMarkdownRenderer {
  private readonly options: StreamingMarkdownRendererOptions;
  private readonly policy: StreamingMarkdownPolicy;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly schedule: (callback: () => void, delayMs: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  private buffer = "";
  private flushedLength = 0;
  private textNode: Text | null = null;
  private renderedHost: StreamingRenderHost | null = null;
  private scheduledHandle: unknown = null;
  private lastFlushAt = 0;
  private disposed = false;
  private stats: StreamingRenderStats = {
    streamingWrites: 0,
    finalRender: 0,
    pushes: 0,
  };

  constructor(options: StreamingMarkdownRendererOptions) {
    this.options = options;
    this.policy = options.policy ?? "plain-until-final";
    this.intervalMs = Math.max(0, options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.now = options.now ?? (() => Date.now());
    this.schedule =
      options.schedule ??
      ((callback, delayMs) => setTimeout(callback, delayMs) as unknown);
    this.cancel =
      options.cancel ??
      ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.lastFlushAt = this.now() - this.intervalMs;
  }

  /** 已累积但尚未写入 DOM 的字符数 */
  get pendingChars(): number {
    return this.buffer.length - this.flushedLength;
  }

  /** 当前完整缓冲内容 */
  get text(): string {
    return this.buffer;
  }

  get metrics(): StreamingRenderStats {
    return { ...this.stats };
  }

  /**
   * 追加一个流式片段。只做字符串累积 + 合并调度，不做任何渲染。
   */
  push(delta: string): void {
    if (this.disposed || !delta) return;
    this.buffer += delta;
    this.stats.pushes += 1;
    this.scheduleFlush();
  }

  /**
   * 立即把待写入内容落到 DOM（仍不做 Markdown 渲染，plain 策略下只 appendData）。
   * 供 `finishItem()` 之类需要“立刻可见”的时机调用。
   */
  flush(): void {
    if (this.disposed) return;
    this.cancelScheduledFlush();
    this.lastFlushAt = this.now();
    const host = this.options.mount();
    if (!host || !this.isHostVisible(host)) return;

    // A remount (or a rebuilt message body) needs the whole stream again.
    if (
      host !== this.renderedHost ||
      (this.textNode && !host.contains(this.textNode))
    ) {
      this.flushedLength = 0;
      this.textNode = null;
      this.renderedHost = host;
    }
    if (!this.pendingChars) return;

    if (this.policy === "markdown-coalesced") {
      const render = this.options.renderCoalesced ?? this.options.renderFinal;
      host.innerHTML = render(this.buffer);
    } else {
      this.textNode ??= this.createPreview(host);
      if (!this.textNode) return;
      this.textNode.appendData(this.buffer.slice(this.flushedLength));
    }

    this.flushedLength = this.buffer.length;
    this.stats.streamingWrites += 1;
    this.options.onAfterRender?.();
  }

  /**
   * 收尾：一次性渲染完整 Markdown（含公式），并释放渲染器。
   * 重复调用无副作用。
   */
  finalize(markdown?: string, suffixHtml = ""): void {
    if (this.disposed) return;
    this.dispose();
    if (typeof markdown === "string") this.buffer = markdown;
    const host = this.options.mount();
    if (!host) return;
    // Retained panels must already contain the final answer when shown again.
    const visible = this.isHostVisible(host);
    host.innerHTML = this.options.renderFinal(this.buffer, suffixHtml);
    this.flushedLength = this.buffer.length;
    this.stats.finalRender += 1;
    if (visible) this.options.onAfterRender?.();
  }

  /** 取消挂起的刷新并释放，不再写 DOM */
  dispose(): void {
    if (this.disposed) return;
    this.cancelScheduledFlush();
    this.textNode = null;
    this.renderedHost = null;
    this.disposed = true;
  }

  private scheduleFlush(): void {
    if (this.scheduledHandle !== null || this.disposed) return;
    const elapsed = this.now() - this.lastFlushAt;
    const delay = elapsed >= this.intervalMs ? 0 : this.intervalMs - elapsed;
    this.scheduledHandle = this.schedule(() => {
      this.scheduledHandle = null;
      this.flush();
    }, delay);
  }

  private cancelScheduledFlush(): void {
    if (this.scheduledHandle === null) return;
    this.cancel(this.scheduledHandle);
    this.scheduledHandle = null;
  }

  /**
   * 首次写入时把宿主重置为「固定前缀 + 单个文本节点」，
   * 之后每个 delta 只需 appendData，避免重建 DOM。
   */
  private createPreview(host: StreamingRenderHost): Text | null {
    const doc = host.ownerDocument;
    if (!doc) return null;
    host.innerHTML = this.options.renderStreamingSeed?.() ?? "";
    const preview = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    ) as HTMLSpanElement;
    preview.style.whiteSpace = "pre-wrap";
    const text = doc.createTextNode("");
    preview.appendChild(text);
    host.appendChild(preview);
    return text;
  }

  private isHostVisible(host: StreamingRenderHost): boolean {
    return (
      host.isConnected &&
      (this.options.isVisible?.() ?? host.getClientRects().length > 0)
    );
  }
}
