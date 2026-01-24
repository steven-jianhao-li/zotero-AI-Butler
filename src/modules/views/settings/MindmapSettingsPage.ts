/**
 * 思维导图设置页面
 *
 * 提供思维导图提示词模板和导出路径配置
 *
 * @file MindmapSettingsPage.ts
 * @author AI Butler Team
 */

import { getPref, setPref } from "../../../utils/prefs";
import {
  createFormGroup,
  createTextarea,
  createStyledButton,
  createSectionTitle,
  createNotice,
  createInput,
} from "../ui/components";
import { getDefaultMindmapPrompt } from "../../../utils/prompts";

/**
 * 思维导图设置页面类
 */
export class MindmapSettingsPage {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * 创建元素辅助方法
   */
  private createElement(
    tag: string,
    options: {
      textContent?: string;
      innerHTML?: string;
      styles?: Partial<CSSStyleDeclaration>;
      id?: string;
    } = {},
  ): HTMLElement {
    const doc = this.container.ownerDocument || Zotero.getMainWindow().document;
    const el = doc.createElement(tag);
    if (options.textContent) el.textContent = options.textContent;
    if (options.innerHTML) el.innerHTML = options.innerHTML;
    if (options.id) el.id = options.id;
    if (options.styles) {
      Object.assign(el.style, options.styles);
    }
    return el;
  }

  /**
   * 渲染页面
   */
  render(): void {
    this.container.innerHTML = "";

    // 页面标题
    const title = this.createElement("h2", {
      textContent: "🧠 思维导图设置",
      styles: {
        color: "var(--ai-accent)",
        marginBottom: "20px",
        fontSize: "20px",
        borderBottom: "2px solid var(--ai-accent)",
        paddingBottom: "10px",
      },
    });
    this.container.appendChild(title);

    // 说明文字
    const description = this.createElement("p", {
      textContent:
        "配置思维导图生成的提示词模板和导出文件路径。自定义提示词可以改变思维导图的结构和内容风格。",
      styles: {
        color: "var(--ai-text-muted)",
        fontSize: "13px",
        marginBottom: "20px",
        lineHeight: "1.5",
      },
    });
    this.container.appendChild(description);

    // 表单容器
    const form = this.createElement("div", {
      styles: {
        maxWidth: "800px",
      },
    });

    // ==================== 提示词模板 ====================
    form.appendChild(createSectionTitle("📝 提示词模板"));

    // 提示信息
    const promptNotice = createNotice(
      "提示词决定了思维导图的结构。默认包含四个大类（研究背景、研究方法、关键结果、结论），您可以自由修改。留空使用默认模板。",
      "info",
    );
    form.appendChild(promptNotice);

    // 提示词编辑器
    const savedPrompt = (getPref("mindmapPrompt" as any) as string) || "";
    const defaultPrompt = getDefaultMindmapPrompt();
    const isUsingDefaultPrompt = !savedPrompt.trim();
    const effectivePrompt = isUsingDefaultPrompt ? defaultPrompt : savedPrompt;

    const promptStatus = this.createElement("div", {
      textContent: isUsingDefaultPrompt
        ? "当前使用：默认提示词（未保存自定义）"
        : "当前使用：自定义提示词",
      styles: {
        fontSize: "12px",
        color: "var(--ai-text-muted)",
        marginBottom: "8px",
      },
    });
    form.appendChild(promptStatus);
    const promptTextarea = createTextarea(
      "mindmapPrompt",
      effectivePrompt,
      15, // 行数
      "留空使用默认提示词模板...",
    );
    promptTextarea.style.fontFamily = "monospace";
    promptTextarea.style.fontSize = "12px";
    promptTextarea.style.lineHeight = "1.5";
    promptTextarea.style.width = "100%";

    const promptGroup = createFormGroup("提示词内容", promptTextarea);
    form.appendChild(promptGroup);

    // 按钮组
    const promptButtonGroup = this.createElement("div", {
      styles: {
        display: "flex",
        gap: "10px",
        marginTop: "15px",
      },
    });

    // 查看默认提示词按钮
    const viewDefaultBtn = createStyledButton(
      "查看默认提示词",
      "#9e9e9e",
      "medium",
    );
    viewDefaultBtn.addEventListener("click", () => {
      promptTextarea.value = defaultPrompt;
      promptStatus.textContent = "当前编辑：默认提示词（未保存）";
    });
    promptButtonGroup.appendChild(viewDefaultBtn);

    // 清空按钮（使用默认）
    const clearBtn = createStyledButton("使用默认", "#ff9800", "medium");
    clearBtn.addEventListener("click", () => {
      promptTextarea.value = defaultPrompt;
      setPref("mindmapPrompt" as any, "" as any);
      promptStatus.textContent = "当前使用：默认提示词（未保存自定义）";
      this.showToast("已重置为默认提示词");
    });
    promptButtonGroup.appendChild(clearBtn);

    // 保存按钮
    const savePromptBtn = createStyledButton("保存提示词", "#4caf50", "medium");
    savePromptBtn.addEventListener("click", () => {
      const value = promptTextarea.value.trim();
      const defaultTrimmed = defaultPrompt.trim();

      // Empty or unchanged default prompt means "use default" (keep pref empty)
      if (!value || value === defaultTrimmed) {
        setPref("mindmapPrompt" as any, "" as any);
        promptTextarea.value = defaultPrompt;
        promptStatus.textContent = "当前使用：默认提示词（未保存自定义）";
        this.showToast("已使用默认提示词");
        return;
      }

      setPref("mindmapPrompt" as any, value as any);
      promptStatus.textContent = "当前使用：自定义提示词";
      this.showToast("提示词已保存");
    });
    promptButtonGroup.appendChild(savePromptBtn);

    form.appendChild(promptButtonGroup);

    // ==================== 导出路径设置 ====================
    const exportDivider = this.createElement("div", {
      styles: {
        marginTop: "30px",
      },
    });
    form.appendChild(exportDivider);

    form.appendChild(createSectionTitle("📂 导出路径设置"));

    // 说明
    const exportNotice = createNotice(
      "设置思维导图导出（PNG/OPML）的默认保存路径。留空默认保存到桌面。",
      "info",
    );
    form.appendChild(exportNotice);

    // 路径输入
    const currentPath = (getPref("mindmapExportPath" as any) as string) || "";
    const pathInput = createInput(
      "mindmapExportPath",
      "text",
      currentPath,
      "留空使用桌面目录...",
    );
    pathInput.style.width = "100%";

    const pathGroup = createFormGroup("导出路径", pathInput);
    form.appendChild(pathGroup);

    // 路径按钮组
    const pathButtonGroup = this.createElement("div", {
      styles: {
        display: "flex",
        gap: "10px",
        marginTop: "15px",
      },
    });

    // 浏览按钮
    const browseBtn = createStyledButton("浏览...", "#2196f3", "medium");
    browseBtn.addEventListener("click", async () => {
      try {
        // 使用 Zotero 文件夹选择器
        const fp = (Components.classes as any)[
          "@mozilla.org/filepicker;1"
        ].createInstance(Components.interfaces.nsIFilePicker);
        const win = Zotero.getMainWindow();
        fp.init(win, "选择导出目录", fp.modeGetFolder);

        const result = await new Promise<number>((resolve) => {
          fp.open((res: number) => resolve(res));
        });

        if (result === fp.returnOK) {
          const selectedPath = fp.file.path;
          (pathInput as HTMLInputElement).value = selectedPath;
          setPref("mindmapExportPath" as any, selectedPath as any);
          this.showToast("导出路径已保存");
        }
      } catch (e) {
        ztoolkit.log("[AI-Butler] 选择导出目录失败:", e);
        this.showToast("选择目录失败，请手动输入路径");
      }
    });
    pathButtonGroup.appendChild(browseBtn);

    // 重置为桌面
    const resetPathBtn = createStyledButton("重置为桌面", "#ff9800", "medium");
    resetPathBtn.addEventListener("click", () => {
      (pathInput as HTMLInputElement).value = "";
      setPref("mindmapExportPath" as any, "" as any);
      this.showToast("已重置为桌面目录");
    });
    pathButtonGroup.appendChild(resetPathBtn);

    // 保存路径按钮
    const savePathBtn = createStyledButton("保存路径", "#4caf50", "medium");
    savePathBtn.addEventListener("click", () => {
      const value = (pathInput as HTMLInputElement).value.trim();
      setPref("mindmapExportPath" as any, value as any);
      this.showToast("导出路径已保存");
    });
    pathButtonGroup.appendChild(savePathBtn);

    form.appendChild(pathButtonGroup);

    // ==================== 配置预览 ====================
    const previewDivider = this.createElement("div", {
      styles: {
        marginTop: "30px",
      },
    });
    form.appendChild(previewDivider);

    form.appendChild(createSectionTitle("📊 当前配置预览"));

    const previewBox = this.createElement("div", {
      styles: {
        background: "var(--ai-surface-2)",
        border: "1px solid var(--ai-border)",
        borderRadius: "8px",
        padding: "15px",
        fontSize: "13px",
        lineHeight: "1.6",
      },
    });

    const promptPref = (getPref("mindmapPrompt" as any) as string) || "";
    const promptText = promptPref.trim() ? promptPref : defaultPrompt;
    const promptPreview =
      promptText.length > 100
        ? promptText.substring(0, 100) + "..."
        : promptText;
    const promptLabel = promptPref.trim() ? "自定义" : "默认";
    const path = (getPref("mindmapExportPath" as any) as string) || "(桌面)";

    previewBox.innerHTML = `
      <div style="margin-bottom: 10px;">
        <strong>提示词：</strong>
        <span style="color: var(--ai-text-muted);">
          (${promptLabel}) ${this.escapeHtml(promptPreview)}
        </span>
      </div>
      <div>
        <strong>导出路径：</strong>
        <span style="color: var(--ai-text-muted);">${path}</span>
      </div>
    `;

    form.appendChild(previewBox);

    this.container.appendChild(form);
  }

  /**
   * 显示提示消息
   */
  private showToast(message: string): void {
    new ztoolkit.ProgressWindow("思维导图设置")
      .createLine({
        text: message,
        type: "success",
      })
      .show();
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}

export default MindmapSettingsPage;
