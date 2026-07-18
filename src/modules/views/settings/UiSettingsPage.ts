/**
 * UI 设置页面
 */

import { getPref, setPref } from "../../../utils/prefs";
import { getString } from "../../../utils/locale";
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
  isContextMenuCollapsed,
  resetUICustomizationPrefs,
  setContextMenuCollapsed,
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
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public render(): void {
    this.container.innerHTML = "";

    const title = Zotero.getMainWindow().document.createElement("h2");
    title.textContent = getString("settings-ui-title");
    Object.assign(title.style, {
      color: "#59c0bc",
      marginBottom: "20px",
      fontSize: "20px",
      borderBottom: "2px solid #59c0bc",
      paddingBottom: "10px",
    });
    this.container.appendChild(title);

    this.container.appendChild(
      createNotice(getString("settings-ui-description")),
    );

    const form = Zotero.getMainWindow().document.createElement("div");
    Object.assign(form.style, { maxWidth: "820px" });

    // 自动滚动
    const autoScroll = (getPref("autoScroll") as boolean) ?? true;
    const autoScrollBox = createCheckbox("autoScroll", !!autoScroll);
    form.appendChild(
      createFormGroup(
        getString("settings-ui-auto-scroll"),
        autoScrollBox,
        getString("settings-ui-auto-scroll-help"),
      ),
    );

    // 自动扫描
    const autoScan = (getPref("autoScan") as boolean) ?? true;
    const autoScanBox = createCheckbox("autoScan", !!autoScan);
    form.appendChild(
      createFormGroup(
        getString("settings-ui-auto-scan"),
        autoScanBox,
        getString("settings-ui-auto-scan-help"),
      ),
    );

    const autoScanSummary =
      (getPref("autoScanSummaryEnabled" as any) as boolean) ?? true;
    const autoScanSummaryBox = createCheckbox(
      "autoScanSummaryEnabled",
      !!autoScanSummary,
    );
    form.appendChild(
      createFormGroup(
        getString("settings-ui-auto-scan-summary"),
        autoScanSummaryBox,
        getString("settings-ui-auto-scan-summary-help"),
      ),
    );

    const autoScanDeepRead =
      (getPref("autoScanDeepReadEnabled" as any) as boolean) ?? false;
    const autoScanDeepReadBox = createCheckbox(
      "autoScanDeepReadEnabled",
      !!autoScanDeepRead,
    );
    const autoScanDeepReadGroup = createFormGroup(
      getString("settings-ui-auto-scan-deep-read"),
      autoScanDeepReadBox,
      getString("settings-ui-auto-scan-deep-read-help"),
    );
    autoScanDeepReadGroup.id = "ui-setting-auto-scan-deep-read";
    form.appendChild(autoScanDeepReadGroup);

    // 保存对话历史
    const saveChatHistory = (getPref("saveChatHistory") as boolean) ?? true;
    const saveChatHistoryBox = createCheckbox(
      "saveChatHistory",
      !!saveChatHistory,
    );
    form.appendChild(
      createFormGroup(
        getString("settings-ui-save-chat-history"),
        saveChatHistoryBox,
        getString("settings-ui-save-chat-history-help"),
      ),
    );

    const openTaskPanelOnSummon =
      (getPref("openTaskPanelOnSummon" as any) as boolean) ?? false;
    const openTaskPanelOnSummonBox = createCheckbox(
      "openTaskPanelOnSummon",
      !!openTaskPanelOnSummon,
    );
    form.appendChild(
      createFormGroup(
        getString("settings-ui-open-task-panel-on-summon"),
        openTaskPanelOnSummonBox,
        getString("settings-ui-open-task-panel-on-summon-help"),
      ),
    );

    // 笔记管理策略
    const enableTableFeature = getPref("enableTableFeature") ?? true;
    const enableTableFeatureBox = createCheckbox(
      "enableTableFeature",
      !!enableTableFeature,
    );
    form.appendChild(
      createFormGroup(
        getString("settings-ui-enable-table"),
        enableTableFeatureBox,
        getString("settings-ui-enable-table-help"),
      ),
    );

    const policy = (
      (getPref("noteStrategy" as any) as string) || "skip"
    ).toString();
    const policySelect = createSelect(
      "notePolicy",
      [
        { value: "skip", label: getString("settings-ui-policy-skip-default") },
        {
          value: "overwrite",
          label: getString("settings-ui-policy-overwrite"),
        },
        { value: "append", label: getString("settings-ui-policy-append") },
      ],
      policy,
    );
    form.appendChild(
      createFormGroup(
        getString("settings-ui-note-strategy"),
        policySelect,
        getString("settings-ui-note-strategy-help"),
      ),
    );

    // 表格管理策略
    const tablePolicy = (
      (getPref("tableStrategy" as any) as string) || "skip"
    ).toString();
    const tablePolicySelect = createSelect(
      "tablePolicy",
      [
        { value: "skip", label: getString("settings-ui-policy-skip-default") },
        {
          value: "overwrite",
          label: getString("settings-ui-policy-overwrite"),
        },
      ],
      tablePolicy,
    );
    form.appendChild(
      createFormGroup(
        getString("settings-ui-table-strategy"),
        tablePolicySelect,
        getString("settings-ui-table-strategy-help"),
      ),
    );

    // Markdown 笔记样式主题
    const currentTheme = (
      (getPref("markdownTheme" as any) as string) || "github"
    ).toString();
    const themeSelect = createSelect(
      "markdownTheme",
      [
        { value: "github", label: getString("settings-ui-theme-github") },
        {
          value: "redstriking",
          label: getString("settings-ui-theme-redstriking"),
        },
        // 更多主题可在此添加
      ],
      currentTheme,
    );
    form.appendChild(
      createFormGroup(
        getString("settings-ui-sidebar-note-theme"),
        themeSelect,
        getString("settings-ui-sidebar-note-theme-help"),
      ),
    );

    let scheduleAutoSave: () => void = () => undefined;
    const contextMenuVisibilityDraft = getContextMenuItemVisibility();
    let contextMenuOrderDraft = getContextMenuItemOrder();
    let contextMenuCollapsedDraft = isContextMenuCollapsed();
    form.appendChild(
      this.createContextMenuSection(
        contextMenuVisibilityDraft,
        () => contextMenuCollapsedDraft,
        (collapsed) => {
          contextMenuCollapsedDraft = collapsed;
        },
        () => contextMenuOrderDraft,
        (nextOrder) => {
          contextMenuOrderDraft = nextOrder;
          scheduleAutoSave();
        },
        scheduleAutoSave,
      ),
    );

    const sidebarVisibilityDraft = getSidebarModuleVisibility();
    let sidebarOrderDraft = getSidebarModuleOrder();
    const saveCurrentSettings = async (showNotice = true) => {
      const autoVal =
        (form.querySelector("#setting-autoScroll") as HTMLInputElement)
          ?.checked ?? true;
      const autoScanVal =
        (form.querySelector("#setting-autoScan") as HTMLInputElement)
          ?.checked ?? true;
      const autoScanSummaryVal =
        (
          form.querySelector(
            "#setting-autoScanSummaryEnabled",
          ) as HTMLInputElement
        )?.checked ??
        (getPref("autoScanSummaryEnabled" as any) as boolean) ??
        true;
      const autoScanDeepReadVal =
        (
          form.querySelector(
            "#setting-autoScanDeepReadEnabled",
          ) as HTMLInputElement
        )?.checked ??
        (getPref("autoScanDeepReadEnabled" as any) as boolean) ??
        false;
      const saveChatHistoryVal =
        (form.querySelector("#setting-saveChatHistory") as HTMLInputElement)
          ?.checked ?? true;
      const openTaskPanelOnSummonVal =
        (
          form.querySelector(
            "#setting-openTaskPanelOnSummon",
          ) as HTMLInputElement
        )?.checked ?? false;
      const enableTableFeatureVal =
        (form.querySelector("#setting-enableTableFeature") as HTMLInputElement)
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
      setPref("autoScanSummaryEnabled" as any, !!autoScanSummaryVal as any);
      setPref("autoScanDeepReadEnabled" as any, !!autoScanDeepReadVal as any);
      setPref("saveChatHistory", !!saveChatHistoryVal as any);
      setPref(
        "openTaskPanelOnSummon" as any,
        !!openTaskPanelOnSummonVal as any,
      );
      setPref("enableTableFeature", !!enableTableFeatureVal);
      setPref("noteStrategy" as any, policyVal);
      setPref("tableStrategy" as any, tablePolicyVal);
      setPref("markdownTheme" as any, themeVal);

      setContextMenuItemVisibility(contextMenuVisibilityDraft);
      setContextMenuItemOrder(contextMenuOrderDraft);
      setContextMenuCollapsed(contextMenuCollapsedDraft);
      setSidebarModuleVisibility(sidebarVisibilityDraft);
      setSidebarModuleOrder(sidebarOrderDraft);

      const { themeManager } = await import("../../themeManager");
      themeManager.setCurrentTheme(themeVal);
      themeManager.clearCache();

      AutoScanManager.getInstance().reload();
      await this.applyLiveUICustomization();

      if (showNotice) {
        this.showSavedNotice();
      }
    };
    scheduleAutoSave = () => {
      if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = setTimeout(() => {
        this.autoSaveTimer = null;
        void saveCurrentSettings(true);
      }, 500);
    };

    form.appendChild(
      this.createSidebarModuleSection(
        sidebarVisibilityDraft,
        () => sidebarOrderDraft,
        (nextOrder) => {
          sidebarOrderDraft = nextOrder;
          scheduleAutoSave();
        },
        scheduleAutoSave,
      ),
    );

    form.addEventListener("change", scheduleAutoSave);
    form.addEventListener("input", scheduleAutoSave);

    // 预览区域（移除字号预览，不再提供字体大小设置）

    // 按钮
    const actions = Zotero.getMainWindow().document.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      gap: "12px",
      marginTop: "16px",
    });
    const btnSave = createStyledButton(
      getString("settings-ui-save-settings"),
      "#4caf50",
    );
    btnSave.addEventListener("click", async () => {
      await saveCurrentSettings(true);
    });

    const btnReset = createStyledButton(
      getString("settings-ui-reset-default"),
      "#9e9e9e",
    );
    btnReset.addEventListener("click", async () => {
      setPref("autoScroll", true as any);
      setPref("autoScan", true as any);
      setPref("autoScanSummaryEnabled" as any, true as any);
      setPref("autoScanDeepReadEnabled" as any, false as any);
      setPref("saveChatHistory", true as any);
      setPref("openTaskPanelOnSummon" as any, false as any);
      setPref("enableTableFeature", true);
      setPref("noteStrategy" as any, "skip");
      setPref("tableStrategy" as any, "skip");
      resetUICustomizationPrefs();
      AutoScanManager.getInstance().reload();
      await this.applyLiveUICustomization();
      this.render();
      new ztoolkit.ProgressWindow(getString("settings-ui-progress-title"))
        .createLine({
          text: getString("settings-ui-reset-done"),
          type: "success",
        })
        .show();
    });
    actions.appendChild(btnSave);
    actions.appendChild(btnReset);
    form.appendChild(actions);

    this.container.appendChild(form);

    // 无字号预览
  }

  private showSavedNotice(): void {
    new ztoolkit.ProgressWindow(getString("settings-ui-progress-title"), {
      closeOnClick: true,
      closeTime: 2200,
    })
      .createLine({
        text: getString("settings-ui-settings-saved"),
        type: "success",
      })
      .show();
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
    getCollapsed: () => boolean,
    setCollapsed: (collapsed: boolean) => void,
    getOrder: () => ContextMenuItemId[],
    setOrder: (order: ContextMenuItemId[]) => void,
    onAutoSave?: () => void,
  ): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const panel = this.createSettingsPanel(
      getString("settings-ui-context-menu-title"),
      getString("settings-ui-context-menu-description"),
    );

    const collapseRow = doc.createElement("label");
    Object.assign(collapseRow.style, {
      display: "grid",
      gridTemplateColumns: "auto 1fr",
      gap: "10px",
      alignItems: "center",
      padding: "10px",
      marginBottom: "12px",
      border: "1px solid rgba(89, 192, 188, 0.28)",
      borderRadius: "5px",
      background: "rgba(89, 192, 188, 0.08)",
      cursor: "pointer",
    });

    const collapseCheckbox = doc.createElement("input");
    collapseCheckbox.type = "checkbox";
    collapseCheckbox.checked = getCollapsed();
    collapseCheckbox.id = "setting-context-menu-collapsed";
    Object.assign(collapseCheckbox.style, {
      width: "18px",
      height: "18px",
      cursor: "pointer",
    });
    collapseCheckbox.addEventListener("change", () => {
      setCollapsed(collapseCheckbox.checked);
      onAutoSave?.();
    });

    const collapseText = doc.createElement("div");
    const collapseTitle = doc.createElement("div");
    collapseTitle.textContent = getString("settings-ui-collapse-context-menu");
    Object.assign(collapseTitle.style, {
      fontSize: "13px",
      fontWeight: "600",
      color: "var(--ai-text)",
    });

    const collapseDesc = doc.createElement("div");
    collapseDesc.textContent = getString(
      "settings-ui-collapse-context-menu-help",
    );
    Object.assign(collapseDesc.style, {
      marginTop: "3px",
      fontSize: "12px",
      color: "var(--ai-text-muted)",
      lineHeight: "1.35",
    });
    collapseText.appendChild(collapseTitle);
    collapseText.appendChild(collapseDesc);
    collapseRow.appendChild(collapseCheckbox);
    collapseRow.appendChild(collapseText);
    panel.appendChild(collapseRow);

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
          onAutoSave?.();
        });

        const textWrap = doc.createElement("div");
        const label = doc.createElement("div");
        label.textContent = getString(item.labelKey);
        Object.assign(label.style, {
          fontSize: "13px",
          fontWeight: "600",
          color: "var(--ai-text)",
        });

        const desc = doc.createElement("div");
        desc.textContent = getString(item.descriptionKey);
        Object.assign(desc.style, {
          marginTop: "3px",
          fontSize: "12px",
          color: "var(--ai-text-muted)",
          lineHeight: "1.35",
        });
        textWrap.appendChild(label);
        textWrap.appendChild(desc);

        const scope = doc.createElement("span");
        scope.textContent =
          item.scope === "collection"
            ? getString("settings-ui-scope-collection")
            : getString("settings-ui-scope-item");
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
            onAutoSave?.();
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
    onAutoSave?: () => void,
  ): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const panel = this.createSettingsPanel(
      getString("settings-ui-sidebar-modules-title"),
      getString("settings-ui-sidebar-modules-description"),
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
          onAutoSave?.();
        });

        const textWrap = doc.createElement("div");
        const label = doc.createElement("div");
        label.textContent = getString(module.labelKey);
        Object.assign(label.style, {
          fontSize: "13px",
          fontWeight: "600",
          color: "var(--ai-text)",
        });

        const desc = doc.createElement("div");
        desc.textContent = getString(module.descriptionKey);
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

    const upBtn = this.createOrderButton(
      "↑",
      getString("settings-ui-move-up"),
      index === 0,
    );
    upBtn.addEventListener("click", () => {
      if (index === 0) return;
      onMoveUp();
    });

    const downBtn = this.createOrderButton(
      "↓",
      getString("settings-ui-move-down"),
      index === length - 1,
    );
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
      const { refreshAIButlerContextMenuItems } =
        await import("../../../hooks");
      refreshAIButlerContextMenuItems();
    } catch (error) {
      ztoolkit.log("[AI-Butler] 立即刷新右键菜单失败:", error);
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
