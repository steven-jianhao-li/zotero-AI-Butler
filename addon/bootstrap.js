var chromeHandle;
var pluginScope;
var legacyWindowListener;
var cancelPendingStartup;
var Services;
var Zotero;

function install(data, reason) {}

async function startup(data, reason) {
  if (!Services) {
    Services = Components.utils.import(
      "resource://gre/modules/Services.jsm",
    ).Services;
  }
  if (!Zotero) {
    Zotero = await waitForLegacyHost();
    if (!Zotero) return;
  }
  var versionMatch =
    /^(\d+)(?:\.\d+)*(?:[-.](?:beta|dev|alpha|rc)[\w.-]*)?$/.exec(
      String(Zotero.version),
    );
  var majorVersion = versionMatch ? Number(versionMatch[1]) : 0;
  if (majorVersion < 6)
    throw new Error(
      "AI Butler: unsupported or unrecognized Zotero version: " +
        Zotero.version,
    );
  var legacy = majorVersion === 6;
  if (!legacy) {
    var missing = [];
    if (
      !Zotero.PreferencePanes ||
      typeof Zotero.PreferencePanes.register !== "function"
    )
      missing.push("PreferencePanes.register");
    if (
      !Zotero.ItemPaneManager ||
      typeof Zotero.ItemPaneManager.registerSection !== "function"
    )
      missing.push("ItemPaneManager.registerSection");
    if (
      !Zotero.ItemTreeManager ||
      typeof Zotero.ItemTreeManager.registerColumn !== "function"
    )
      missing.push("ItemTreeManager.registerColumn");
    if (
      !Zotero.Reader ||
      typeof Zotero.Reader.registerEventListener !== "function"
    )
      missing.push("Reader.registerEventListener");
    if (typeof IOUtils === "undefined") missing.push("IOUtils");
    if (typeof PathUtils === "undefined") missing.push("PathUtils");
    if (typeof Localization === "undefined") missing.push("Localization");
    if (missing.length)
      throw new Error(
        "AI Butler: modern Zotero " +
          Zotero.version +
          " is missing required capabilities: " +
          missing.join(", "),
      );
  }
  var rootURI = data.rootURI || data.resourceURI.spec;
  if (rootURI.slice(-1) !== "/") rootURI += "/";
  var scriptRoot =
    rootURI + (legacy ? "legacy/content/scripts/" : "content/scripts/");

  try {
    if (!legacy) {
      var aomStartup = Components.classes[
        "@mozilla.org/addons/addon-manager-startup;1"
      ].getService(Components.interfaces.amIAddonManagerStartup);
      chromeHandle = aomStartup.registerChrome(
        Services.io.newURI(rootURI + "manifest.json"),
        [["content", "__addonRef__", rootURI + "content/"]],
      );
    }

    // A separate compartment keeps legacy polyfills out of Zotero and other plugins.
    pluginScope = new Components.utils.Sandbox(
      Services.scriptSecurityManager.getSystemPrincipal(),
      {
        sandboxName: data.id,
        wantGlobalProperties: [
          "TextEncoder",
          "TextDecoder",
          "URL",
          "XMLHttpRequest",
          "fetch",
          "Blob",
          "File",
          "FormData",
          "atob",
          "btoa",
        ],
      },
    );
    pluginScope.Zotero = Zotero;
    pluginScope.Services = Services;
    pluginScope.Components = Components;
    pluginScope.ChromeUtils =
      typeof ChromeUtils === "undefined" ? Components.utils : ChromeUtils;
    pluginScope.rootURI = rootURI;
    pluginScope._globalThis = pluginScope;
    pluginScope.globalThis = pluginScope;
    pluginScope.console = Zotero.getMainWindow()
      ? Zotero.getMainWindow().console
      : { log: Zotero.debug, error: Zotero.logError };
    var mainWindow = Zotero.getMainWindow();
    if (mainWindow) {
      ["DOMParser", "XMLSerializer", "AbortController"].forEach(
        function (name) {
          if (mainWindow[name]) pluginScope[name] = mainWindow[name];
        },
      );
    }
    var timers = legacy
      ? Components.utils.import("resource://gre/modules/Timer.jsm")
      : ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
    pluginScope.setTimeout = timers.setTimeout;
    pluginScope.clearTimeout = timers.clearTimeout;
    pluginScope.setInterval = timers.setInterval;
    pluginScope.clearInterval = timers.clearInterval;
    if (legacy) {
      pluginScope.OS = Components.utils.import(
        "resource://gre/modules/osfile.jsm",
      ).OS;
      var defaults = Services.prefs.getDefaultBranch("");
      Services.scriptloader.loadSubScript(rootURI + "prefs.js", {
        Zotero: Zotero,
        pref: function (name, value) {
          if (typeof value === "boolean") defaults.setBoolPref(name, value);
          else if (typeof value === "number") defaults.setIntPref(name, value);
          else defaults.setStringPref(name, value);
        },
      });
    } else {
      pluginScope.IOUtils = IOUtils;
      pluginScope.PathUtils = PathUtils;
      pluginScope.Localization = Localization;
    }
    if (legacy) loadPluginScript(scriptRoot + "compatibility.js");
    loadPluginScript(scriptRoot + "__addonRef__.js");
    await Zotero.__addonInstance__.hooks.onStartup();

    if (legacy) {
      legacyWindowListener = {
        onOpenWindow: function (xulWindow) {
          var win = xulWindow
            .QueryInterface(Components.interfaces.nsIInterfaceRequestor)
            .getInterface(Components.interfaces.nsIDOMWindow);
          win.addEventListener("load", function loaded() {
            win.removeEventListener("load", loaded);
            if (
              win.document.documentElement.getAttribute("windowtype") ===
              "navigator:browser"
            ) {
              onMainWindowLoad({ window: win }).catch(Zotero.logError);
            }
          });
        },
        onCloseWindow: function (xulWindow) {
          var win = xulWindow
            .QueryInterface(Components.interfaces.nsIInterfaceRequestor)
            .getInterface(Components.interfaces.nsIDOMWindow);
          if (
            win.document.documentElement.getAttribute("windowtype") ===
            "navigator:browser"
          ) {
            onMainWindowUnload({ window: win }).catch(Zotero.logError);
          }
        },
        onWindowTitleChange: function () {},
      };
      Services.wm.addListener(legacyWindowListener);
    }
  } catch (error) {
    try {
      await shutdown(data, reason);
    } catch (cleanupError) {
      Zotero.logError(cleanupError);
    }
    throw error;
  }
}

async function onMainWindowLoad(data, reason) {
  if (Zotero.__addonInstance__)
    await Zotero.__addonInstance__.hooks.onMainWindowLoad(data.window);
}

async function onMainWindowUnload(data, reason) {
  if (Zotero.__addonInstance__)
    await Zotero.__addonInstance__.hooks.onMainWindowUnload(data.window);
}

async function shutdown(data, reason) {
  if (reason === APP_SHUTDOWN) return;
  if (cancelPendingStartup) cancelPendingStartup();
  if (legacyWindowListener) {
    Services.wm.removeListener(legacyWindowListener);
    legacyWindowListener = null;
  }
  try {
    if (Zotero && Zotero.__addonInstance__)
      await Zotero.__addonInstance__.hooks.onShutdown();
  } finally {
    if (chromeHandle) {
      chromeHandle.destruct();
      chromeHandle = null;
    }
    pluginScope = null;
  }
}

function uninstall(data, reason) {}

function loadPluginScript(uri) {
  if (Services.scriptloader.loadSubScriptWithOptions) {
    // Newer Gecko rejects packaged jar:file: scripts unless their trusted URL is explicitly allowed.
    Services.scriptloader.loadSubScriptWithOptions(uri, {
      target: pluginScope,
      allowUnsafeURL: true,
    });
  } else {
    Services.scriptloader.loadSubScript(uri, pluginScope);
  }
}

function waitForLegacyHost() {
  // Acquiring the XPCOM service during add-on discovery initializes Zotero before its hidden window exists.
  return new Promise(function (resolve) {
    var watched = [];
    var finished = false;
    var observer = {
      observe: function (win, topic) {
        if (topic === "chrome-document-global-created") watch(win);
      },
    };
    function finish(host) {
      if (finished) return;
      finished = true;
      Services.obs.removeObserver(observer, "chrome-document-global-created");
      watched.forEach(function (entry) {
        entry.window.removeEventListener("load", entry.loaded);
      });
      cancelPendingStartup = null;
      resolve(host);
    }
    function watch(win) {
      function loaded() {
        if (
          win.Zotero &&
          win.document.documentElement.getAttribute("windowtype") ===
            "navigator:browser"
        )
          finish(win.Zotero);
      }
      watched.push({ window: win, loaded: loaded });
      win.addEventListener("load", loaded);
      loaded();
    }
    Services.obs.addObserver(observer, "chrome-document-global-created");
    cancelPendingStartup = function () {
      finish(null);
    };
    var existing = Services.wm.getMostRecentWindow("navigator:browser");
    if (existing) watch(existing);
  });
}
