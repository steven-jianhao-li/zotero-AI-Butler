import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { URL } from "node:url";
import vm from "node:vm";
import { transformSync } from "esbuild";

const { Event, EventTarget } = globalThis;

function loadSource(name, imports, globals = {}, inspection = "") {
  const module = { exports: {} };
  const source = readFileSync(
    new URL(`../src/${name}`, import.meta.url),
    "utf8",
  );
  const compiled = transformSync(source + inspection, {
    loader: "ts",
    format: "cjs",
    target: "es2018",
  });
  vm.runInNewContext(compiled.code, {
    module,
    exports: module.exports,
    require: (specifier) => imports[specifier] || {},
    ...globals,
  });
  return module.exports;
}

function tutorialHost() {
  const timers = new Map();
  let timerId = 0;
  const navigationListeners = new Set();
  class HostNode extends EventTarget {
    constructor(doc) {
      super();
      this.ownerDocument = doc;
      this.style = {};
      this.children = [];
      this.attributes = new Map();
      this.isConnected = false;
    }
    appendChild(child) {
      this.children.push(child);
      child.parentElement = this;
      child.isConnected = true;
      return child;
    }
    append(...children) {
      children.forEach((child) => this.appendChild(child));
    }
    remove() {
      this.isConnected = false;
      if (this.parentElement)
        this.parentElement.children = this.parentElement.children.filter(
          (child) => child !== this,
        );
    }
    contains(node) {
      return (
        this === node || this.children.some((child) => child.contains(node))
      );
    }
    setAttribute(name, value) {
      this.attributes.set(name, value);
    }
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }
    getClientRects() {
      return this.hidden ? [] : [this.getBoundingClientRect()];
    }
    getBoundingClientRect() {
      return {
        left: 10,
        top: 10,
        right: 210,
        bottom: 50,
        width: 200,
        height: 40,
      };
    }
    scrollIntoView() {}
  }
  function createWindow() {
    const win = new EventTarget();
    const doc = new EventTarget();
    doc.defaultView = win;
    doc.elements = new Map();
    doc.createElementNS = () => new HostNode(doc);
    doc.documentElement = new HostNode(doc);
    doc.querySelector = (selector) =>
      doc.elements.get(selector.slice(1)) || null;
    doc.getElementById = (id) => doc.elements.get(id) || null;
    win.document = doc;
    win.Node = HostNode;
    win.innerWidth = 1000;
    win.innerHeight = 800;
    win.DOMRect = class {
      constructor(left, top, width, height) {
        Object.assign(this, {
          left,
          top,
          width,
          height,
          right: left + width,
          bottom: top + height,
        });
      }
    };
    win.setTimeout = (callback) => {
      timers.set(++timerId, callback);
      return timerId;
    };
    win.clearTimeout = (id) => timers.delete(id);
    return win;
  }
  const main = createWindow();
  const dashboard = createWindow();
  let dialogWindow = null;
  const mainWindow = {
    getDialogWindow: () => dialogWindow,
    onNavigationChange: (listener) => {
      navigationListeners.add(listener);
      return () => navigationListeners.delete(listener);
    },
  };
  const inspection = `
    let renderedCards = 0;
    renderCard = () => { renderedCards++; }; renderSpotlight = () => {}; renderFullMask = () => {}; renderStepCelebration = () => {};
    export const inspection = {
      enterDeepRead() { activeTour.index = activeTour.steps.findIndex(step => step.id === "deep-read-tasks"); renderActiveStep(); },
      current: () => activeTour, render: renderActiveStep, next: goNext, previous: goPrev, renders: () => renderedCards,
    };
  `;
  const tour = loadSource(
    "modules/onboardingOverlayTour.ts",
    {
      "./views/MainWindow": { MainWindow: { getInstance: () => mainWindow } },
      "../utils/locale": { getString: (key) => key },
    },
    {
      Zotero: { getMainWindow: () => main },
      ztoolkit: { log() {} },
      setTimeout: main.setTimeout,
      clearTimeout: main.clearTimeout,
      Node: class SandboxNode {},
    },
    inspection,
  );
  function showDashboard() {
    dialogWindow = dashboard;
    for (const listener of [...navigationListeners]) listener();
  }
  function addTarget(id) {
    const target = new HostNode(dashboard.document);
    dashboard.document.elements.set(id, target);
    return target;
  }
  async function flushTimers() {
    for (let turn = 0; turn < 10 && timers.size; turn++) {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((callback) => callback());
    }
    await Promise.resolve();
  }
  return {
    tour,
    main,
    dashboard,
    timers,
    navigationListeners,
    showDashboard,
    addTarget,
    flushTimers,
    closeDashboard() {
      dialogWindow = null;
      for (const listener of [...navigationListeners]) listener();
    },
  };
}

async function enterDeepRead(host) {
  await host.tour.startOnboardingOverlayTour("startup", { onComplete() {} });
  host.tour.inspection.enterDeepRead();
}

function selectionHost() {
  const regular = (id, attachments) => ({
    id,
    isRegularItem: () => true,
    isAttachment: () => false,
    isNote: () => false,
    getAttachments: () => attachments,
  });
  const first = regular(1, [11]);
  const second = regular(2, [21]);
  const withoutPdf = regular(3, []);
  const pdf = {
    id: 11,
    parentID: 1,
    isAttachment: () => true,
    attachmentMIMEType: "application/pdf",
  };
  const otherPdf = { ...pdf, id: 21, parentID: 2 };
  const note = { id: 12, parentID: 1, isNote: () => true };
  const html = { ...pdf, id: 13, attachmentMIMEType: "text/html" };
  const items = new Map(
    [first, second, withoutPdf, pdf, otherPdf, note, html].map((item) => [
      item.id,
      item,
    ]),
  );
  let selected = [first];
  let onRead = () => {};
  const queued = [];
  const tasks = new Map();
  const queue = {
    refreshFromStorage() {},
    getTask: (id) => tasks.get(id),
    getAllTasks: () => [...tasks.values()],
    async addTask(item) {
      queued.push(item.id);
      return `task-${item.id}`;
    },
  };
  const { inspection } = loadSource(
    "modules/onboardingOverlayTour.ts",
    {
      "./taskQueue": {
        getSummaryTaskId: (id) => `task-${id}`,
        TaskQueueManager: { getInstance: () => queue },
      },
      "../utils/locale": { getString: (key) => key },
    },
    {
      Zotero: {
        getActiveZoteroPane: () => ({ getSelectedItems: () => selected }),
        Items: {
          async getAsync(id) {
            await onRead(id);
            return items.get(id);
          },
        },
      },
      ztoolkit: { log() {} },
    },
    `
      renderActiveStep = () => {};
      export const inspection = {
        setState: state => { activeTour = state; },
        poll: pollImportTracking, notify: handleImportItemNotify,
        submit: queueTrackedSummary, refresh: refreshTrackedTaskFromQueue,
      };
    `,
  );
  const state = {
    index: 0,
    steps: [{ id: "paper-area-drop" }, { id: "summary-task-progress" }],
    trackedItemId: null,
    trackedSummaryTaskId: null,
    importStartedAt: Date.now(),
  };
  inspection.setState(state);
  return {
    inspection,
    state,
    queued,
    tasks,
    first,
    second,
    withoutPdf,
    pdf,
    note,
    html,
    select: (...items) => (selected = items),
    onRead: (callback) => (onRead = callback),
  };
}

test("explicit tutorial consent queues the currently selected PDF parent", async () => {
  const host = selectionHost();
  await host.inspection.poll(host.state);
  host.select(host.second);
  await host.inspection.submit();
  assert.deepEqual(host.queued, [2]);
  assert.equal(host.state.trackedItemId, 2);
  assert.equal(host.state.trackedSummaryTaskId, "task-2");
});

test("selecting a PDF child queues its regular parent", async () => {
  const host = selectionHost();
  host.select(host.pdf);
  await host.inspection.submit();
  assert.deepEqual(host.queued, [1]);
});

test("tutorial consent reuses an existing summary task", async () => {
  const host = selectionHost();
  host.tasks.set("task-1", { id: "task-1", itemId: 1, createdAt: new Date() });
  await host.inspection.submit();
  assert.deepEqual(host.queued, []);
  assert.equal(host.state.trackedSummaryTaskId, "task-1");
});

for (const selection of ["withoutPdf", "note", "html", "empty"]) {
  test(`tutorial selection ${selection} clears the previous PDF instead of submitting it`, async () => {
    const host = selectionHost();
    await host.inspection.poll(host.state);
    assert.equal(host.state.trackedItemId, 1);
    host.tasks.set("task-1", {
      id: "task-1",
      itemId: 1,
      createdAt: new Date(),
    });
    host.select(...(selection === "empty" ? [] : [host[selection]]));
    await host.inspection.poll(host.state);
    await host.inspection.notify(host.state, [host.pdf.id]);
    host.inspection.refresh(host.state);
    assert.equal(host.state.trackedItemId, null);
    assert.equal(host.state.trackedSummaryTaskId, null);
    await assert.rejects(host.inspection.submit, /onboarding-action-wait-pdf/);
    assert.deepEqual(host.queued, []);
  });
}

test("a selection change during PDF lookup cannot enqueue the old selection", async () => {
  const host = selectionHost();
  await host.inspection.poll(host.state);
  host.onRead((id) => {
    if (id === host.pdf.id) host.select(host.withoutPdf);
  });
  await assert.rejects(host.inspection.submit, /onboarding-action-wait-pdf/);
  assert.deepEqual(host.queued, []);
  assert.equal(host.state.trackedItemId, null);
});

test("leaving the import step during PDF lookup cancels tutorial enqueueing", async () => {
  const host = selectionHost();
  host.onRead(() => {
    host.state.index = 1;
  });
  await assert.rejects(host.inspection.submit, /onboarding-action-wait-pdf/);
  assert.deepEqual(host.queued, []);
});

test("a submitted summary remains tracked after library selection changes", async () => {
  const host = selectionHost();
  await host.inspection.submit();
  host.state.index = 1;
  host.select(host.second);
  await host.inspection.poll(host.state);
  await host.inspection.notify(host.state, [host.second.id]);
  assert.equal(host.state.trackedItemId, 1);
  assert.equal(host.state.trackedSummaryTaskId, "task-1");
  assert.deepEqual(host.queued, [1]);
});

test("import notifications detect a newly attached PDF on the selected item", async () => {
  const host = selectionHost();
  host.select(host.withoutPdf);
  await host.inspection.poll(host.state);
  assert.equal(host.state.trackedItemId, null);
  host.withoutPdf.getAttachments().push(host.pdf.id);
  host.pdf.parentID = host.withoutPdf.id;
  await host.inspection.notify(host.state, [host.pdf.id]);
  assert.equal(host.state.trackedItemId, host.withoutPdf.id);
  await host.inspection.submit();
  assert.deepEqual(host.queued, [host.withoutPdf.id]);
});

test("late dashboard readiness migrates the deep-reading tutorial without another library event", async () => {
  const host = tutorialHost();
  await enterDeepRead(host);
  assert.equal(host.tour.inspection.current().win, host.main);
  host.addTarget("tab-tasks");
  host.showDashboard();
  assert.equal(host.tour.inspection.current().win, host.dashboard);
  host.tour.closeOnboardingOverlayTour();
  assert.equal(host.navigationListeners.size, 0);
});

test("an already selected visible task queue satisfies the navigation step", async () => {
  const host = tutorialHost();
  const target = host.addTarget("tab-tasks");
  target.setAttribute("aria-current", "page");
  host.addTarget("ai-butler-task-queue-view");
  host.showDashboard();
  await enterDeepRead(host);
  await host.flushTimers();
  const state = host.tour.inspection.current();
  assert.equal(state.steps[state.index].id, "deep-read-explain");
  host.tour.closeOnboardingOverlayTour();
});

test("an unrelated tab or hidden queue does not satisfy the navigation step", async () => {
  const host = tutorialHost();
  const target = host.addTarget("tab-tasks");
  const queue = host.addTarget("ai-butler-task-queue-view");
  host.showDashboard();
  await enterDeepRead(host);
  await host.flushTimers();
  let state = host.tour.inspection.current();
  assert.equal(state.steps[state.index].id, "deep-read-tasks");
  target.setAttribute("aria-current", "page");
  queue.hidden = true;
  host.tour.inspection.render();
  await host.flushTimers();
  state = host.tour.inspection.current();
  assert.equal(state.steps[state.index].id, "deep-read-tasks");
  host.tour.closeOnboardingOverlayTour();
});

test("queue clicks from the dashboard realm advance once", async () => {
  const host = tutorialHost();
  const target = host.addTarget("tab-tasks");
  host.addTarget("ai-butler-task-queue-view");
  host.showDashboard();
  await enterDeepRead(host);
  target.dispatchEvent(new Event("click"));
  target.dispatchEvent(new Event("command"));
  target.setAttribute("aria-current", "page");
  assert.equal(host.timers.size, 1);
  await host.flushTimers();
  const state = host.tour.inspection.current();
  assert.equal(state.steps[state.index].id, "deep-read-explain");
  host.tour.closeOnboardingOverlayTour();
});

test("unrelated dashboard navigation leaves a library tutorial card untouched", async () => {
  const host = tutorialHost();
  await enterDeepRead(host);
  host.tour.inspection.previous();
  const before = host.tour.inspection.renders();
  host.showDashboard();
  assert.equal(host.tour.inspection.renders(), before);
  host.tour.closeOnboardingOverlayTour();
});

test("leaving the selected queue before its scheduled advance keeps the tutorial on navigation", async () => {
  const host = tutorialHost();
  const target = host.addTarget("tab-tasks");
  host.addTarget("ai-butler-task-queue-view");
  target.setAttribute("aria-current", "page");
  host.showDashboard();
  await enterDeepRead(host);
  target.setAttribute("aria-current", "false");
  await host.flushTimers();
  const state = host.tour.inspection.current();
  assert.equal(state.steps[state.index].id, "deep-read-tasks");
  host.tour.closeOnboardingOverlayTour();
});

test("closing or leaving a step cancels pending advancement across a restart", async () => {
  const host = tutorialHost();
  const target = host.addTarget("tab-tasks");
  host.showDashboard();
  await enterDeepRead(host);
  target.dispatchEvent(new Event("click"));
  host.tour.inspection.previous();
  assert.equal(host.timers.size, 0);
  host.tour.inspection.enterDeepRead();
  target.dispatchEvent(new Event("click"));
  host.tour.closeOnboardingOverlayTour();
  assert.equal(host.timers.size, 0);
  assert.equal(host.navigationListeners.size, 0);
  await enterDeepRead(host);
  await host.flushTimers();
  const state = host.tour.inspection.current();
  assert.equal(state.steps[state.index].id, "deep-read-tasks");
  host.tour.closeOnboardingOverlayTour();
});

test("closing and reopening the dashboard rebinds the tutorial without stale target listeners", async () => {
  const host = tutorialHost();
  const target = host.addTarget("tab-tasks");
  host.showDashboard();
  await enterDeepRead(host);
  host.closeDashboard();
  assert.equal(host.tour.inspection.current().win, host.main);
  target.dispatchEvent(new Event("click"));
  assert.equal(host.timers.size, 0);
  host.showDashboard();
  assert.equal(host.tour.inspection.current().win, host.dashboard);
  host.tour.closeOnboardingOverlayTour();
});

test("dashboard navigation notifications isolate subscribers and unsubscribe completely", () => {
  const failures = [];
  const emptyView = class {
    setQueueButtonHandler() {}
    destroy() {}
    hide() {}
    show() {}
  };
  const imports = { "../../utils/locale": { getString: (key) => key } };
  for (const name of [
    "DashboardView",
    "SummaryView",
    "AgentView",
    "TaskQueueView",
    "SettingsView",
    "LibraryScannerView",
    "LiteratureReviewView",
  ]) {
    imports[name === "AgentView" ? "./agent/AgentView" : `./${name}`] = {
      [name]: emptyView,
    };
  }
  const { MainWindow } = loadSource("modules/views/MainWindow.ts", imports, {
    ztoolkit: { log: (...args) => failures.push(args) },
  });
  const dashboard = MainWindow.getInstance();
  let calls = 0;
  const removeFailure = dashboard.onNavigationChange(() => {
    throw new Error("subscriber failure");
  });
  const removeCounter = dashboard.onNavigationChange(() => {
    calls++;
  });
  dashboard.uiInitialized = true;
  dashboard.switchTab("tasks");
  assert.equal(calls, 1);
  assert.equal(failures.length, 1);
  removeFailure();
  removeCounter();
  dashboard.switchTab("summary");
  assert.equal(calls, 1);
  const removeClosed = dashboard.onNavigationChange(() => {
    assert.equal(dashboard.getDialogWindow(), null);
    calls++;
  });
  dashboard.onUnload();
  assert.equal(calls, 2);
  removeClosed();
  assert.equal(dashboard.navigationListeners.size, 0);
});

test("the final automatic deep-reading explanation reveals its setting once", async () => {
  const host = tutorialHost();
  const target = host.addTarget("ui-setting-auto-scan-deep-read");
  let reveals = 0;
  target.scrollIntoView = () => reveals++;
  host.showDashboard();
  await enterDeepRead(host);
  const state = host.tour.inspection.current();
  state.index = state.steps.findIndex(
    (step) => step.id === "final-auto-deepread-setting",
  );
  host.tour.inspection.render();
  assert.equal(reveals, 1);
  host.tour.inspection.render();
  assert.equal(reveals, 1);
  assert.equal(host.timers.size, 0);
  await host.flushTimers();
  assert.equal(state.steps[state.index].id, "final-auto-deepread-setting");
  host.tour.inspection.next();
  host.tour.inspection.previous();
  assert.equal(reveals, 2);
  host.tour.closeOnboardingOverlayTour();
});

test("dashboard defaults provide more setting space while respecting the available screen", () => {
  const emptyView = class {
    setQueueButtonHandler() {}
  };
  const imports = { "../../utils/locale": { getString: (key) => key } };
  for (const name of [
    "DashboardView",
    "SummaryView",
    "AgentView",
    "TaskQueueView",
    "SettingsView",
    "LibraryScannerView",
    "LiteratureReviewView",
  ]) {
    imports[name === "AgentView" ? "./agent/AgentView" : `./${name}`] = {
      [name]: emptyView,
    };
  }
  for (const [screen, expected] of [
    [{ availWidth: 1920, availHeight: 1040 }, [1100, 800]],
    [{ availWidth: 1440, availHeight: 900 }, [1100, 772]],
    [{ availWidth: 1366, availHeight: 768 }, [1100, 640]],
    [{ availWidth: 1024, availHeight: 768 }, [928, 640]],
    [{ availWidth: 600, availHeight: 400 }, [600, 400]],
    [
      { availWidth: NaN, availHeight: -1, width: 1366, height: 768 },
      [1100, 640],
    ],
    [{ availWidth: Infinity, availHeight: 0 }, [1100, 672]],
    [null, [1100, 672]],
  ]) {
    const { MainWindow } = loadSource("modules/views/MainWindow.ts", imports, {
      Zotero: { getMainWindow: () => (screen ? { screen } : null) },
    });
    const size = MainWindow.getInstance().getAdaptiveDialogSize();
    assert.deepEqual([size.width, size.height], expected);
  }
});
