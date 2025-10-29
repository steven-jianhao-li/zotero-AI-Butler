/**
 * ================================================================
 * 视图基类
 * ================================================================
 *
 * 本模块提供所有视图的通用基础类
 *
 * 主要职责:
 * 1. 定义视图的生命周期方法
 * 2. 提供通用的 DOM 操作方法
 * 3. 管理视图的可见性和状态
 * 4. 提供主题切换支持
 * 5. 统一事件处理机制
 *
 * 设计模式:
 * - 模板方法模式: 定义视图生命周期框架
 * - 观察者模式: 支持事件订阅和通知
 *
 * 生命周期:
 * constructor -> render -> mount -> show -> hide -> unmount -> destroy
 *
 * @module BaseView
 * @author AI-Butler Team
 */

/**
 * 视图基类
 *
 * 所有 UI 视图都应该继承此基类
 * 提供标准的生命周期管理和工具方法
 *
 * @abstract
 */
export abstract class BaseView {
  /** 视图的根 DOM 元素 */
  protected container: HTMLElement | null = null;

  /** 视图是否已渲染 */
  protected isRendered: boolean = false;

  /** 视图是否可见 */
  protected isVisible: boolean = false;

  /** 视图的唯一 ID */
  protected viewId: string;

  /**
   * 构造函数
   *
   * @param viewId 视图的唯一标识符
   */
  constructor(viewId: string) {
    this.viewId = viewId;
  }

  /**
   * 渲染视图 DOM 结构
   *
   * 子类必须实现此方法来定义视图的 HTML 结构
   *
   * @abstract
   * @returns 视图的根 HTML 元素
   */
  protected abstract renderContent(): HTMLElement;

  /**
   * 视图首次渲染后的初始化逻辑
   *
   * 可用于绑定事件、加载数据等
   * 子类可选择性覆盖
   */
  protected onMount(): void {
    // 默认空实现,子类可覆盖
  }

  /**
   * 视图显示时的回调
   *
   * 每次视图从隐藏状态变为可见时调用
   * 子类可选择性覆盖
   */
  protected onShow(): void {
    // 默认空实现,子类可覆盖
  }

  /**
   * 视图隐藏时的回调
   *
   * 每次视图从可见状态变为隐藏时调用
   * 子类可选择性覆盖
   */
  protected onHide(): void {
    // 默认空实现,子类可覆盖
  }

  /**
   * 视图销毁前的清理逻辑
   *
   * 用于取消事件监听、释放资源等
   * 子类可选择性覆盖
   */
  protected onDestroy(): void {
    // 默认空实现,子类可覆盖
  }

  /**
   * 渲染视图
   *
   * 调用子类的 renderContent 方法生成 DOM
   *
   * @returns 视图的根元素
   */
  public render(): HTMLElement {
    if (!this.isRendered) {
      this.container = this.renderContent();
      this.isRendered = true;
      this.onMount();
    }
    return this.container!;
  }

  /**
   * 显示视图
   *
   * 将视图的 display 样式设为可见
   */
  public show(): void {
    if (this.container && !this.isVisible) {
      this.container.style.display = "flex"; // 使用 flex 保持布局
      this.isVisible = true;
      this.onShow();
    }
  }

  /**
   * 隐藏视图
   *
   * 将视图的 display 样式设为 none
   */
  public hide(): void {
    if (this.container && this.isVisible) {
      this.container.style.display = "none";
      this.isVisible = false;
      this.onHide();
    }
  }

  /**
   * 销毁视图
   *
   * 移除 DOM 元素并清理资源
   */
  public destroy(): void {
    this.onDestroy();
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.isRendered = false;
    this.isVisible = false;
  }

  /**
   * 获取视图 ID
   *
   * @returns 视图的唯一标识符
   */
  public getViewId(): string {
    return this.viewId;
  }

  /**
   * 获取视图的根元素
   *
   * @returns 根 DOM 元素,未渲染时返回 null
   */
  public getContainer(): HTMLElement | null {
    return this.container;
  }

  /**
   * 应用主题样式
   *
   * 根据 Zotero 的当前主题应用相应样式
   *
   * @protected
   */
  protected applyTheme(): void {
    if (!this.container) return;

    // 在 Zotero 环境中需要通过全局 Services 检测主题
    try {
      const isDark = Services.prefs.getBoolPref(
        "ui.systemUsesDarkTheme",
        false,
      );

      if (isDark) {
        this.container.classList.add("dark-theme");
      } else {
        this.container.classList.remove("dark-theme");
      }
    } catch (e) {
      // 降级方案:默认浅色主题
      this.container.classList.remove("dark-theme");
    }
  }

  /**
   * 创建 DOM 元素的辅助方法
   *
   * @param tag HTML 标签名
   * @param options 元素配置选项
   * @param doc 文档对象,默认使用当前文档
   * @returns 创建的 HTML 元素
   *
   * @protected
   */
  protected createElement<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    options: {
      id?: string;
      className?: string;
      styles?: Partial<CSSStyleDeclaration>;
      attributes?: Record<string, string>;
      innerHTML?: string;
      textContent?: string;
      children?: HTMLElement[];
    } = {},
    doc: Document = Zotero.getMainWindow().document,
  ): HTMLElementTagNameMap[K] {
    const element = doc.createElement(tag);

    if (options.id) {
      element.id = options.id;
    }

    if (options.className) {
      element.className = options.className;
    }

    if (options.styles) {
      Object.assign(element.style, options.styles);
    }

    if (options.attributes) {
      Object.entries(options.attributes).forEach(([key, value]) => {
        element.setAttribute(key, value);
      });
    }

    if (options.innerHTML) {
      element.innerHTML = options.innerHTML;
    }

    if (options.textContent) {
      element.textContent = options.textContent;
    }

    if (options.children) {
      options.children.forEach((child) => element.appendChild(child));
    }

    return element;
  }
}
