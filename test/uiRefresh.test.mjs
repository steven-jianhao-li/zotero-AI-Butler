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
