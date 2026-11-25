import { expect } from "chai";
import {
  StreamingMarkdownRenderer,
  type StreamingMarkdownRendererOptions,
} from "../src/utils/streamingMarkdownRenderer";

// 纯逻辑测试：注入假时钟与假宿主，不触碰全局 Zotero，也不依赖真实 DOM。
// （在真实 Zotero 进程里替换全局对象会让插件启动/收尾钩子拿到假对象、
// mocha 收不到结束信号，CI 上表现为 test job 挂起。）

function fakeHost() {
  let markup = "";
  const children: any[] = [];
  return {
    get innerHTML() {
      return markup;
    },
    set innerHTML(html: string) {
      children.length = 0;
      markup = html;
    },
    isConnected: true,
    visible: true,
    getClientRects() {
      return this.visible ? [{}] : [];
    },
    children,
    appendChild(node: any) {
      children.push(node);
    },
    contains(node: unknown) {
      return children.some((child) => child === node || child.child === node);
    },
    ownerDocument: {
      createElementNS(namespace: string, tag: string) {
        return {
          namespace,
          tag,
          style: { whiteSpace: "" },
          child: null as unknown,
          appendChild(node: unknown) {
            this.child = node;
          },
        };
      },
      createTextNode(text: string) {
        return {
          data: text,
          writes: 0,
          appendData(chunk: string) {
            this.data += chunk;
            this.writes += 1;
          },
        };
      },
    },
  };
}

type FakeHost = ReturnType<typeof fakeHost>;

function harness(
  overrides: Partial<StreamingMarkdownRendererOptions> = {},
  host: FakeHost = fakeHost(),
) {
  let now = 0;
  const timers: Array<{ at: number; fn: () => void }> = [];
  const renderer = new StreamingMarkdownRenderer({
    mount: () => host as any,
    renderStreamingSeed: () => "<seed/>",
    renderFinal: (markdown, suffix = "") =>
      `<final>${markdown}${suffix}</final>`,
    now: () => now,
    schedule: (callback, delayMs) => {
      const timer = { at: now + delayMs, fn: callback };
      timers.push(timer);
      return timer;
    },
    cancel: (handle) => {
      const index = timers.indexOf(handle as any);
      if (index >= 0) timers.splice(index, 1);
    },
    ...overrides,
  });

  const advance = (ms: number) => {
    now += ms;
    let fired = true;
    while (fired) {
      fired = false;
      for (const timer of [...timers]) {
        if (timer.at <= now) {
          timers.splice(timers.indexOf(timer), 1);
          timer.fn();
          fired = true;
        }
      }
    }
  };

  return { host, renderer, advance, timers, getNow: () => now };
}

describe("streaming markdown renderer", function () {
  it("writes plain text at most once per interval instead of once per delta", function () {
    const { host, renderer, advance } = harness();
    const deltas = 200;

    // 5ms 一个 delta（模拟每 token 一次流式回调），共 1000ms
    for (let index = 0; index < deltas; index += 1) {
      renderer.push("abc");
      advance(5);
    }
    advance(200); // 让尾部刷新落地

    const node = host.children[0].child;
    expect(node.data).to.equal("abc".repeat(deltas));
    // 关键断言：DOM 写入次数与 delta 数无关，只与时长/间隔有关
    expect(renderer.metrics.pushes).to.equal(deltas);
    expect(renderer.metrics.streamingWrites).to.be.at.most(12);
    expect(renderer.metrics.streamingWrites).to.be.greaterThan(0);
    expect(node.writes).to.equal(renderer.metrics.streamingWrites);
    // 流式期只写一次 seed，之后不再重建 DOM
    expect(host.innerHTML).to.equal("<seed/>");
    expect(host.children).to.have.length(1);
  });

  it("preserves newlines and indentation only in the raw chat preview", function () {
    const { host, renderer } = harness();
    const raw = "First line\n\n  <second>";
    renderer.push(raw);
    renderer.flush();

    const preview = host.children[0];
    expect(preview.style.whiteSpace).to.equal("pre-wrap");
    expect(preview.namespace).to.equal("http://www.w3.org/1999/xhtml");
    expect(preview.child.data).to.equal(raw);
    renderer.finalize("final", "<i>stopped</i>");
    expect(host.innerHTML).to.equal("<final>final<i>stopped</i></final>");
    expect(host.children).not.to.include(preview);
  });

  it("replays the buffer when a previously written host is replaced", function () {
    const first = fakeHost();
    let mounted = first;
    const { renderer } = harness({ mount: () => mounted as any });
    renderer.push("first");
    renderer.flush();
    const firstText = first.children[0].child;

    first.isConnected = false;
    renderer.push(" second");
    renderer.flush();
    expect(renderer.metrics.streamingWrites).to.equal(1);

    mounted = fakeHost();
    renderer.flush();
    expect(mounted.children[0].child.data).to.equal("first second");
    expect(firstText.data).to.equal("first");

    mounted.innerHTML = "";
    renderer.flush();
    expect(mounted.children[0].child.data).to.equal("first second");
  });

  it("buffers in a hidden panel and finalizes there even without another delta", function () {
    const { renderer, host, advance } = harness();
    host.visible = false;
    renderer.push("hidden");
    advance(500);
    expect(renderer.metrics.streamingWrites).to.equal(0);
    renderer.finalize();
    expect(host.innerHTML).to.equal("<final>hidden</final>");
  });

  it("does not touch markdown (or katex) while streaming", function () {
    let finalCalls = 0;
    const { renderer, advance } = harness({
      renderFinal: (markdown) => {
        finalCalls += 1;
        return `<final>${markdown}</final>`;
      },
    });

    for (let index = 0; index < 50; index += 1) {
      renderer.push("x");
      advance(10);
    }

    expect(finalCalls).to.equal(0);
    expect(renderer.metrics.finalRender).to.equal(0);
  });

  it("renders the final markdown exactly once and ignores later pushes", function () {
    const { host, renderer, advance } = harness();
    renderer.push("## title\n");
    advance(200);
    renderer.push("body");

    renderer.finalize(undefined, "<i>note</i>");
    expect(host.innerHTML).to.equal("<final>## title\nbody<i>note</i></final>");
    expect(renderer.metrics.finalRender).to.equal(1);

    // 收尾后再推内容 / 再次收尾都不应再写 DOM
    renderer.push("late");
    renderer.finalize();
    expect(renderer.metrics.finalRender).to.equal(1);
    expect(host.innerHTML).to.equal("<final>## title\nbody<i>note</i></final>");
  });

  it("flush() writes pending text immediately for callers that need it", function () {
    const { host, renderer } = harness();
    renderer.push("partial");
    expect(host.children).to.have.length(0);

    renderer.flush();
    expect(host.children[0].child.data).to.equal("partial");
    expect(renderer.pendingChars).to.equal(0);
  });

  it("dispose() cancels the pending flush and stops writing", function () {
    const { host, renderer, advance } = harness();
    renderer.push("abc");
    expect(host.children).to.have.length(0);

    renderer.dispose();
    advance(500);
    expect(host.children).to.have.length(0);
    renderer.push("def");
    advance(500);
    expect(host.children).to.have.length(0);
  });

  it("keeps buffering while the host is invisible and renders on finalize", function () {
    let visible = false;
    const { host, renderer, advance } = harness({
      isVisible: () => visible,
    });

    renderer.push("hidden-text");
    advance(300);
    expect(host.children).to.have.length(0);

    visible = true;
    renderer.finalize();
    expect(host.innerHTML).to.equal("<final>hidden-text</final>");
  });

  it("survives the mount disappearing mid-stream and recovers on the next write", function () {
    let host: FakeHost | null = fakeHost();
    const renderer = new StreamingMarkdownRenderer({
      mount: () => host as any,
      renderFinal: (markdown) => `<final>${markdown}</final>`,
      now: () => 0,
      schedule: () => null,
      cancel: () => undefined,
    });

    renderer.push("abc");
    host = null; // 侧边栏被折叠/元素被移除
    expect(() => renderer.flush()).to.not.throw();

    host = fakeHost();
    renderer.flush();
    const recovered = host as FakeHost;
    expect(recovered.children).to.have.length(1);
    expect(recovered.children[0].child.data).to.equal("abc");

    renderer.finalize();
    expect(recovered.innerHTML).to.equal("<final>abc</final>");
  });

  it("markdown-coalesced policy renders markdown but still at interval rate", function () {
    const rendered: string[] = [];
    const { host, renderer, advance } = harness({
      policy: "markdown-coalesced",
      renderStreamingSeed: undefined,
      renderFinal: (markdown) => `<final>${markdown}</final>`,
      renderCoalesced: (markdown) => {
        rendered.push(markdown);
        return `<md len="${markdown.length}"/>`;
      },
      intervalMs: 120,
    });

    for (let index = 0; index < 100; index += 1) {
      renderer.push("z");
      advance(10);
    }
    advance(200);

    expect(rendered).to.have.length.at.most(12);
    expect(rendered).to.have.length.greaterThan(0);
    expect(host.innerHTML).to.equal('<md len="100"/>');
    expect(rendered[rendered.length - 1]).to.equal("z".repeat(100));
  });

  it("respects a custom interval", function () {
    const { renderer, advance } = harness({ intervalMs: 500 });
    for (let index = 0; index < 100; index += 1) {
      renderer.push("a");
      advance(10);
    }
    advance(600);
    // 1000ms / 500ms ≈ 2 次
    expect(renderer.metrics.streamingWrites).to.be.at.most(3);
  });
});
