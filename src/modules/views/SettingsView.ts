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
import { ImageSummarySettingsPage } from "./settings/ImageSummarySettingsPage";
import { MindmapSettingsPage } from "./settings/MindmapSettingsPage";
import {
  createSettingsScaffold,
  type SettingsNavDescriptor,
  type SettingsScaffoldRefs,
} from "./layout/windowScaffold";

/**
 * 设置分类类型
 */
type SettingCategory =
  | "api"
  | "prompts"
  | "mindmap"
  | "imageSummary"
  | "ui"
  | "data"
  | "about";

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

  /** 固定式设置页脚手架 */
  private scaffold: SettingsScaffoldRefs<SettingCategory> | null = null;

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
    const wrapper = this.createElement("div", {
      styles: {
        width: "100%",
        height: "100%",
        minHeight: "0",
        overflow: "hidden",
        position: "relative",
        backgroundColor: "var(--ai-bg)",
      },
    });

    return wrapper;
  }

  private ensureScaffold(): void {
    if (this.scaffold || !this.container) {
      return;
    }

    const categories: Array<SettingsNavDescriptor<SettingCategory>> = [
      { id: "api", label: "🔌 API 配置" },
      { id: "prompts", label: "📝 提示词模板" },
      { id: "mindmap", label: "🧠 思维导图" },
      { id: "imageSummary", label: "🖼️ 一图总结" },
      { id: "ui", label: "🎨 界面设置" },
      { id: "data", label: "💾 数据管理" },
      { id: "about", label: "ℹ️ 关于" },
    ];

    this.scaffold = createSettingsScaffold(
      this.container,
      categories,
      (category) => {
        this.switchCategory(category);
      },
    );
    this.settingsContainer = this.scaffold.settingsContent;
    this.scaffold.setActiveCategory(this.currentCategory);
  }

  /**
   * 切换设置分类
   *
   * @private
   */
  private switchCategory(category: SettingCategory): void {
    if (category === this.currentCategory) {
      return;
    }

    // 更新当前分类并渲染
    this.currentCategory = category;
    this.scaffold?.setActiveCategory(category);
    this.renderSettings(category);
    this.scaffold?.scrollSettingsTop();
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
        case "mindmap":
          page = new MindmapSettingsPage(this.settingsContainer);
          break;
        case "imageSummary":
          page = new ImageSummarySettingsPage(this.settingsContainer);
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
   * 视图挂载时的回调
   *
   * @protected
   */
  protected onMount(): void {
    // 应用主题
    this.applyTheme();
  }

  /**
   * 视图显示时的回调
   *
   * @protected
   */
  protected onShow(): void {
    super.onShow();
    ztoolkit.log(`[SettingsView] 视图显示 - 当前分类: ${this.currentCategory}`);
    this.ensureScaffold();
    // 重新渲染当前页面，确保显示最新的设置值（例如从仪表盘快捷操作修改后）
    this.renderSettings(this.currentCategory);
    // 重新应用主题(防止动态内容未应用主题)
    this.applyTheme();
  }

  /**
   * 视图销毁时的回调
   * 清理子页面实例
   *
   * @protected
   */
  protected onDestroy(): void {
    this.pages.clear();
    this.scaffold = null;
    this.settingsContainer = null;
    super.onDestroy();
  }
}
