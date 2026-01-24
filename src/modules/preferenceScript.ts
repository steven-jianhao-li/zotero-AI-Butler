import { getPref, setPref, clearPref } from "../utils/prefs";
import {
  getDefaultSummaryPrompt,
  PROMPT_VERSION,
  shouldUpdatePrompt,
} from "../utils/prompts";
import { MainWindow } from "./views/MainWindow";
import { config } from "../../package.json";

export async function registerPrefsScripts(_window: Window) {
  const slog = (...args: any[]) => {
    try {
      ztoolkit?.log?.(...args);
    } catch {
      console.log(...args);
    }
  };

  const logError = (label: string, error: any) => {
    try {
      const name = error?.name ? String(error.name) : "";
      const message = error?.message ? String(error.message) : String(error);
      const stack = error?.stack ? String(error.stack) : "";
      slog(`[AI-Butler][Prefs] ${label} failed: ${name} ${message}`);
      if (stack) {
        slog(`[AI-Butler][Prefs] ${label} stack:`, stack);
      }
    } catch {
      // ignore
    }
  };

  // Run each step independently so a failure doesn't break the "Open Main Window" button.
  try {
    migrateToGlobalOnce();
  } catch (e) {
    logError("migrateToGlobalOnce", e);
  }

  try {
    initializeDefaultPrefs();
  } catch (e) {
    logError("initializeDefaultPrefs", e);
  }

  // diagnosePrefs(); // 仅在需要调试配置问题时启用

  try {
    updatePrefsUI(_window);
  } catch (e) {
    logError("updatePrefsUI", e);
  }

  try {
    bindPrefEvents(_window);
  } catch (e) {
    logError("bindPrefEvents", e);
  }

  try {
    bindOpenMainWindowButton(_window); // 绑定打开主窗口按钮
  } catch (e) {
    logError("bindOpenMainWindowButton", e);
  }
}

/**
 * 更新首选项UI的值
 * @param win - 窗口对象
 */
function updatePrefsUI(win: Window) {
  const doc = win.document;
  const apiKeyInput = doc.getElementById(
    "zotero-prefpane-ai-butler-openaiApiKey",
  ) as HTMLInputElement | null;
  const apiUrlInput = doc.getElementById(
    "zotero-prefpane-ai-butler-openaiApiUrl",
  ) as HTMLInputElement | null;
  const modelInput = doc.getElementById(
    "zotero-prefpane-ai-butler-openaiApiModel",
  ) as HTMLInputElement | null;
  const temperatureInput = doc.getElementById(
    "zotero-prefpane-ai-butler-temperature",
  ) as HTMLInputElement | null;
  const promptTextarea = doc.getElementById(
    "zotero-prefpane-ai-butler-summaryPrompt",
  ) as HTMLTextAreaElement | null;
  const streamCheckbox = doc.getElementById(
    "zotero-prefpane-ai-butler-stream",
  ) as HTMLInputElement | null;

  const openaiApiKey = (getPref("openaiApiKey") as string) || "";
  const openaiApiUrl =
    (getPref("openaiApiUrl") as string) ||
    "https://api.openai.com/v1/responses";
  const openaiApiModel = (getPref("openaiApiModel") as string) || "gpt-5";
  const temperature = (getPref("temperature") as string) || "0.7";
  const defaultPrompt = getDefaultSummaryPrompt();
  const savedPrompt = getPref("summaryPrompt") as string;
  const stream = (getPref("stream") as boolean) ?? true;

  if (apiKeyInput) apiKeyInput.value = openaiApiKey;
  if (apiUrlInput) apiUrlInput.value = openaiApiUrl;
  if (modelInput) modelInput.value = openaiApiModel;
  if (temperatureInput) temperatureInput.value = temperature;
  if (promptTextarea) {
    // 如果没有保存的 prompt 或者是 undefined/空字符串，使用默认值
    const finalPrompt =
      savedPrompt && savedPrompt.trim() ? savedPrompt : defaultPrompt;
    promptTextarea.value = finalPrompt;
    // 确保保存默认值到配置中
    if (!savedPrompt || !savedPrompt.trim()) {
      setPref("summaryPrompt", defaultPrompt);
    }
  }
  if (streamCheckbox) streamCheckbox.checked = !!stream;
}

/**
 * 绑定首选项事件
 * @param win - 窗口对象
 */
function bindPrefEvents(win: Window) {
  const doc = win.document;
  const apiKeyInput = doc.getElementById(
    "zotero-prefpane-ai-butler-openaiApiKey",
  ) as HTMLInputElement | null;
  const apiUrlInput = doc.getElementById(
    "zotero-prefpane-ai-butler-openaiApiUrl",
  ) as HTMLInputElement | null;
  const modelInput = doc.getElementById(
    "zotero-prefpane-ai-butler-openaiApiModel",
  ) as HTMLInputElement | null;
  const temperatureInput = doc.getElementById(
    "zotero-prefpane-ai-butler-temperature",
  ) as HTMLInputElement | null;
  const promptTextarea = doc.getElementById(
    "zotero-prefpane-ai-butler-summaryPrompt",
  ) as HTMLTextAreaElement | null;
  const streamCheckbox = doc.getElementById(
    "zotero-prefpane-ai-butler-stream",
  ) as HTMLInputElement | null;

  if (apiKeyInput) {
    const save = () => setPref("openaiApiKey", apiKeyInput.value || "");
    apiKeyInput.addEventListener("input", save);
    apiKeyInput.addEventListener("blur", save);
    apiKeyInput.addEventListener("change", save);
  }
  if (apiUrlInput) {
    const save = () => setPref("openaiApiUrl", apiUrlInput.value || "");
    apiUrlInput.addEventListener("input", save);
    apiUrlInput.addEventListener("blur", save);
    apiUrlInput.addEventListener("change", save);
  }
  if (modelInput) {
    const save = () => setPref("openaiApiModel", modelInput.value || "");
    modelInput.addEventListener("input", save);
    modelInput.addEventListener("blur", save);
    modelInput.addEventListener("change", save);
  }
  if (temperatureInput) {
    const save = () => {
      const value = temperatureInput.value || "0.7";
      setPref("temperature", value);
    };
    temperatureInput.addEventListener("input", save);
    temperatureInput.addEventListener("blur", save);
    temperatureInput.addEventListener("change", save);
  }
  if (promptTextarea) {
    const save = () =>
      setPref(
        "summaryPrompt",
        promptTextarea.value || getDefaultSummaryPrompt(),
      );
    promptTextarea.addEventListener("input", save);
    promptTextarea.addEventListener("blur", save);
    promptTextarea.addEventListener("change", save);
  }
  if (streamCheckbox) {
    const save = () => setPref("stream", !!streamCheckbox.checked);
    streamCheckbox.addEventListener("input", save);
    streamCheckbox.addEventListener("change", save);
    streamCheckbox.addEventListener("blur", save);
  }

  // flush on unload to persist any in-focus edits
  win.addEventListener("unload", () => {
    if (apiKeyInput) setPref("openaiApiKey", apiKeyInput.value || "");
    if (apiUrlInput) setPref("openaiApiUrl", apiUrlInput.value || "");
    if (modelInput) setPref("openaiApiModel", modelInput.value || "");
    if (temperatureInput)
      setPref("temperature", temperatureInput.value || "0.7");
    if (promptTextarea)
      setPref(
        "summaryPrompt",
        promptTextarea.value || getDefaultSummaryPrompt(),
      );
    if (streamCheckbox) setPref("stream", !!streamCheckbox.checked);
  });
}

// getDefaultPrompt 函数已移除，使用 prompts.ts 中的函数

/**
 * 初始化默认配置 - 在插件加载时立即执行
 * 确保即使 prefs.js 没有加载，也能有默认值
 */
function initializeDefaultPrefs() {
  const defaults: Record<string, any> = {
    openaiApiKey: "",
    openaiApiUrl: "https://api.openai.com/v1/responses",
    openaiApiModel: "gpt-5",
    temperature: "0.7",
    stream: true,
    summaryPrompt: getDefaultSummaryPrompt(),
    promptVersion: PROMPT_VERSION,
  };

  // 遍历所有默认配置
  for (const [key, defaultValue] of Object.entries(defaults)) {
    try {
      const currentValue = getPref(key as any);

      // 特殊处理提示词更新
      if (key === "summaryPrompt") {
        const currentPromptVersion = getPref("promptVersion" as any) as
          | number
          | undefined;
        const currentPrompt = currentValue as string | undefined;

        // 检查是否需要更新提示词
        if (shouldUpdatePrompt(currentPromptVersion, currentPrompt)) {
          ztoolkit.log(`[AI-Butler][Prefs] 更新提示词到版本 ${PROMPT_VERSION}`);
          setPref("summaryPrompt" as any, defaultValue);
          setPref("promptVersion" as any, PROMPT_VERSION);
          continue;
        }
      }

      // 如果配置不存在或为空，则设置默认值
      if (currentValue === undefined || currentValue === null) {
        // const preview = typeof defaultValue === 'string' && defaultValue.length > 50
        //   ? defaultValue.substring(0, 50) + '...'
        //   : defaultValue;
        // ztoolkit.log(`[AI-Butler][Prefs] 初始化配置: ${key} = ${preview}`);
        setPref(key as any, defaultValue);
      } else if (
        typeof defaultValue === "string" &&
        typeof currentValue === "string" &&
        !currentValue.trim()
      ) {
        // 对于字符串类型，如果是空字符串也重置
        // ztoolkit.log(`[AI-Butler][Prefs] 重置空配置: ${key}`);
        setPref(key as any, defaultValue);
      }
    } catch (error) {
      ztoolkit.log(`[AI-Butler][Prefs] 初始化配置失败: ${key}`, error);
      // 如果读取失败，尝试强制设置
      try {
        setPref(key as any, defaultValue);
      } catch (e) {
        ztoolkit.log(`[AI-Butler][Prefs] 强制设置配置失败: ${key}`, e);
      }
    }
  }
}

/**
 * 诊断配置问题 - 在控制台输出详细信息(仅在调试时使用)
 * 取消注释 registerPrefsScripts 中的调用来启用
 */
function diagnosePrefs() {
  ztoolkit.log("[AI-Butler][Prefs] ========== 配置诊断开始 ==========");

  const keys = [
    "openaiApiKey",
    "openaiApiUrl",
    "openaiApiModel",
    "temperature",
    "stream",
    "summaryPrompt",
  ];

  for (const key of keys) {
    try {
      const value = getPref(key as any);
      const valueType = typeof value;
      const valueLength = typeof value === "string" ? value.length : "N/A";
      const valuePreview =
        typeof value === "string" && value.length > 100
          ? value.substring(0, 100) + "..."
          : value;

      ztoolkit.log(`[AI-Butler][Prefs] 配置项: ${key}`);
      ztoolkit.log(`  - 值: ${valuePreview}`);
      ztoolkit.log(`  - 类型: ${valueType}`);
      ztoolkit.log(`  - 长度: ${valueLength}`);
      ztoolkit.log(
        `  - 是否为空: ${value === undefined || value === null || (typeof value === "string" && !value.trim())}`,
      );
    } catch (error) {
      ztoolkit.log(`[AI-Butler][Prefs] 读取配置失败: ${key}`, error);
    }
  }

  ztoolkit.log("[AI-Butler][Prefs] ========== 配置诊断结束 ==========");
}

// One-time migration from provider-scoped or misspelled keys back to global keys
function migrateToGlobalOnce() {
  try {
    const flag = getPref("migratedToGlobalV2" as any) as boolean;
    if (flag) return;

    const pick = (k: string): string | undefined => {
      const sources = [
        `custom_${k}`,
        `deepseek_${k}`,
        `openai_${k}`,
        k, // legacy global
        `customed_${k}`, // misspelled legacy
      ];
      for (const s of sources) {
        const v = getPref(s as any) as string;
        if (v) return v;
      }
      return undefined;
    };

    const openaiApiKey = pick("openaiApiKey") || "";
    const openaiApiUrl =
      pick("openaiApiUrl") || "https://api.openai.com/v1/responses";
    const openaiApiModel = pick("openaiApiModel") || "gpt-5";

    setPref("openaiApiKey", openaiApiKey);
    setPref("openaiApiUrl", openaiApiUrl);
    setPref("openaiApiModel", openaiApiModel);

    for (const p of ["openai", "deepseek", "custom", "customed"]) {
      for (const k of ["openaiApiKey", "openaiApiUrl", "openaiApiModel"]) {
        clearPref(`${p}_${k}`);
      }
    }
    // keep globals only from now on

    setPref("migratedToGlobalV2" as any, true as any);
  } catch (err) {
    // noop
  }
}

/**
 * 绑定"打开 AI 管家控制面板"按钮的点击事件
 *
 * 这是"反转控制权"模式的核心实现:
 * 由主脚本主动找到偏好设置页面中的按钮,并为其绑定事件监听器
 *
 * 为什么这样做?
 * - Zotero 7 的内容安全策略(CSP)禁止在 XHTML 中使用内联脚本
 * - preferences.xhtml 中的 <script> 标签加载时机不可靠
 * - onload 事件在某些情况下不会触发
 *
 * 这个方法的优势:
 * - 绕过了 XHTML 的脚本加载问题
 * - 由可靠的主脚本控制整个流程
 * - 符合 Zotero 7 的最佳实践
 *
 * @param win 偏好设置窗口对象
 */
function bindOpenMainWindowButton(win: Window) {
  try {
    const doc = win.document;

    // Safe logger: fall back to console if ztoolkit isn't ready in this context
    const slog = (...args: any[]) => {
      try {
        ztoolkit?.log?.(...args);
      } catch {
        console.log(...args);
      }
    };

    const buttonId = `${config.addonRef}-openMainWindow`;
    const maxAttempts = 50; // ~5s at 100ms interval
    let attempts = 0;

    const handler = (event: Event) => {
      try {
        event.preventDefault?.();
        event.stopPropagation?.();
      } catch {
        // ignore
      }

      slog("[AI-Butler][Prefs] Open main window button activated");

      try {
        // Open the control panel window and switch to Settings tab
        const mainWindow = MainWindow.getInstance();
        void mainWindow.open("settings").catch((error) => {
          slog("[AI-Butler][Prefs] Failed to open main window:", error);

          const message =
            error instanceof Error ? error.message : String(error);
          new ztoolkit.ProgressWindow("AI Butler", {
            closeOnClick: true,
            closeTime: 5000,
          })
            .createLine({
              text: `打开主窗口失败: ${message}`,
              type: "error",
            })
            .show();
        });
      } catch (error) {
        slog("[AI-Butler][Prefs] Failed to open main window:", error);

        const message = error instanceof Error ? error.message : String(error);
        new ztoolkit.ProgressWindow("AI Butler", {
          closeOnClick: true,
          closeTime: 5000,
        })
          .createLine({
            text: `打开主窗口失败: ${message}`,
            type: "error",
          })
          .show();
      }
    };

    const tryBind = () => {
      attempts++;
      const button = doc.getElementById(buttonId) as any;

      if (!button) {
        if (attempts === 1) {
          slog(`[AI-Butler][Prefs] Waiting for button: ${buttonId}`);
        }
        if (attempts < maxAttempts) {
          win.setTimeout(tryBind, 100);
          return;
        }

        slog(`[AI-Butler][Prefs] Button not found after retries: ${buttonId}`);
        return;
      }

      // Remove any previously bound handler (e.g. when the pane reloads)
      const oldListener = (button as any).__aiButlerListener;
      if (oldListener) {
        try {
          button.removeEventListener("click", oldListener);
        } catch {
          // ignore
        }
        try {
          button.removeEventListener("command", oldListener);
        } catch {
          // ignore
        }
      }

      (button as any).__aiButlerListener = handler;

      // XUL buttons trigger "command"; keep "click" for compatibility.
      button.addEventListener("command", handler);
      button.addEventListener("click", handler);

      slog(`[AI-Butler][Prefs] Button bound: ${buttonId}`);
    };

    // Don't assume the pane has already been inserted when the script runs.
    win.setTimeout(tryBind, 0);
  } catch (error) {
    try {
      ztoolkit?.log?.("[AI-Butler][Prefs] 绑定按钮事件时出错:", error);
    } catch {
      console.error("[AI-Butler][Prefs] 绑定按钮事件时出错:", error);
    }
  }
}
