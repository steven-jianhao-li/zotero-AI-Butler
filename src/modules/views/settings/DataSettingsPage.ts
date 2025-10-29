/**
 * 数据管理页面
 */

import { getPref, setPref, clearPref } from "../../../utils/prefs";
import {
  createFormGroup,
  createStyledButton,
  createNotice,
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
    [
      { label: "总任务", val: stats.total },
      { label: "已完成", val: stats.completed },
      { label: "失败", val: stats.failed },
    ].forEach((s) => {
      const card = Zotero.getMainWindow().document.createElement("div");
      Object.assign(card.style, {
        padding: "12px",
        border: "1px solid #eee",
        borderRadius: "6px",
        background: "#fff",
      });
      card.innerHTML = `<div style="font-size:12px;color:#666">${s.label}</div><div style="font-size:18px;font-weight:700;color:#59c0bc">${s.val}</div>`;
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
    row1.appendChild(btnClearDone);
    row1.appendChild(btnClearAll);
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
      "apiKey",
      "apiUrl",
      "model",
      "geminiApiUrl",
      "geminiApiKey",
      "geminiModel",
      "temperature",
      "maxTokens",
      "topP",
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
    setPref("apiUrl", "https://api.openai.com/v1/chat/completions");
    setPref("apiKey", "");
    setPref("model", "gpt-3.5-turbo");
    setPref("temperature", "0.7");
    setPref("maxTokens", "4096");
    setPref("topP", "1.0");
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
}
