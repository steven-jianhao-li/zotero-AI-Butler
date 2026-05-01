/**
 * UI 设置页面
 */

import { getPref, setPref } from "../../../utils/prefs";
import { AutoScanManager } from "../../autoScanManager";
import {
  CONTEXT_MENU_ITEMS,
  DEFAULT_CONTEXT_MENU_ITEM_VISIBILITY,
  DEFAULT_SIDEBAR_MODULE_VISIBILITY,
  SIDEBAR_MODULES,
  getContextMenuItemOrder,
  getContextMenuItemVisibility,
  getSidebarModuleOrder,
  getSidebarModuleVisibility,
  resetUICustomizationPrefs,
  setContextMenuItemOrder,
  setContextMenuItemVisibility,
  setSidebarModuleOrder,
  setSidebarModuleVisibility,
  type ContextMenuItemId,
  type ContextMenuVisibility,
  type SidebarModuleId,
  type SidebarModuleVisibility,
} from "../../uiCustomization";
import {
  createFormGroup,
  createSelect,
  createSlider,
  createInput,
  createCheckbox,
  createStyledButton,
  createNotice,
} from "../ui/components";

export class UiSettingsPage {
  private container: HTMLElement;
  private preview!: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public render(): void {
    this.container.innerHTML = "";

    const title = Zotero.getMainWindow().document.createElement("h2");
    title.textContent = "🎨 界面设置";
    Object.assign(title.style, {
      color: "#59c0bc",
      marginBottom: "20px",
      fontSize: "20px",
      borderBottom: "2px solid #59c0bc",
      paddingBottom: "10px",
    });
    this.container.appendChild(title);

    this.container.appendChild(
      createNotice(
        "界面与行为设置：自动滚动、自动扫描；以及已有 AI 笔记时的处理策略。",
      ),
    );

    const form = Zotero.getMainWindow().document.createElement("div");
    Object.assign(form.style, { maxWidth: "820px" });

    // 自动滚动
    const autoScroll = (getPref("autoScroll") as boolean) ?? true;
    const autoScrollBox = createCheckbox("autoScroll", !!autoScroll);
    form.appendChild(
      createFormGroup(
        "自动滚动到最新输出",
        autoScrollBox,
        "生成笔记时，自动滚动到输出窗口底部",
      ),
    );

    // 自动扫描
    const autoScan = (getPref("autoScan") as boolean) ?? true;
    const autoScanBox = createCheckbox("autoScan", !!autoScan);
    form.appendChild(
      createFormGroup(
        "自动扫描新文献",
        autoScanBox,
        "监听文献库变化，新加入的文献自动加入分析队列",
      ),
    );

    // 保存对话历史
    const saveChatHistory = (getPref("saveChatHistory") as boolean) ?? true;
    const saveChatHistoryBox = createCheckbox(
      "saveChatHistory",
      !!saveChatHistory,
    );
    form.appendChild(
      createFormGroup(
        "保存追问对话记录",
        saveChatHistoryBox,
        "开启后，追问对话的内容会自动保存到论文的 AI 管家笔记中",
      ),
    );

    // 笔记管理策略
    const policy = (
      (getPref("noteStrategy" as any) as string) || "skip"
    ).toString();
    const policySelect = createSelect(
      "notePolicy",
      [
        { value: "skip", label: "跳过(默认)" },
        { value: "overwrite", label: "覆盖" },
        { value: "append", label: "追加" },
      ],
      policy,
    );
    form.appendChild(
      createFormGroup(
        "已有 AI 笔记时的策略",
        policySelect,
        "当检测到条目已有 AI 总结笔记时该如何处理",
      ),
    );

    // 表格管理策略
    const tablePolicy = (
      (getPref("tableStrategy" as any) as string) || "skip"
    ).toString();
    const tablePolicySelect = createSelect(
      "tablePolicy",
      [
        { value: "skip", label: "跳过(默认)" },
        { value: "overwrite", label: "覆盖" },
      ],
      tablePolicy,
    );
    form.appendChild(
      createFormGroup(
        "已有 AI 表格时的策略",
        tablePolicySelect,
        "当检测到条目已有 AI 填表笔记时该如何处理",
      ),
    );

    // Markdown 笔记样式主题
    const currentTheme = (
      (getPref("markdownTheme" as any) as string) || "github"
    ).toString();
    const themeSelect = createSelect(
      "markdownTheme",
      [
        { value: "github", label: "GitHub (默认)" },
        { value: "redstriking", label: "红印 (Redstriking)" },
        // 更多主题可在此添加
      ],
      currentTheme,
    );
    form.appendChild(
      createFormGroup(
        "侧边栏笔记样式",
        themeSelect,
        "设置侧边栏 AI 笔记的 Markdown 渲染样式",
      ),
    );

    const contextMenuVisibilityDraft = getContextMenuItemVisibility();
    let contextMenuOrderDraft = getContextMenuItemOrder();
    form.appendChild(
      this.createContextMenuSection(
        contextMenuVisibilityDraft,
        () => contextMenuOrderDraft,
        (nextOrder) => {
          contextMenuOrderDraft = nextOrder;
        },
      ),
    );

    const sidebarVisibilityDraft = getSidebarModuleVisibility();
    let sidebarOrderDraft = getSidebarModuleOrder();
    form.appendChild(
      this.createSidebarModuleSection(
        sidebarVisibilityDraft,
        () => sidebarOrderDraft,
        (nextOrder) => {
          sidebarOrderDraft = nextOrder;
        },
      ),
    );

    // 预览区域（移除字号预览，不再提供字体大小设置）

    // 按钮
    const actions = Zotero.getMainWindow().document.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      gap: "12px",
      marginTop: "16px",
    });
    const btnSave = createStyledButton("💾 保存设置", "#4caf50");
    btnSave.addEventListener("click", async () => {
      const autoVal =
        (form.querySelector("#setting-autoScroll") as HTMLInputElement)
          ?.checked ?? true;
      const autoScanVal =
        (form.querySelector("#setting-autoScan") as HTMLInputElement)
          ?.checked ?? true;
      const saveChatHistoryVal =
        (form.querySelector("#setting-saveChatHistory") as HTMLInputElement)
          ?.checked ?? true;
      const policyVal = (policySelect as any).getValue
        ? (policySelect as any).getValue()
        : policy;
      const tablePolicyVal = (tablePolicySelect as any).getValue
        ? (tablePolicySelect as any).getValue()
        : tablePolicy;
      const themeVal = (themeSelect as any).getValue
        ? (themeSelect as any).getValue()
        : currentTheme;

      setPref("autoScroll", !!autoVal as any);
      setPref("autoScan", !!autoScanVal as any);
      setPref("saveChatHistory", !!saveChatHistoryVal as any);
      setPref("noteStrategy" as any, policyVal);
      setPref("tableStrategy" as any, tablePolicyVal);
      setPref("markdownTheme" as any, themeVal);

      setContextMenuItemVisibility(contextMenuVisibilityDraft);
      setContextMenuItemOrder(contextMenuOrderDraft);
      setSidebarModuleVisibility(sidebarVisibilityDraft);
      setSidebarModuleOrder(sidebarOrderDraft);

      // 清除主题缓存以便下次加载新主题
      const { themeManager } = await import("../../themeManager");
      themeManager.setCurrentTheme(themeVal);
      themeManager.clearCache();

      // 重新加载自动扫描管理器
      AutoScanManager.getInstance().reload();
      await this.applyLiveUICustomization();

      new ztoolkit.ProgressWindow("界面设置")
        .createLine({ text: "✅ 设置已保存", type: "success" })
        .show();
    });

    const btnReset = createStyledButton("🔄 重置默认", "#9e9e9e");
    btnReset.addEventListener("click", async () => {
      setPref("autoScroll", true as any);
      setPref("autoScan", true as any);
      setPref("saveChatHistory", true as any);
      setPref("noteStrategy" as any, "skip");
      setPref("tableStrategy" as any, "skip");
      resetUICustomizationPrefs();
      AutoScanManager.getInstance().reload();
      await this.applyLiveUICustomization();
      this.render();
      new ztoolkit.ProgressWindow("界面设置")
        .createLine({ text: "已重置为默认", type: "success" })
        .show();
    });
    actions.appendChild(btnSave);
    actions.appendChild(btnReset);
    form.appendChild(actions);

    this.container.appendChild(form);

    // 无字号预览
  }

  private applyPreview(fontSize: number): void {
    if (!this.preview) return;
    this.preview.style.fontSize = `${fontSize}px`;
  }

  private createSettingsPanel(title: string, description: string): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const panel = doc.createElement("div");
    Object.assign(panel.style, {
      border: "1px solid var(--ai-border)",
      borderRadius: "6px",
      padding: "14px",
      marginBottom: "24px",
      background: "var(--ai-surface)",
    });

    const heading = doc.createElement("div");
    heading.textContent = title;
    Object.assign(heading.style, {
      fontSize: "15px",
      fontWeight: "600",
      color: "var(--ai-text)",
      marginBottom: "6px",
    });

    const desc = doc.createElement("div");
    desc.textContent = description;
    Object.assign(desc.style, {
      fontSize: "12px",
      color: "var(--ai-text-muted)",
      lineHeight: "1.5",
      marginBottom: "12px",
    });

    panel.appendChild(heading);
    panel.appendChild(desc);
    return panel;
  }

  private createContextMenuSection(
    visibilityDraft: ContextMenuVisibility,
    getOrder: () => ContextMenuItemId[],
    setOrder: (order: ContextMenuItemId[]) => void,
  ): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const panel = this.createSettingsPanel(
      "右键菜单个性化",
      "关闭不常用入口，并用上下按钮调整它们在 Zotero 右键菜单里的顺序。",
    );

    const list = doc.createElement("div");
    Object.assign(list.style, {
      display: "grid",
      gap: "8px",
    });

    const renderRows = () => {
      list.innerHTML = "";
      const order = getOrder();
      order.forEach((itemId, index) => {
        const item = CONTEXT_MENU_ITEMS.find((entry) => entry.id === itemId);
        if (!item) return;

        const row = doc.createElement("div");
        Object.assign(row.style, {
          display: "grid",
          gridTemplateColumns: "auto 1fr auto auto",
          gap: "10px",
          alignItems: "center",
          padding: "8px 10px",
          border: "1px solid rgba(128, 128, 128, 0.2)",
          borderRadius: "5px",
        });

        const checkbox = doc.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked =
          visibilityDraft[item.id] ??
          DEFAULT_CONTEXT_MENU_ITEM_VISIBILITY[item.id];
        checkbox.id = `setting-context-menu-${item.id}`;
        Object.assign(checkbox.style, {
          width: "18px",
          height: "18px",
          cursor: "pointer",
        });
        checkbox.addEventListener("change", () => {
          visibilityDraft[item.id] = checkbox.checked;
        });

        const textWrap = doc.createElement("div");
        const label = doc.createElement("div");
        label.textContent = item.label;
        Object.assign(label.style, {
          fontSize: "13px",
          fontWeight: "600",
          color: "var(--ai-text)",
        });

        const desc = doc.createElement("div");
        desc.textContent = item.description;
        Object.assign(desc.style, {
          marginTop: "3px",
          fontSize: "12px",
          color: "var(--ai-text-muted)",
          lineHeight: "1.35",
        });
        textWrap.appendChild(label);
        textWrap.appendChild(desc);

        const scope = doc.createElement("span");
        scope.textContent = item.scope === "collection" ? "分类" : "文献";
        Object.assign(scope.style, {
          padding: "2px 6px",
          borderRadius: "4px",
          fontSize: "11px",
          color: "#59c0bc",
          background: "rgba(89, 192, 188, 0.12)",
          whiteSpace: "nowrap",
        });

        const orderControls = this.createOrderControls(
          index,
          order.length,
          () => {
            const nextOrder = [...getOrder()];
            [nextOrder[index - 1], nextOrder[index]] = [
              nextOrder[index],
              nextOrder[index - 1],
            ];
            setOrder(nextOrder);
            renderRows();
          },
          () => {
            const nextOrder = [...getOrder()];
            [nextOrder[index], nextOrder[index + 1]] = [
              nextOrder[index + 1],
              nextOrder[index],
            ];
            setOrder(nextOrder);
            renderRows();
          },
        );

        row.appendChild(checkbox);
        row.appendChild(textWrap);
        row.appendChild(scope);
        row.appendChild(orderControls);
        list.appendChild(row);
      });
    };

    renderRows();
    panel.appendChild(list);
    return panel;
  }

  private createSidebarModuleSection(
    visibilityDraft: SidebarModuleVisibility,
    getOrder: () => SidebarModuleId[],
    setOrder: (order: SidebarModuleId[]) => void,
  ): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const panel = this.createSettingsPanel(
      "侧边栏功能与排序",
      "勾选要显示的条目侧边栏功能，用上下按钮调整它们在侧边栏里的出现顺序。",
    );

    const list = doc.createElement("div");
    Object.assign(list.style, {
      display: "grid",
      gap: "8px",
    });

    const renderRows = () => {
      list.innerHTML = "";
      const order = getOrder();
      order.forEach((moduleId, index) => {
        const module = SIDEBAR_MODULES.find((item) => item.id === moduleId);
        if (!module) return;

        const row = doc.createElement("div");
        Object.assign(row.style, {
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          gap: "10px",
          alignItems: "center",
          padding: "8px 10px",
          border: "1px solid rgba(128, 128, 128, 0.2)",
          borderRadius: "5px",
        });

        const checkbox = doc.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked =
          visibilityDraft[moduleId] ??
          DEFAULT_SIDEBAR_MODULE_VISIBILITY[moduleId];
        checkbox.id = `setting-sidebar-module-${moduleId}`;
        Object.assign(checkbox.style, {
          width: "18px",
          height: "18px",
          cursor: "pointer",
        });
        checkbox.addEventListener("change", () => {
          visibilityDraft[moduleId] = checkbox.checked;
        });

        const textWrap = doc.createElement("div");
        const label = doc.createElement("div");
        label.textContent = module.label;
        Object.assign(label.style, {
          fontSize: "13px",
          fontWeight: "600",
          color: "var(--ai-text)",
        });

        const desc = doc.createElement("div");
        desc.textContent = module.description;
        Object.assign(desc.style, {
          marginTop: "3px",
          fontSize: "12px",
          color: "var(--ai-text-muted)",
          lineHeight: "1.35",
        });
        textWrap.appendChild(label);
        textWrap.appendChild(desc);

        const orderControls = this.createOrderControls(
          index,
          order.length,
          () => {
            const nextOrder = [...getOrder()];
            [nextOrder[index - 1], nextOrder[index]] = [
              nextOrder[index],
              nextOrder[index - 1],
            ];
            setOrder(nextOrder);
            renderRows();
          },
          () => {
            const nextOrder = [...getOrder()];
            [nextOrder[index], nextOrder[index + 1]] = [
              nextOrder[index + 1],
              nextOrder[index],
            ];
            setOrder(nextOrder);
            renderRows();
          },
        );

        row.appendChild(checkbox);
        row.appendChild(textWrap);
        row.appendChild(orderControls);
        list.appendChild(row);
      });
    };

    renderRows();
    panel.appendChild(list);
    return panel;
  }

  private createOrderControls(
    index: number,
    length: number,
    onMoveUp: () => void,
    onMoveDown: () => void,
  ): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const orderControls = doc.createElement("div");
    Object.assign(orderControls.style, {
      display: "flex",
      gap: "6px",
    });

    const upBtn = this.createOrderButton("↑", "上移", index === 0);
    upBtn.addEventListener("click", () => {
      if (index === 0) return;
      onMoveUp();
    });

    const downBtn = this.createOrderButton("↓", "下移", index === length - 1);
    downBtn.addEventListener("click", () => {
      if (index === length - 1) return;
      onMoveDown();
    });

    orderControls.appendChild(upBtn);
    orderControls.appendChild(downBtn);
    return orderControls;
  }

  private createOrderButton(
    text: string,
    title: string,
    disabled: boolean,
  ): HTMLButtonElement {
    const doc = Zotero.getMainWindow().document;
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.title = title;
    button.disabled = disabled;
    Object.assign(button.style, {
      width: "28px",
      height: "28px",
      border: "1px solid #59c0bc",
      borderRadius: "4px",
      background: disabled ? "rgba(128, 128, 128, 0.08)" : "transparent",
      color: disabled ? "var(--ai-text-muted)" : "#59c0bc",
      cursor: disabled ? "default" : "pointer",
      fontSize: "14px",
      lineHeight: "1",
    });
    return button;
  }

  private async applyLiveUICustomization(): Promise<void> {
    try {
      const { refreshCurrentItemPaneSection } =
        await import("../../ItemPaneSection");
      await refreshCurrentItemPaneSection();
    } catch (error) {
      ztoolkit.log("[AI-Butler] 刷新侧边栏个性化设置失败:", error);
    }

    try {
      const win = Zotero.getMainWindow();
      const CustomEventCtor = (win as any).CustomEvent || CustomEvent;
      win.dispatchEvent(
        new CustomEventCtor("ai-butler-ui-customization-changed"),
      );
    } catch (error) {
      ztoolkit.log("[AI-Butler] 刷新右键菜单个性化设置失败:", error);
    }
  }
}
