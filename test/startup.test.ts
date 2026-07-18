import { assert } from "chai";
import { config } from "../package.json";
import { getString } from "../src/utils/locale";
import {
  createMainWindowScaffold,
  createSettingsScaffold,
} from "../src/modules/views/layout/windowScaffold";
import { AboutPage } from "../src/modules/views/settings/AboutPage";

describe("startup", function () {
  it("should have plugin instance defined", function () {
    assert.isNotEmpty(Zotero[config.addonInstance]);
  });

  it("loads bundled Fluent resources from all plugin locale files", function () {
    const keysFromBundledFiles = [
      "startup-begin",
      "main-window-title",
      "ai-butler-prefpane-caption",
    ];

    for (const key of keysFromBundledFiles) {
      assert.notEqual(getString(key), key);
      assert.notInclude(getString(key), `${config.addonRef}-${key}`);
    }
  });

  it("keeps literal prompt-template variables intact after Fluent loading", function () {
    const notice = getString("settings-prompts-variable-notice");

    assert.include(notice, "{{chapter_index}}");
    assert.include(notice, "{{title_zh}}");
    assert.include(notice, "{{title_en}}");
    assert.notInclude(notice, `${config.addonRef}-chapter_index`);
    assert.notInclude(notice, `${config.addonRef}-title_zh`);
    assert.notInclude(notice, `${config.addonRef}-title_en`);
  });

  it("renders localized main-window and settings navigation scaffolds", function () {
    const doc = Zotero.getMainWindow().document;
    const mainHost = doc.createElement("div");
    const settingsHost = doc.createElement("div");

    createMainWindowScaffold(
      mainHost,
      [
        {
          id: "dashboard",
          icon: "[D]",
          label: getString("main-window-tab-dashboard"),
        },
        {
          id: "summary",
          icon: "[S]",
          label: getString("main-window-tab-summary"),
        },
      ],
      () => undefined,
    );
    createSettingsScaffold(
      settingsHost,
      [
        {
          id: "modelPlatform",
          label: getString("settings-nav-model-platform"),
        },
        { id: "api", label: getString("settings-nav-api") },
      ],
      () => undefined,
    );

    const renderedText = `${mainHost.textContent || ""} ${settingsHost.textContent || ""}`;
    assert.include(renderedText, getString("main-window-tab-dashboard"));
    assert.include(renderedText, getString("main-window-tab-summary"));
    assert.include(renderedText, getString("settings-nav-model-platform"));
    assert.include(renderedText, getString("settings-nav-api"));
    assert.notInclude(renderedText, "main-window-tab-dashboard");
    assert.notInclude(renderedText, "settings-nav-model-platform");
  });

  it("renders a concrete settings subpage with localized text", function () {
    const doc = Zotero.getMainWindow().document;
    const host = doc.createElement("div");

    new AboutPage(host).render();

    const renderedText = host.textContent || "";
    const expectedTexts = [
      getString("settings-about-title"),
      getString("settings-about-open-tutorial"),
      getString("settings-about-features-title"),
      getString("settings-about-info-title"),
    ];

    for (const text of expectedTexts) {
      assert.include(renderedText, text);
    }
    assert.notInclude(renderedText, "settings-about-title");
    assert.notInclude(renderedText, "settings-about-open-tutorial");
  });

  it("loads task queue runtime strings from bundled Fluent resources", function () {
    const keys = [
      "task-queue-title",
      "task-queue-stat-total",
      "task-queue-filter-all",
      "task-queue-clear-completed",
      "task-queue-empty",
      "task-queue-search-placeholder",
    ];

    for (const key of keys) {
      const value = getString(key);
      assert.notEqual(value, key);
      assert.notInclude(value, `${config.addonRef}-${key}`);
    }
  });

  it("loads menu sidebar dialog and export strings from bundled Fluent resources", function () {
    const keys = [
      "menuitem-label",
      "library-toolbar-ai-butler",
      "reader-toolbar-ai-chat",
      "itempane-ai-open-chat",
      "itempane-question-placeholder",
      "itempane-send",
      "itempane-save-note",
      "summary-error-no-items",
      "collection-clean-confirm-title-delete",
      "collection-clean-confirm-label-delete",
      "collection-export-dialog-title",
      "note-export-error-select-directory",
      "settings-data-clear-all-confirm",
      "settings-note-export-title",
    ];

    for (const key of keys) {
      const value = getString(key);
      assert.notEqual(value, key);
      assert.notInclude(value, `${config.addonRef}-${key}`);
    }
  });

  it("loads runtime error and generated-note strings from bundled Fluent resources", function () {
    const keys = [
      "task-error-no-paper-selected",
      "task-error-no-pdf-attachment",
      "task-error-item-not-found",
      "note-generator-error-empty-note",
      "note-generator-error-empty-response",
      "note-generator-error-multimodel-no-provider",
      "note-generator-warning-multipdf-unsupported",
      "note-export-kind-summary",
      "note-export-kind-deep-read",
      "summary-loading-paper",
      "summary-error-no-pdf-attachment",
      "summary-error-pdf-content-failed",
      "image-client-test-no-image",
      "image-client-error-download-failed",
      "image-client-error-api-key-missing",
      "image-client-error-empty-response",
    ];

    for (const key of keys) {
      const value = getString(key);
      assert.notEqual(value, key);
      assert.notInclude(value, `${config.addonRef}-${key}`);
    }
  });
});
