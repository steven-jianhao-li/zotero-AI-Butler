/**
 * 数据管理页面
 */

import { getPref, setPref, clearPref } from "../../../utils/prefs";
import {
  createFormGroup,
  createStyledButton,
  createNotice,
  createCard,
} from "../ui/components";
import { isDeepReadNote, isRegularSummaryNote } from "../../aiNoteClassifier";
import type { AiNoteKind } from "../../aiNoteService";
import { TaskQueueManager } from "../../taskQueue";
import { getDefaultSummaryPrompt } from "../../../utils/prompts";
import { getString } from "../../../utils/locale";

export class DataSettingsPage {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public render(): void {
    this.container.innerHTML = "";

    const title = Zotero.getMainWindow().document.createElement("h2");
    title.textContent = getString("settings-data-title");
    Object.assign(title.style, {
      color: "#59c0bc",
      marginBottom: "20px",
      fontSize: "20px",
      borderBottom: "2px solid #59c0bc",
      paddingBottom: "10px",
    });
    this.container.appendChild(title);

    this.container.appendChild(
      createNotice(getString("settings-data-description")),
    );

    const section = Zotero.getMainWindow().document.createElement("div");
    Object.assign(section.style, { maxWidth: "820px" });

    // 任务统计
    const stats = this.getStats();
    const statsBox = Zotero.getMainWindow().document.createElement("div");
    Object.assign(statsBox.style, {
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: "12px",
      marginBottom: "16px",
    });

    const statConfigs = [
      {
        label: getString("settings-data-stat-total"),
        val: stats.total.toString(),
        icon: "📊",
      },
      {
        label: getString("settings-data-stat-completed"),
        val: stats.completed.toString(),
        icon: "✅",
      },
      {
        label: getString("settings-data-stat-failed"),
        val: stats.failed.toString(),
        icon: "⚠️",
      },
    ];

    statConfigs.forEach((s) => {
      const card = createCard("stat", s.label, undefined, {
        value: s.val,
        icon: s.icon,
        accentColor: "#59c0bc",
      });
      statsBox.appendChild(card);
    });

    section.appendChild(statsBox);

    // 操作按钮行
    const row1 = Zotero.getMainWindow().document.createElement("div");
    Object.assign(row1.style, {
      display: "flex",
      gap: "12px",
      marginBottom: "12px",
    });
    const btnClearDone = createStyledButton(
      getString("settings-data-clear-completed"),
      "#9e9e9e",
    );
    btnClearDone.addEventListener("click", async () => {
      await TaskQueueManager.getInstance().clearCompleted();
      this.render();
      new ztoolkit.ProgressWindow(getString("settings-data-progress-title"))
        .createLine({
          text: getString("settings-data-clear-completed-done"),
          type: "success",
        })
        .show();
    });
    const btnClearAll = createStyledButton(
      getString("settings-data-clear-all"),
      "#f44336",
    );
    btnClearAll.addEventListener("click", async () => {
      const ok = Services.prompt.confirm(
        Zotero.getMainWindow() as any,
        getString("settings-data-clear-all-title"),
        getString("settings-data-clear-all-confirm"),
      );
      if (!ok) return;
      await TaskQueueManager.getInstance().clearAll();
      this.render();
      new ztoolkit.ProgressWindow(getString("settings-data-progress-title"))
        .createLine({
          text: getString("settings-data-clear-all-done"),
          type: "success",
        })
        .show();
    });
    const btnClearEmptySummaryNotes = createStyledButton(
      getString("settings-data-clear-empty-summary"),
      "#ff9800",
    );
    btnClearEmptySummaryNotes.addEventListener("click", () =>
      this.clearEmptyNotes("summary"),
    );
    const btnClearEmptyDeepReadNotes = createStyledButton(
      getString("settings-data-clear-empty-deep-read"),
      "#ff9800",
    );
    btnClearEmptyDeepReadNotes.addEventListener("click", () =>
      this.clearEmptyNotes("deepRead"),
    );
    row1.appendChild(btnClearDone);
    row1.appendChild(btnClearAll);
    row1.appendChild(btnClearEmptySummaryNotes);
    row1.appendChild(btnClearEmptyDeepReadNotes);
    section.appendChild(row1);

    // 设置导出/导入
    const row2 = Zotero.getMainWindow().document.createElement("div");
    Object.assign(row2.style, {
      display: "flex",
      gap: "12px",
      marginBottom: "12px",
    });
    const btnExport = createStyledButton(
      getString("settings-data-export-json"),
      "#2196f3",
    );
    btnExport.addEventListener("click", () => this.exportSettings());
    const btnImport = createStyledButton(
      getString("settings-data-import-json"),
      "#673ab7",
    );
    btnImport.addEventListener("click", () => this.importSettings());
    row2.appendChild(btnExport);
    row2.appendChild(btnImport);
    section.appendChild(row2);

    // 一键重置
    const row3 = Zotero.getMainWindow().document.createElement("div");
    Object.assign(row3.style, {
      display: "flex",
      gap: "12px",
      marginBottom: "12px",
    });
    const btnResetAll = createStyledButton(
      getString("settings-data-reset-all"),
      "#9e9e9e",
    );
    btnResetAll.addEventListener("click", () => this.resetAll());
    section.appendChild(row3);
    row3.appendChild(btnResetAll);

    this.container.appendChild(section);
  }

  private getStats() {
    const q = TaskQueueManager.getInstance();
    q.refreshFromStorage();
    const all = q.getAllTasks();
    return {
      total: all.length,
      completed: all.filter((t) => t.status === "completed").length,
      failed: all.filter((t) => t.status === "failed").length,
    };
  }

  private exportSettings(): void {
    // 采集 prefs.d.ts 中声明的键
    const keys = [
      "provider",
      "llmEndpoints",
      "llmRoutingStrategy",
      "multiModelSummaryEnabled",
      "multiModelSummaryEndpointIds",
      "openaiApiKey",
      "openaiApiUrl",
      "openaiApiModel",
      "geminiApiUrl",
      "geminiApiKey",
      "geminiModel",
      "temperature",
      "enableTemperature",
      "maxTokens",
      "enableMaxTokens",
      "topP",
      "enableTopP",
      "reasoningEffort",
      "stream",
      "summaryPrompt",
      "customPrompts",
      "multiRoundPromptTemplates",
      "multiRoundPromptTemplateId",
      "maxRetries",
      "batchSize",
      "batchInterval",
      "autoScan",
      "scanInterval",
      "pdfProcessMode",
      "pdfAttachmentMode",
      "theme",
      "fontSize",
      "autoScroll",
      "windowWidth",
      "windowHeight",
      "openTaskPanelOnSummon",
      "notePrefix",
      "noteStrategy",
    ];
    const data: any = {};
    keys.forEach((k) => {
      try {
        data[k] = getPref(k as any);
      } catch (e) {
        // 忽略单个首选项读取失败
        return;
      }
    });
    const json = JSON.stringify(data, null, 2);

    // 用对话框展示,方便复制
    const win = Zotero.getMainWindow().document;
    const overlay = win.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,0.35)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "9999",
    });
    const modal = win.createElement("div");
    Object.assign(modal.style, {
      width: "720px",
      maxWidth: "90vw",
      background: "#fff",
      borderRadius: "8px",
      padding: "16px",
      boxShadow: "0 10px 30px rgba(0,0,0,.2)",
    });
    const ta = win.createElement("textarea");
    Object.assign(ta.style, {
      width: "100%",
      height: "360px",
      fontFamily: "Consolas, monospace",
      fontSize: "12px",
    });
    ta.value = json;
    const close = createStyledButton(
      getString("settings-data-close"),
      "#9e9e9e",
    );
    close.addEventListener("click", () => overlay.remove());
    modal.appendChild(ta);
    modal.appendChild(close);
    overlay.appendChild(modal);
    (win.body ?? win.documentElement)!.appendChild(overlay);
  }

  private importSettings(): void {
    const win = Zotero.getMainWindow() as any;
    const text = { value: "" } as any;
    const ok = Services.prompt.prompt(
      win,
      getString("settings-data-import-title"),
      getString("settings-data-import-prompt"),
      text,
      "",
      { value: false },
    );
    if (!ok || !text.value) return;
    try {
      const obj = JSON.parse(text.value);
      Object.entries(obj).forEach(([k, v]) => {
        try {
          setPref(k as any, v as any);
        } catch (e) {
          // 忽略无法设置的项，继续处理其他项
          return;
        }
      });
      new ztoolkit.ProgressWindow(getString("settings-data-import-title"))
        .createLine({
          text: getString("settings-data-import-success"),
          type: "success",
        })
        .show();
      this.render();
    } catch (e: any) {
      new ztoolkit.ProgressWindow(getString("settings-data-import-title"))
        .createLine({
          text: getString("settings-data-import-parse-failed", {
            args: { message: e.message },
          }),
          type: "fail",
        })
        .show();
    }
  }

  private resetAll(): void {
    const ok = Services.prompt.confirm(
      Zotero.getMainWindow() as any,
      getString("settings-data-reset-title"),
      getString("settings-data-reset-confirm"),
    );
    if (!ok) return;

    // 恢复常用项
    setPref("summaryPrompt", getDefaultSummaryPrompt());
    setPref("provider", "openai-compat");
    setPref("openaiApiUrl", "https://api.openai.com/v1/responses");
    setPref("openaiApiKey", "");
    setPref("openaiApiModel", "gpt-5");
    setPref("temperature", "0.7");
    setPref("maxTokens", "81920");
    setPref("topP", "1.0");
    setPref("reasoningEffort", "default");
    setPref("enableTemperature", false as any);
    setPref("enableMaxTokens", false as any);
    setPref("enableTopP", false as any);
    setPref("stream", true as any);
    setPref("theme", "system");
    setPref("fontSize", "14");
    setPref("autoScroll", true as any);
    setPref("openTaskPanelOnSummon" as any, false as any);
    setPref("windowWidth", "900");
    setPref("windowHeight", "650");
    setPref("maxRetries", "3");
    setPref("batchSize", "1");
    setPref("batchInterval", "60");
    clearPref("customPrompts");
    clearPref("multiRoundPromptTemplates");
    clearPref("multiRoundPromptTemplateId");

    // 任务队列本地存储
    Zotero.Prefs.clear("extensions.zotero.aibutler.taskQueue", true);

    new ztoolkit.ProgressWindow(getString("settings-data-progress-title"))
      .createLine({
        text: getString("settings-data-reset-done"),
        type: "success",
      })
      .show();
    this.render();
  }

  /**
   * 清空指定类型的空 AI 笔记
   *
   * 扫描库中所有论文，删除只有标题没有实际内容的 AI 笔记
   */
  private async clearEmptyNotes(kind: AiNoteKind): Promise<void> {
    const label =
      kind === "summary"
        ? getString("settings-data-note-kind-summary")
        : getString("settings-data-note-kind-deep-read");
    const ok = Services.prompt.confirm(
      Zotero.getMainWindow() as any,
      getString("settings-data-clear-empty-title", { args: { label } }),
      getString("settings-data-clear-empty-confirm", { args: { label } }),
    );
    if (!ok) return;

    let deletedCount = 0;
    let scannedCount = 0;

    try {
      // 获取所有条目
      const allItems = await Zotero.Items.getAll(
        Zotero.Libraries.userLibraryID,
      );

      for (const item of allItems) {
        // 跳过非普通条目（如笔记、附件等）
        if (!item.isRegularItem()) continue;

        scannedCount++;
        const noteIDs = (item as any).getNotes?.() || [];

        for (const noteID of noteIDs) {
          const note = await Zotero.Items.getAsync(noteID);
          if (!note) continue;

          const tags: Array<{ tag: string }> = (note as any).getTags?.() || [];
          const noteHtml: string = (note as any).getNote?.() || "";

          const isTargetNote =
            kind === "summary"
              ? isRegularSummaryNote(tags, noteHtml)
              : isDeepReadNote(tags, noteHtml);
          if (!isTargetNote) continue;

          // 检查笔记内容是否为空
          // 移除标题和包装标签后检查剩余内容
          const contentWithoutTitle = noteHtml
            .replace(/<h2>.*?<\/h2>/gi, "")
            .replace(/<div>|<\/div>/gi, "")
            .replace(/<[^>]+>/g, "") // 移除所有 HTML 标签
            .trim();

          if (!contentWithoutTitle) {
            // 这是一个空笔记，删除它
            await (note as any).eraseTx?.();
            deletedCount++;
          }
        }
      }

      new ztoolkit.ProgressWindow(getString("settings-data-progress-title"))
        .createLine({
          text: getString("settings-data-clear-empty-done", {
            args: { scanned: scannedCount, deleted: deletedCount, label },
          }),
          type: "success",
        })
        .show();
    } catch (error: any) {
      ztoolkit.log(`[AI Butler] 清空空 ${label} 失败:`, error);
      new ztoolkit.ProgressWindow(getString("settings-data-progress-title"))
        .createLine({
          text: getString("settings-data-operation-failed", {
            args: { message: error.message },
          }),
          type: "fail",
        })
        .show();
    }
  }
}
