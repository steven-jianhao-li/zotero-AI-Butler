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
      // In PreferencePanes scripts, `globalThis` may be a sandbox global, not the actual Window.
      // Prefer the real window from document.defaultView if available.
      const doc: any = (globalThis as any).document;
      const win: any =
        doc?.defaultView || (globalThis as any).window || (globalThis as any);
      hooks.onPrefsEvent("load", { window: win as Window });
    } else {
      console.warn("[AI-Butler][Prefs] hooks.onPrefsEvent not available");
    }
  } catch (e) {
    console.error("[AI-Butler][Prefs] prefs-entry execution error:", e);
  }
})();
