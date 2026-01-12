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
import { TaskQueueManager } from "../../taskQueue";
import { getDefaultSummaryPrompt } from "../../../utils/prompts";

export class DataSettingsPage {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public render(): void {
    this.container.innerHTML = "";

    const title = Zotero.getMainWindow().document.createElement("h2");
    title.textContent = "💾 数据管理";
    Object.assign(title.style, {
      color: "#59c0bc",
      marginBottom: "20px",
      fontSize: "20px",
      borderBottom: "2px solid #59c0bc",
      paddingBottom: "10px",
    });
    this.container.appendChild(title);

    this.container.appendChild(
      createNotice("包含任务队列清理、设置导入/导出与一键重置等工具。"),
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
      { label: "总任务", val: stats.total.toString(), icon: "📊" },
      { label: "已完成", val: stats.completed.toString(), icon: "✅" },
      { label: "失败", val: stats.failed.toString(), icon: "⚠️" },
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
    const btnClearDone = createStyledButton("🧹 清空已完成任务", "#9e9e9e");
    btnClearDone.addEventListener("click", async () => {
      await TaskQueueManager.getInstance().clearCompleted();
      this.render();
      new ztoolkit.ProgressWindow("数据管理")
        .createLine({ text: "已清空已完成任务", type: "success" })
        .show();
    });
    const btnClearAll = createStyledButton("🗑️ 清空所有任务", "#f44336");
    btnClearAll.addEventListener("click", async () => {
      const ok = Services.prompt.confirm(
        Zotero.getMainWindow() as any,
        "清空任务",
        "确定清空所有任务吗?",
      );
      if (!ok) return;
      await TaskQueueManager.getInstance().clearAll();
      this.render();
      new ztoolkit.ProgressWindow("数据管理")
        .createLine({ text: "所有任务已清空", type: "success" })
        .show();
    });
    const btnClearEmptyNotes = createStyledButton(
      "🧹 清空空笔记",
      "#ff9800",
    );
    btnClearEmptyNotes.addEventListener("click", () => this.clearEmptyNotes());
    row1.appendChild(btnClearDone);
    row1.appendChild(btnClearAll);
    row1.appendChild(btnClearEmptyNotes);
    section.appendChild(row1);

    // 设置导出/导入
    const row2 = Zotero.getMainWindow().document.createElement("div");
    Object.assign(row2.style, {
      display: "flex",
      gap: "12px",
      marginBottom: "12px",
    });
    const btnExport = createStyledButton("📤 导出设置(JSON)", "#2196f3");
    btnExport.addEventListener("click", () => this.exportSettings());
    const btnImport = createStyledButton("📥 导入设置(JSON)", "#673ab7");
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
    const btnResetAll = createStyledButton("♻️ 恢复所有默认设置", "#9e9e9e");
    btnResetAll.addEventListener("click", () => this.resetAll());
    section.appendChild(row3);
    row3.appendChild(btnResetAll);

    this.container.appendChild(section);
  }

  private getStats() {
    const q = TaskQueueManager.getInstance();
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
      "stream",
      "summaryPrompt",
      "customPrompts",
      "maxRetries",
      "batchSize",
      "batchInterval",
      "autoScan",
      "scanInterval",
      "pdfProcessMode",
      "theme",
      "fontSize",
      "autoScroll",
      "windowWidth",
      "windowHeight",
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
    const close = createStyledButton("关闭", "#9e9e9e");
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
      "导入设置",
      "粘贴 JSON: ",
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
      new ztoolkit.ProgressWindow("导入设置")
        .createLine({ text: "✅ 导入成功", type: "success" })
        .show();
      this.render();
    } catch (e: any) {
      new ztoolkit.ProgressWindow("导入设置")
        .createLine({ text: `❌ 解析失败: ${e.message}`, type: "fail" })
        .show();
    }
  }

  private resetAll(): void {
    const ok = Services.prompt.confirm(
      Zotero.getMainWindow() as any,
      "恢复默认",
      "将重置大多数插件设置,继续吗?",
    );
    if (!ok) return;

    // 恢复常用项
    setPref("summaryPrompt", getDefaultSummaryPrompt());
    setPref("provider", "openai");
    setPref("openaiApiUrl", "https://api.openai.com/v1/responses");
    setPref("openaiApiKey", "");
    setPref("openaiApiModel", "gpt-5");
    setPref("temperature", "0.7");
    setPref("maxTokens", "4096");
    setPref("topP", "1.0");
    setPref("enableTemperature", true as any);
    setPref("enableMaxTokens", true as any);
    setPref("enableTopP", true as any);
    setPref("stream", true as any);
    setPref("theme", "system");
    setPref("fontSize", "14");
    setPref("autoScroll", true as any);
    setPref("windowWidth", "900");
    setPref("windowHeight", "650");
    setPref("maxRetries", "3");
    setPref("batchSize", "1");
    setPref("batchInterval", "60");
    clearPref("customPrompts");

    // 任务队列本地存储
    Zotero.Prefs.clear("extensions.zotero.aibutler.taskQueue", true);

    new ztoolkit.ProgressWindow("数据管理")
      .createLine({ text: "✅ 已恢复默认设置", type: "success" })
      .show();
    this.render();
  }

  /**
   * 清空所有空的 AI 笔记
   *
   * 扫描库中所有论文，删除只有标题没有实际内容的 AI 笔记
   */
  private async clearEmptyNotes(): Promise<void> {
    const ok = Services.prompt.confirm(
      Zotero.getMainWindow() as any,
      "清空空笔记",
      "此操作将扫描库中所有论文，删除只有标题没有实际内容的 AI 笔记。\n\n确定继续吗？",
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

          // 检查是否是 AI 生成的笔记
          const tags: Array<{ tag: string }> = (note as any).getTags?.() || [];
          const hasTag = tags.some((t) => t.tag === "AI-Generated");
          const noteHtml: string = (note as any).getNote?.() || "";
          const titleMatch = /<h2>\s*AI 管家\s*-/.test(noteHtml);

          if (!hasTag && !titleMatch) continue;

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

      new ztoolkit.ProgressWindow("数据管理")
        .createLine({
          text: `✅ 已扫描 ${scannedCount} 篇论文，删除 ${deletedCount} 个空笔记`,
          type: "success",
        })
        .show();
    } catch (error: any) {
      ztoolkit.log("[AI Butler] 清空空笔记失败:", error);
      new ztoolkit.ProgressWindow("数据管理")
        .createLine({
          text: `❌ 操作失败: ${error.message}`,
          type: "fail",
        })
        .show();
    }
  }
}
