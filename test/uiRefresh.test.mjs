import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { URL } from "node:url";
import vm from "node:vm";
import { transformSync } from "esbuild";

function loadSource(path, imports, globals = {}, extra = "") {
  const source = readFileSync(
    new URL(`../src/${path}`, import.meta.url),
    "utf8",
  );
  const module = { exports: {} };
  vm.runInNewContext(
    transformSync(source + extra, {
      loader: "ts",
      format: "cjs",
      target: "es2018",
    }).code,
    {
      module,
      exports: module.exports,
      require: (name) => imports[name] || {},
      ztoolkit: { log() {} },
      ...globals,
    },
  );
  return module.exports;
}

function summaryFixture() {
  let autoScroll = true;
  const pending = [];
  const { SummaryView } = loadSource(
    "modules/views/SummaryView.ts",
    {
      "./BaseView": { BaseView: class {} },
      "../../utils/prefs": { getPref: () => autoScroll },
    },
    { setTimeout: (callback) => pending.push(callback) },
  );
  const view = new SummaryView();
  const area = { scrollTop: 40, scrollHeight: 900 };
  view.scrollArea = area;
  return {
    view,
    area,
    pending,
    setAutoScroll: (value) => {
      autoScroll = value;
    },
  };
}

test("an open summary view reads auto-scroll changes without remounting (#398)", () => {
  const { view, area, pending, setAutoScroll } = summaryFixture();
  setAutoScroll(false);
  view.scrollToBottom();
  assert.equal(pending.length, 0);
  assert.equal(area.scrollTop, 40);
  setAutoScroll(true);
  view.scrollToBottom();
  pending.shift()();
  assert.equal(area.scrollTop, 900);
});

test("queued scrolling respects a later preference change or manual scroll", () => {
  for (const cancel of [
    ({ setAutoScroll }) => setAutoScroll(false),
    ({ view }) => {
      view.userHasScrolled = true;
    },
    ({ view }) => {
      view.scrollArea = null;
    },
  ]) {
    const fixture = summaryFixture();
    fixture.view.scrollToBottom();
    cancel(fixture);
    fixture.pending.shift()();
    assert.equal(fixture.area.scrollTop, 40);
  }
});

function statusFixture(selectedNote) {
  const pane = {
    getSelectedItems: () => [{ isNote: () => selectedNote }],
    itemsView: { _rowCache: { 1: "stale", 2: "keep" } },
  };
  const notifications = [];
  let columnRefreshes = 0;
  const status = loadSource(
    "modules/libraryStatusColumn.ts",
    {},
    {
      setTimeout: () => 1,
      Zotero: {
        getZoteroPanes: () => [pane],
        ItemTreeManager: {
          refreshColumns: () => {
            columnRefreshes++;
          },
        },
        Notifier: {
          trigger: async (...args) => {
            notifications.push(args);
            assert.equal(pane.itemsView._rowCache[1], undefined);
          },
        },
      },
    },
    "\nexport { scheduleItemRefresh, scheduleRefreshAll, flushRefresh };",
  );
  return {
    status,
    pane,
    notifications,
    columnRefreshes: () => columnRefreshes,
  };
}

for (const selectedNote of [true, false]) {
  test(`status redraw preserves selection with a ${selectedNote ? "note" : "paper"} selected (#398)`, async () => {
    const { status, pane, notifications, columnRefreshes } =
      statusFixture(selectedNote);
    status.scheduleItemRefresh(1);
    status.scheduleItemRefresh(1);
    await status.flushRefresh();
    assert.equal(columnRefreshes(), 0);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0][0], "redraw");
    assert.deepEqual(Array.from(notifications[0][2]), [1]);
    assert.equal(pane.itemsView._rowCache[2], "keep");
    await status.flushRefresh();
    assert.equal(notifications.length, 1);
  });
}

test("tag-wide status updates redraw rows without rebuilding columns", async () => {
  const { status, pane, notifications, columnRefreshes } = statusFixture(true);
  status.scheduleRefreshAll();
  await status.flushRefresh();
  assert.equal(columnRefreshes(), 0);
  assert.equal(Object.keys(pane.itemsView._rowCache).length, 0);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0][2].length, 0);
});

function sidebarFixture(editing, chatting = false) {
  const sidebar = loadSource(
    "modules/ItemPaneSection.ts",
    {},
    {},
    `
export { renderItemPaneSection };
export function setFixture(body, item) {
  sidebarRenderContext = { body, item, itemId: item.id, handleOpenAIChat: async () => {} };
  sidebarNoteEditState = ${editing ? "{ itemId: item.id }" : "null"};
  currentChatState.itemId = item.id;
  currentChatState.isChatting = ${chatting};
}`,
  );
  // A destructive render clears innerHTML before looking for the document.
  const body = {
    innerHTML: "unsaved draft",
    get childNodes() {
      return this.innerHTML ? [{}] : [];
    },
    querySelector: () => null,
  };
  const item = { id: 42, isRegularItem: () => true };
  sidebar.setFixture(body, item);
  return { sidebar, body, item };
}

test("host re-renders preserve an active sidebar editor and chat", () => {
  for (const [editing, chatting] of [
    [true, false],
    [false, true],
  ]) {
    const { sidebar, body, item } = sidebarFixture(editing, chatting);
    sidebar.renderItemPaneSection(body, item, async () => {});
    assert.equal(body.innerHTML, "unsaved draft");
  }
});

test("host re-renders preserve quick chat while persisted history is loading (#428)", () => {
  const { sidebar, body, item } = sidebarFixture(false);
  body.querySelector = (selector) =>
    selector === "#ai-butler-inline-chat" ? {} : null;
  sidebar.renderItemPaneSection(body, item, async () => {});
  assert.equal(body.innerHTML, "unsaved draft");
});

test("host re-renders preserve an unsent question before any reply (#428)", () => {
  const { sidebar, body, item } = sidebarFixture(false);
  body.querySelector = (selector) =>
    selector === "#ai-butler-inline-chat textarea"
      ? { value: "unfinished question" }
      : null;
  sidebar.renderItemPaneSection(body, item, async () => {});
  assert.equal(body.innerHTML, "unsaved draft");
});

test("switching papers still replaces the previous sidebar", () => {
  const { sidebar, body, item } = sidebarFixture(true);
  sidebar.renderItemPaneSection(body, { ...item, id: 43 }, async () => {});
  assert.equal(body.innerHTML, "");
});

test("an explicit refresh can rebuild the chat", () => {
  const { sidebar, body, item } = sidebarFixture(false, true);
  sidebar.renderItemPaneSection(body, item, async () => {}, true);
  assert.equal(body.innerHTML, "");
});
