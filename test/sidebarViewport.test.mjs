import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { URL } from "node:url";
import vm from "node:vm";
import { transformSync } from "esbuild";

const source = readFileSync(
  new URL("../src/modules/ItemPaneSection.ts", import.meta.url),
  "utf8",
);
const compiled = transformSync(
  `${source}\nexport { fitSidebarShellToViewport, canElementScrollVertically, bindSidebarWorkspaceLayout };`,
  { loader: "ts", format: "cjs", target: "es2018" },
);
const module = { exports: {} };
vm.runInNewContext(compiled.code, {
  module,
  exports: module.exports,
  require: () => ({}),
});
const {
  fitSidebarShellToViewport,
  canElementScrollVertically,
  bindSidebarWorkspaceLayout,
} = module.exports;

function sidebarViewport(ownHeight, topHeight, offset = 0) {
  const view = { innerHeight: ownHeight, top: { innerHeight: topHeight } };
  const body = {
    ownerDocument: { defaultView: view },
    style: {},
    getBoundingClientRect: () => ({ top: offset }),
  };
  const shell = { style: {} };
  return { body, shell, view };
}

test("sidebar height stays inside its iframe instead of the taller host window", () => {
  const { body, shell } = sidebarViewport(480, 1000);
  fitSidebarShellToViewport(body, shell);
  assert.equal(shell.style.height, "472px");
  assert.ok(Number.parseFloat(body.style.minHeight) <= 472);
});

test("short sidebars do not retain a 320px minimum below the visible pane", () => {
  const { body, shell } = sidebarViewport(180, 700);
  fitSidebarShellToViewport(body, shell);
  assert.equal(shell.style.height, "172px");
  assert.ok(Number.parseFloat(shell.style.minHeight) <= 172);
});

test("top-level section sizing subtracts its own document offset", () => {
  const { body, shell } = sidebarViewport(800, 800, 120);
  fitSidebarShellToViewport(body, shell);
  assert.equal(shell.style.height, "672px");
});

test("resizing replaces the old sidebar minimum height", () => {
  const { body, shell, view } = sidebarViewport(700, 1000);
  fitSidebarShellToViewport(body, shell);
  view.innerHeight = 240;
  fitSidebarShellToViewport(body, shell);
  assert.equal(body.style.height, "232px");
  assert.ok(Number.parseFloat(shell.style.minHeight) <= 232);
});

test("a temporarily hidden iframe never grows to its host's height", () => {
  const { body, shell } = sidebarViewport(0, 900);
  fitSidebarShellToViewport(body, shell);
  assert.equal(shell.style.height, "0px");
});

function layoutEventTarget() {
  const listeners = [];
  return {
    listeners,
    addEventListener(type, callback, options) {
      listeners.push({
        type,
        callback,
        capture: !!(options?.capture || options === true),
      });
    },
    removeEventListener(type, callback, options) {
      const capture = !!(options?.capture || options === true);
      const index = listeners.findIndex(
        (listener) =>
          listener.type === type &&
          listener.callback === callback &&
          listener.capture === capture,
      );
      if (index >= 0) listeners.splice(index, 1);
    },
    emit(type, target = this) {
      for (const listener of [...listeners]) {
        // Element scroll events do not bubble to the document.
        if (listener.type === type && (target === this || listener.capture)) {
          listener.callback({ type, target });
        }
      }
    },
  };
}

function sidebarLayout({ observers = true } = {}) {
  const { body, shell, view } = sidebarViewport(1392, 1600, 1500);
  const doc = body.ownerDocument;
  Object.assign(doc, layoutEventTarget());
  Object.assign(view, layoutEventTarget());
  Object.assign(view.top, layoutEventTarget());
  const pending = new Map();
  let nextId = 0;
  const schedule = (callback) => {
    const id = ++nextId;
    pending.set(id, callback);
    return id;
  };
  view.setTimeout = schedule;
  view.clearTimeout = (id) => pending.delete(id);
  view.requestAnimationFrame = () => {
    throw new Error(
      "Layout must not wait for an animation frame from the host",
    );
  };
  const observed = {};
  if (observers) {
    for (const name of ["ResizeObserver", "IntersectionObserver"]) {
      view[name] = class {
        targets = [];
        disconnected = false;
        constructor(callback) {
          this.notify = callback;
          observed[name] = this;
        }
        observe(target) {
          this.targets.push(target);
        }
        disconnect() {
          this.disconnected = true;
        }
      };
    }
  }
  body.isConnected = true;
  body.parentElement = { contains: (node) => node === body };
  let layouts = 0;
  const dispose = bindSidebarWorkspaceLayout(body, {}, () => {
    layouts++;
    fitSidebarShellToViewport(body, shell);
  });
  const flush = () => {
    const callbacks = [...pending.values()];
    pending.clear();
    for (const callback of callbacks) callback();
  };
  flush();
  return {
    body,
    shell,
    view,
    doc,
    pending,
    observed,
    dispose,
    flush,
    layouts: () => layouts,
    reveal: () => {
      body.getBoundingClientRect = () => ({ top: 184.3 });
    },
  };
}

for (const scrollDocument of [false, true]) {
  test(`a zero-height sidebar recovers after ${scrollDocument ? "document" : "ancestor"} scrolling without resize (#440)`, () => {
    const fixture = sidebarLayout();
    const { body, shell, doc, reveal, flush } = fixture;
    assert.equal(shell.style.height, "0px");
    reveal();
    doc.emit("scroll", scrollDocument ? doc : body.parentElement);
    flush();
    assert.equal(body.style.height, "1199px");
    assert.equal(shell.style.height, "1199px");
    fixture.dispose();
  });
}

test("a section entering the viewport after a layout shift recovers without a scroll (#440)", () => {
  const { shell, observed, reveal, flush, dispose } = sidebarLayout();
  assert.equal(shell.style.height, "0px");
  reveal();
  assert.ok(
    observed.IntersectionObserver,
    "section visibility must be observed",
  );
  observed.IntersectionObserver.notify([{ isIntersecting: true }]);
  flush();
  assert.equal(shell.style.height, "1199px");
  dispose();
});

test("scroll and resize bursts are coalesced into one deferred layout", () => {
  const {
    body,
    shell,
    view,
    doc,
    observed,
    pending,
    layouts,
    reveal,
    flush,
    dispose,
  } = sidebarLayout();
  reveal();
  for (let index = 0; index < 5; index++) {
    doc.emit("scroll", body.parentElement);
    view.emit("resize");
    view.top.emit("resize");
    observed.ResizeObserver.notify();
  }
  assert.equal(layouts(), 1);
  assert.equal(pending.size, 1);
  flush();
  assert.equal(layouts(), 2);
  assert.equal(shell.style.height, "1199px");
  dispose();
});

test("scrolling note content or unrelated panes does not schedule sidebar layout", () => {
  const { doc, pending, dispose } = sidebarLayout();
  doc.emit("scroll", { contains: () => false });
  assert.equal(pending.size, 0);
  dispose();
});

test("disposing a sidebar cancels pending layout and disconnects all listeners", () => {
  const { body, shell, view, doc, observed, pending, reveal, flush, dispose } =
    sidebarLayout();
  reveal();
  doc.emit("scroll", body.parentElement);
  dispose();
  assert.equal(pending.size, 0);
  assert.equal(
    doc.listeners.length + view.listeners.length + view.top.listeners.length,
    0,
  );
  for (const observer of Object.values(observed)) {
    assert.equal(observer.disconnected, true);
    // An already queued observer delivery must not revive the old layout.
    observer.notify([{ isIntersecting: true }]);
  }
  flush();
  assert.equal(shell.style.height, "0px");
});

test("a queued layout does not measure a detached sidebar", () => {
  const { body, view, layouts, flush, dispose } = sidebarLayout();
  body.isConnected = false;
  view.emit("resize");
  flush();
  assert.equal(layouts(), 1);
  dispose();
});

test("scroll recovery still works on hosts without observer constructors", () => {
  const { body, shell, doc, reveal, flush, dispose } = sidebarLayout({
    observers: false,
  });
  reveal();
  doc.emit("scroll", body.parentElement);
  flush();
  assert.equal(shell.style.height, "1199px");
  dispose();
});

function overflowingElement(overflowY, scrollTop = 0) {
  return {
    scrollHeight: 600,
    clientHeight: 200,
    scrollTop,
    ownerDocument: {
      defaultView: { getComputedStyle: () => ({ overflowY }) },
    },
  };
}

test("clipped content is not mistaken for a native wheel scroller", () => {
  assert.equal(
    canElementScrollVertically(overflowingElement("hidden"), 120),
    false,
  );
  assert.equal(
    canElementScrollVertically(overflowingElement("visible"), 120),
    false,
  );
});

test("native scrolling is allowed only while the scroller can move in that direction", () => {
  assert.equal(
    canElementScrollVertically(overflowingElement("auto"), 120),
    true,
  );
  assert.equal(
    canElementScrollVertically(overflowingElement("scroll", 200), -120),
    true,
  );
  assert.equal(
    canElementScrollVertically(overflowingElement("auto", 400), 120),
    false,
  );
  assert.equal(
    canElementScrollVertically(overflowingElement("auto"), -120),
    false,
  );
});
