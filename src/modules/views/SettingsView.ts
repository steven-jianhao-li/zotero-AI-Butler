/**
 * 设置视图 - 重构版
 * 
 * 提供插件配置和管理界面
 * 使用子页面模式组织代码
 * 
 * @file SettingsView.ts
 * @author AI Butler Team
 */

import { BaseView } from "./BaseView";
import { ApiSettingsPage } from "./settings/ApiSettingsPage";
import { PromptsSettingsPage } from "./settings/PromptsSettingsPage";
import { UiSettingsPage } from "./settings/UiSettingsPage";
import { DataSettingsPage } from "./settings/DataSettingsPage";
import { AboutPage } from "./settings/AboutPage";

/**
 * 设置分类类型
 */
type SettingCategory = "api" | "prompts" | "ui" | "data" | "about";

/**
 * 设置视图类
 */
export class SettingsView extends BaseView {
  /** 设置内容容器 */
  private settingsContainer: HTMLElement | null = null;

  /** 当前选中的设置分类 */
  private currentCategory: SettingCategory = "api";

  /** 子页面实例 */
  private pages: Map<SettingCategory, any> = new Map();

  /** 当前活动的按钮 */
  private activeButton: HTMLElement | null = null;

  /**
   * 创建设置视图实例
   */
  constructor() {
    super("settings-view");
  }

  /**
   * 渲染设置视图内容
   * 
   * @protected
   */
  protected renderContent(): HTMLElement {
    // 主容器 - 移除 position: absolute，使用 flex 布局
    const wrapper = this.createElement("div", {
      styles: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: "#f9f9f9",
        overflow: "hidden",
      },
    });

    const mainContainer = this.createElement("div", {
      styles: {
        display: "flex",
        flex: "1",
        minHeight: "0",
        width: "100%",
      },
    });
    wrapper.appendChild(mainContainer);

    // 左侧分类导航
    const sidebar = this.createSidebar();
    mainContainer.appendChild(sidebar);

    // 右侧设置内容区
    this.settingsContainer = this.createElement("div", {
      styles: {
        flex: "1",
        height: "100%",
        overflowY: "auto",
        padding: "20px",
        boxSizing: "border-box",
        backgroundColor: "#fff",
      },
    });
    mainContainer.appendChild(this.settingsContainer);

    // 渲染默认分类
    this.renderSettings(this.currentCategory);

    return wrapper;
  }

  /**
   * 创建左侧分类导航栏
   * 
   * @private
   */
  private createSidebar(): HTMLElement {
    const sidebar = this.createElement("div", {
      styles: {
        width: "200px",
        height: "100%",
        borderRight: "1px solid #e0e0e0",
        padding: "20px 0",
        backgroundColor: "#fafafa",
        boxSizing: "border-box",
      },
    });

    // 设置分类列表
    const categories = [
      { id: "api" as SettingCategory, label: "🔌 API 配置" },
      { id: "prompts" as SettingCategory, label: "📝 提示词模板" },
      { id: "ui" as SettingCategory, label: "🎨 界面设置" },
      { id: "data" as SettingCategory, label: "💾 数据管理" },
      { id: "about" as SettingCategory, label: "ℹ️ 关于" },
    ];

    // 创建分类按钮
    categories.forEach((category) => {
      const button = this.createSidebarButton(category.id, category.label);
      
      if (category.id === this.currentCategory) {
        this.activeButton = button;
        this.setButtonActive(button, true);
      }

      sidebar.appendChild(button);
    });

    return sidebar;
  }

  /**
   * 创建侧边栏按钮
   * 
   * @private
   */
  private createSidebarButton(id: SettingCategory, label: string): HTMLElement {
    const button = this.createElement("button", {
      textContent: label,
      styles: {
        display: "flex",
        width: "100%",
        padding: "14px 20px",
        border: "none",
        backgroundColor: "transparent",
        color: "#666",
        textAlign: "left",
        cursor: "pointer",
        fontSize: "14px",
        transition: "all 0.2s",
        borderLeft: "3px solid transparent",
        alignItems: "center",
        justifyContent: "flex-start",
      },
    });

    // 悬停效果
    button.addEventListener("mouseenter", () => {
      if (button !== this.activeButton) {
        button.style.backgroundColor = "rgba(89, 192, 188, 0.08)";
      }
    });

    button.addEventListener("mouseleave", () => {
      if (button !== this.activeButton) {
        button.style.backgroundColor = "transparent";
      }
    });

    // 点击切换分类
    button.addEventListener("click", () => {
      this.switchCategory(id, button);
    });

    return button;
  }

  /**
   * 设置按钮激活状态
   * 
   * @private
   */
  private setButtonActive(button: HTMLElement, active: boolean): void {
    if (active) {
      button.style.backgroundColor = "rgba(89, 192, 188, 0.15)";
      button.style.color = "#59c0bc";
      button.style.borderLeftColor = "#59c0bc";
      button.style.fontWeight = "600";
    } else {
      button.style.backgroundColor = "transparent";
      button.style.color = "#666";
      button.style.borderLeftColor = "transparent";
      button.style.fontWeight = "normal";
    }
  }

  /**
   * 切换设置分类
   * 
   * @private
   */
  private switchCategory(category: SettingCategory, button: HTMLElement): void {
    if (category === this.currentCategory) {
      return;
    }

    // 更新按钮状态
    if (this.activeButton) {
      this.setButtonActive(this.activeButton, false);
    }
    this.setButtonActive(button, true);
    this.activeButton = button;

    // 更新当前分类并渲染
    this.currentCategory = category;
    this.renderSettings(category);
  }

  /**
   * 根据分类渲染对应的设置内容
   * 
   * @private
   */
  private renderSettings(category: SettingCategory): void {
    if (!this.settingsContainer) return;

    // 清空内容
    this.settingsContainer.innerHTML = "";

    // 获取或创建子页面实例
    let page = this.pages.get(category);
    
    if (!page) {
      switch (category) {
        case "api":
          page = new ApiSettingsPage(this.settingsContainer);
          break;
        case "prompts":
          page = new PromptsSettingsPage(this.settingsContainer);
          break;
        case "ui":
          page = new UiSettingsPage(this.settingsContainer);
          break;
        case "data":
          page = new DataSettingsPage(this.settingsContainer);
          break;
        case "about":
          page = new AboutPage(this.settingsContainer);
          break;
      }
      
      if (page) {
        this.pages.set(category, page);
      }
    }

    // 渲染子页面
    if (page && typeof page.render === "function") {
      page.render();
    }
  }

  /**
   * 视图显示时的回调
   * 
   * @protected
   */
  protected onShow(): void {
    super.onShow();
    ztoolkit.log(`[SettingsView] 视图显示 - 当前分类: ${this.currentCategory}`);
    // 重新渲染当前页面，确保显示最新的设置值（例如从仪表盘快捷操作修改后）
    this.renderSettings(this.currentCategory);
  }

  /**
   * 视图销毁时的回调
   * 清理子页面实例
   * 
   * @protected
   */
  protected onDestroy(): void {
    this.pages.clear();
    super.onDestroy();
  }
}
