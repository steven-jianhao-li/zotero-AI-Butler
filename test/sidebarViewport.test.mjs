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
  `${source}\nexport { fitSidebarShellToViewport, canElementScrollVertically };`,
  { loader: "ts", format: "cjs", target: "es2018" },
);
const module = { exports: {} };
vm.runInNewContext(compiled.code, {
  module,
  exports: module.exports,
  require: () => ({}),
});
const { fitSidebarShellToViewport, canElementScrollVertically } =
  module.exports;

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
