(function () {
  "use strict";

  try {
    // 关键日志：确认脚本文件被加载并执行
    Zotero.debug("[AI-Butler] preferences.js script executed.");

    const buttonId = "__addonRef__-openMainWindow";
    const openButton = document.getElementById(buttonId);

    if (openButton) {
      Zotero.debug(
        "[AI-Butler] Button found. Attaching click listener directly.",
      );

      openButton.addEventListener("click", function () {
        try {
          Zotero.debug("[AI-Butler] Button clicked - opening main window");

          const addonInstance = Zotero.AIButler;
          if (
            addonInstance &&
            typeof addonInstance.hooks?.onOpenMainWindow === "function"
          ) {
            Zotero.debug("[AI-Butler] Calling onOpenMainWindow hook");
            addonInstance.hooks.onOpenMainWindow();
          } else {
            Zotero.debug("[AI-Butler] Hook not found, trying backup method");
            const win = Zotero.getMainWindow();
            if (win && win.document) {
              const menuItem = win.document.getElementById(
                "zotero-itemmenu-ai-butler-summary",
              );
              if (menuItem) {
                menuItem.click();
              } else {
                Zotero.debug("[AI-Butler] Menu item not found");
              }
            }
          }
        } catch (e) {
          Zotero.debug("[AI-Butler] Error in button click handler: " + e);
        }
      });

      Zotero.debug("[AI-Butler] Click listener attached successfully.");
    } else {
      Zotero.debug("[AI-Butler] Button not found with ID: " + buttonId);
    }

    const addonInstance = Zotero.AIButler;
    if (
      addonInstance &&
      typeof addonInstance.hooks?.onPrefsEvent === "function"
    ) {
      Zotero.debug('[AI-Butler] Calling onPrefsEvent hook for "load" event.');
      addonInstance.hooks.onPrefsEvent("load", { window: window });
    }
  } catch (e) {
    Zotero.debug("[AI-Butler] Fatal error in preferences.js: " + e);
  }
})();
