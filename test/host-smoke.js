/* eslint-disable no-unused-vars -- Entry points are invoked by Zotero's addon loader. */
var hostServices =
  typeof Services === "undefined"
    ? Components.utils.import("resource://gre/modules/Services.jsm").Services
    : Services;
var hostAddons =
  typeof ChromeUtils !== "undefined" && ChromeUtils.importESModule
    ? ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs")
        .AddonManager
    : Components.utils.import("resource://gre/modules/AddonManager.jsm")
        .AddonManager;
var hostFiles =
  typeof IOUtils === "undefined"
    ? Components.utils.import("resource://gre/modules/osfile.jsm").OS.File
    : IOUtils;
var probeTimer;
function install() {}
function uninstall() {}
function shutdown() {}
function startup() {
  probeTimer = Components.classes["@mozilla.org/timer;1"].createInstance(
    Components.interfaces.nsITimer,
  );
  probeTimer.initWithCallback(
    runProbe,
    1500,
    Components.interfaces.nsITimer.TYPE_ONE_SHOT,
  );
}
async function runProbe() {
  var checks = {};
  var errors = [];
  var observer = {
    observe: function (message) {
      errors.push(message.message);
    },
  };
  hostServices.console.registerListener(observer);
  function stage(label) {
    checks.stage = label;
    dump("AI_BUTLER_PROBE: " + label + "\n");
  }
  async function waitForPromise(promise, label) {
    stage(label);
    var completed = false;
    var failure;
    Promise.resolve(promise).then(
      function () {
        completed = true;
      },
      function (error) {
        failure = error;
        completed = true;
      },
    );
    await waitFor(function () {
      return completed;
    }, label);
    if (failure) throw failure;
  }
  async function waitFor(predicate, label) {
    for (var attempt = 0; attempt < 200; attempt++) {
      if (predicate()) return;
      await new Promise(function (resolve) {
        var delay = Components.classes["@mozilla.org/timer;1"].createInstance(
          Components.interfaces.nsITimer,
        );
        delay.initWithCallback(
          resolve,
          100,
          Components.interfaces.nsITimer.TYPE_ONE_SHOT,
        );
      });
    }
    throw new Error("Timed out: " + label);
  }
  function assert(condition, label) {
    if (!condition) throw new Error(label);
    checks[label] = true;
    stage(label);
  }
  try {
    var main;
    await waitFor(function () {
      main = hostServices.wm.getMostRecentWindow("navigator:browser");
      return main && main.Zotero;
    }, "host window");
    var host = main.Zotero;
    await waitForPromise(host.initializationPromise, "host initialization");
    await waitForPromise(host.uiReadyPromise, "host UI ready");
    checks.version = host.version;
    var legacy = /^6\./.test(host.version);
    var addon = legacy
      ? await new Promise(function (resolve) {
          hostAddons.getAddonByID("zotero-ai-butler@github.com", resolve);
        })
      : await hostAddons.getAddonByID("zotero-ai-butler@github.com");
    assert(addon && addon.isActive && addon.isCompatible, "installation");
    await waitFor(function () {
      return host.AIButler && host.AIButler.data.initialized;
    }, "plugin initialization");
    assert(
      !!main.document.getElementById("ai-butler-library-toolbar-btn"),
      "toolbar",
    );
    assert(
      legacy === !!main.document.getElementById("ai-butler-legacy-tab"),
      "hostSpecificSidebar",
    );
    assert(
      main.ZoteroPane.itemsView.getColumns().filter(function (column) {
        return column.dataKey.indexOf("aiButler") >= 0;
      }).length === 2,
      "columns",
    );
    var scope = Components.utils.getGlobalForObject(
      host.AIButler.hooks.onStartup,
    );
    var toolkit = host.AIButler.data.ztoolkit;
    var originalLog = toolkit.log.bind(toolkit);
    toolkit.log = function () {
      for (var index = 0; index < arguments.length; index++) {
        if (arguments[index] && arguments[index].stack) {
          errors.push(String(arguments[index]) + "\n" + arguments[index].stack);
          dump("AI_BUTLER_PROBE: " + errors[errors.length - 1] + "\n");
        }
      }
      return originalLog.apply(null, arguments);
    };
    assert(
      legacy ? !!scope.OS : scope.IOUtils === IOUtils,
      "filesystemBoundary",
    );
    if (!legacy) {
      var paper = new host.Item("journalArticle");
      paper.setField("title", "AI Butler UI regression fixture");
      await paper.saveTx();
      var note = new host.Item("note");
      note.parentID = paper.id;
      note.setNote("<h1>AI summary</h1><p>Editor focus fixture.</p>");
      note.addTag("AI-Generated");
      await note.saveTx();
      await main.ZoteroPane.selectItem(note.id);
      var editor;
      var editable;
      await waitFor(function () {
        editor = host.Notes._editorInstances.find(function (instance) {
          return instance._item && instance._item.id === note.id;
        });
        editable =
          editor && editor._iframeWindow.document.querySelector(".ProseMirror");
        return editable;
      }, "native note editor");
      await editor._initPromise;
      editable.focus();
      var editorDocument = editable.ownerDocument;
      var redraws = 0;
      var columnRefreshes = 0;
      var refreshColumns = host.ItemTreeManager.refreshColumns;
      var redrawObserver = host.Notifier.registerObserver(
        {
          notify: function (event, type, ids) {
            if (
              event === "redraw" &&
              type === "item" &&
              (!ids.length || ids.indexOf(paper.id) >= 0)
            )
              redraws++;
          },
        },
        ["item"],
        "ai-butler-ui-focus-probe",
      );
      host.ItemTreeManager.refreshColumns = function () {
        columnRefreshes++;
        return refreshColumns.apply(this, arguments);
      };
      try {
        editorDocument.execCommand("insertText", false, "Saved edit 398");
        editorDocument.execCommand("insertParagraph", false, null);
        await waitFor(function () {
          return note.getNote().indexOf("Saved edit 398") >= 0;
        }, "native note autosave");
        await waitFor(function () {
          return redraws > 0;
        }, "status row redraw");
        assert(columnRefreshes === 0, "statusRedrawWithoutColumnRebuild");
        assert(
          host.Notes._editorInstances.indexOf(editor) >= 0 &&
            editorDocument.activeElement === editable &&
            main.ZoteroPane.getSelectedItems()[0].id === note.id,
          "nativeNoteEditorKeepsFocus",
        );
      } finally {
        host.ItemTreeManager.refreshColumns = refreshColumns;
        host.Notifier.unregisterObserver(redrawObserver);
      }
    }
    var tab = main.document.createXULElement
      ? main.document.createXULElement("browser")
      : main.document.createElementNS(
          "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
          "browser",
        );
    tab.setAttribute("type", "content");
    tab.setAttribute("style", "width:800px;height:600px");
    tab.setAttribute("src", "chrome://aiButler/content/mindmap.html");
    main.document.documentElement.appendChild(tab);
    try {
      await waitFor(function () {
        return (
          tab.contentWindow && tab.contentWindow.wrappedJSObject.initMindmap
        );
      }, "mindmap load");
      tab.contentWindow.wrappedJSObject.initMindmap(
        "# Compatibility\n## Unicode 中文",
      );
      await waitFor(function () {
        return tab.contentDocument.querySelector("svg .markmap-node");
      }, "mindmap render");
      assert(true, "mindmap");
    } finally {
      tab.remove();
    }
    await waitForPromise(host.AIButler.hooks.onOpenSettings(), "open settings");
    var dashboard;
    await waitFor(function () {
      var windows = hostServices.wm.getEnumerator(null);
      while (windows.hasMoreElements()) {
        var candidate = windows.getNext();
        if (candidate.document.getElementById("ai-butler-main-window"))
          dashboard = candidate;
      }
      return (
        dashboard &&
        dashboard.document.getElementById("ai-butler-settings-scaffold")
      );
    }, "dashboard settings");
    assert(true, "settings");
    if (legacy) addon.userDisabled = true;
    else await addon.disable();
    await waitFor(function () {
      return !host.AIButler;
    }, "disable");
    await waitFor(function () {
      return dashboard.closed;
    }, "dashboard close");
    assert(
      dashboard.closed &&
        !main.document.getElementById("ai-butler-library-toolbar-btn") &&
        !main.document.getElementById("ai-butler-legacy-tab"),
      "cleanup",
    );
    if (legacy) addon.userDisabled = false;
    else await addon.enable();
    await waitFor(function () {
      return host.AIButler && host.AIButler.data.initialized;
    }, "reenable");
    assert(
      !!main.document.getElementById("ai-butler-library-toolbar-btn"),
      "reenable",
    );
    if (legacy) addon.userDisabled = true;
    else await addon.disable();
    await waitFor(function () {
      return !host.AIButler;
    }, "final cleanup");
  } catch (error) {
    checks.failure = String(error) + "\n" + error.stack;
    dump("AI_BUTLER_PROBE: " + checks.failure + "\n");
  }
  checks.finished = true;
  var report = JSON.stringify({ checks: checks, errors: errors }, null, 2);
  try {
    if (hostFiles.writeUTF8) await hostFiles.writeUTF8(REPORT_PATH, report);
    else
      await hostFiles.writeAtomic(REPORT_PATH, report, { encoding: "utf-8" });
  } finally {
    hostServices.console.unregisterListener(observer);
    hostServices.startup.quit(Components.interfaces.nsIAppStartup.eForceQuit);
  }
}
/* global Components, Services, ChromeUtils, IOUtils, REPORT_PATH, dump */
