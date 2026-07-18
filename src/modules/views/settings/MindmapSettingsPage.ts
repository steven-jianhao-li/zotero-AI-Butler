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
import {
  getDefaultMindmapPrompt,
  getConfiguredMindmapPrompt,
} from "../../../utils/prompts";
import { getString } from "../../../utils/locale";

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
      textContent: getString("settings-mindmap-title"),
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
      textContent: getString("settings-mindmap-description"),
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
    form.appendChild(
      createSectionTitle(getString("settings-mindmap-prompt-section")),
    );

    // 提示信息
    const promptNotice = createNotice(
      getString("settings-mindmap-prompt-notice"),
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
        ? getString("settings-mindmap-status-using-default")
        : getString("settings-mindmap-status-using-custom"),
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
      getString("settings-mindmap-prompt-placeholder"),
    );
    promptTextarea.style.fontFamily = "monospace";
    promptTextarea.style.fontSize = "12px";
    promptTextarea.style.lineHeight = "1.5";
    promptTextarea.style.width = "100%";

    const promptGroup = createFormGroup(
      getString("settings-mindmap-prompt-content"),
      promptTextarea,
    );
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
      getString("settings-mindmap-view-default-prompt"),
      "#9e9e9e",
      "medium",
    );
    viewDefaultBtn.addEventListener("click", () => {
      promptTextarea.value = defaultPrompt;
      promptStatus.textContent = getString(
        "settings-mindmap-status-editing-default",
      );
    });
    promptButtonGroup.appendChild(viewDefaultBtn);

    // 清空按钮（使用默认）
    const clearBtn = createStyledButton(
      getString("settings-mindmap-use-default"),
      "#ff9800",
      "medium",
    );
    clearBtn.addEventListener("click", () => {
      promptTextarea.value = defaultPrompt;
      setPref("mindmapPrompt" as any, "" as any);
      promptStatus.textContent = getString(
        "settings-mindmap-status-using-default",
      );
      this.showToast(getString("settings-mindmap-toast-reset-default-prompt"));
    });
    promptButtonGroup.appendChild(clearBtn);

    // 保存按钮
    const savePromptBtn = createStyledButton(
      getString("settings-mindmap-save-prompt"),
      "#4caf50",
      "medium",
    );
    savePromptBtn.addEventListener("click", () => {
      const value = promptTextarea.value.trim();
      const defaultTrimmed = defaultPrompt.trim();

      // Empty or unchanged default prompt means "use default" (keep pref empty)
      if (!value || value === defaultTrimmed) {
        setPref("mindmapPrompt" as any, "" as any);
        promptTextarea.value = defaultPrompt;
        promptStatus.textContent = getString(
          "settings-mindmap-status-using-default",
        );
        this.showToast(
          getString("settings-mindmap-toast-using-default-prompt"),
        );
        return;
      }

      setPref("mindmapPrompt" as any, value as any);
      promptStatus.textContent = getString(
        "settings-mindmap-status-using-custom",
      );
      this.showToast(getString("settings-mindmap-toast-prompt-saved"));
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

    form.appendChild(
      createSectionTitle(getString("settings-mindmap-export-section")),
    );

    // 说明
    const exportNotice = createNotice(
      getString("settings-mindmap-export-notice"),
      "info",
    );
    form.appendChild(exportNotice);

    // 路径输入
    const currentPath = (getPref("mindmapExportPath" as any) as string) || "";
    const pathInput = createInput(
      "mindmapExportPath",
      "text",
      currentPath,
      getString("settings-mindmap-export-path-placeholder"),
    );
    pathInput.style.width = "100%";

    const pathGroup = createFormGroup(
      getString("settings-mindmap-export-path"),
      pathInput,
    );
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
    const browseBtn = createStyledButton(
      getString("settings-mindmap-browse"),
      "#2196f3",
      "medium",
    );
    browseBtn.addEventListener("click", async () => {
      try {
        // 使用 Zotero 文件夹选择器
        const fp = (Components.classes as any)[
          "@mozilla.org/filepicker;1"
        ].createInstance(Components.interfaces.nsIFilePicker);
        const win = Zotero.getMainWindow();
        fp.init(
          win,
          getString("settings-mindmap-select-export-folder"),
          fp.modeGetFolder,
        );

        const result = await new Promise<number>((resolve) => {
          fp.open((res: number) => resolve(res));
        });

        if (result === fp.returnOK) {
          const selectedPath = fp.file.path;
          (pathInput as HTMLInputElement).value = selectedPath;
          setPref("mindmapExportPath" as any, selectedPath as any);
          this.showToast(getString("settings-mindmap-toast-export-path-saved"));
        }
      } catch (e) {
        ztoolkit.log("[AI-Butler] 选择导出目录失败:", e);
        this.showToast(
          getString("settings-mindmap-toast-select-folder-failed"),
        );
      }
    });
    pathButtonGroup.appendChild(browseBtn);

    // 重置为桌面
    const resetPathBtn = createStyledButton(
      getString("settings-mindmap-reset-desktop"),
      "#ff9800",
      "medium",
    );
    resetPathBtn.addEventListener("click", () => {
      (pathInput as HTMLInputElement).value = "";
      setPref("mindmapExportPath" as any, "" as any);
      this.showToast(getString("settings-mindmap-toast-reset-desktop"));
    });
    pathButtonGroup.appendChild(resetPathBtn);

    // 保存路径按钮
    const savePathBtn = createStyledButton(
      getString("settings-mindmap-save-path"),
      "#4caf50",
      "medium",
    );
    savePathBtn.addEventListener("click", () => {
      const value = (pathInput as HTMLInputElement).value.trim();
      setPref("mindmapExportPath" as any, value as any);
      this.showToast(getString("settings-mindmap-toast-export-path-saved"));
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

    form.appendChild(
      createSectionTitle(getString("settings-mindmap-preview-section")),
    );

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
    const promptLabel = promptPref.trim()
      ? getString("settings-mindmap-preview-custom")
      : getString("settings-mindmap-preview-default");
    const path =
      (getPref("mindmapExportPath" as any) as string) ||
      getString("settings-mindmap-preview-desktop");

    previewBox.innerHTML = `
      <div style="margin-bottom: 10px;">
        <strong>${getString("settings-mindmap-preview-prompt")}：</strong>
        <span style="color: var(--ai-text-muted);">
          (${promptLabel}) ${this.escapeHtml(promptPreview)}
        </span>
      </div>
      <div>
        <strong>${getString("settings-mindmap-preview-export-path")}：</strong>
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
    new ztoolkit.ProgressWindow(getString("settings-mindmap-title"))
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
