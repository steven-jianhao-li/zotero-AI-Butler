/**
 * Preferences window loader script
 * This script runs inside the Zotero preferences pane window for AI-Butler.
 * It delegates initialization to the addon's hooks without requiring inline scripts.
 */
import { config } from "../package.json";

(function () {
  try {
    // Prefer the named instance, fallback to __addonInstance__ if available
    // @ts-expect-error - dynamic access to global Zotero
    // prettier-ignore
    const addonInstance = Zotero?.[config.addonInstance] || Zotero?.__addonInstance__;
    const hooks = addonInstance?.hooks;

    if (hooks && typeof hooks.onPrefsEvent === "function") {
      // Use globalThis to reference the current window object in this context
      hooks.onPrefsEvent("load", { window: globalThis as unknown as Window });
    } else {
      // eslint-disable-next-line no-console
      console.warn("[AI-Butler][Prefs] hooks.onPrefsEvent not available");
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[AI-Butler][Prefs] prefs-entry execution error:", e);
  }
})();
