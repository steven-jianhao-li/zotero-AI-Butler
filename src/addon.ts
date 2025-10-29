/**
 * ================================================================
 * AI-Butler 插件核心类定义
 * ================================================================
 * 
 * 本文件定义了插件的核心数据结构和生命周期管理
 * 
 * 主要职责:
 * 1. 维护插件运行时的全局状态和配置信息
 * 2. 管理插件的生命周期钩子函数集合
 * 3. 提供统一的工具集访问接口
 * 4. 存储对话框、偏好设置等运行时数据
 * 
 * 架构设计:
 * - 采用单例模式,确保插件在整个 Zotero 会话中只有一个实例
 * - 数据和行为分离,data 对象负责状态管理,hooks 对象负责事件响应
 * - 使用 ZToolkit 提供跨平台的 UI 组件和工具函数
 * 
 * @module addon
 * @author AI-Butler Team
 */

import { config } from "../package.json";
import { ColumnOptions, DialogHelper } from "zotero-plugin-toolkit";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";

/**
 * 插件核心类
 * 
 * 该类是整个插件的中心枢纽,负责协调各个模块的运行
 * 所有插件功能模块都可以通过全局 addon 对象访问核心状态和工具
 */
class Addon {
  /**
   * 插件运行时数据对象
   * 包含插件运行所需的所有状态信息和工具实例
   */
  public data: {
    /**
     * 插件存活状态标志
     * 用于判断插件是否处于活动状态,在插件卸载时会设置为 false
     */
    alive: boolean;
    
    /**
     * 插件配置信息
     * 从 package.json 中加载,包含插件名称、版本、ID等元数据
     */
    config: typeof config;
    
    /**
     * 运行环境标识
     * development: 开发环境,启用调试日志和详细错误信息
     * production: 生产环境,优化性能并减少日志输出
     */
    env: "development" | "production";
    
    /**
     * 初始化完成标志
     * 标记插件是否已完成启动初始化流程
     * 某些功能需要在初始化完成后才能执行
     */
    initialized?: boolean;
    
    /**
     * Zotero 工具包实例
     * 提供跨平台的 UI 组件、菜单管理、进度窗口等实用工具
     * 这是插件与 Zotero 交互的主要接口
     */
    ztoolkit: ZToolkit;
    
    /**
     * 国际化本地化对象
     * 存储当前语言环境的翻译文本
     * 支持多语言界面显示
     */
    locale?: {
      current: any;
    };
    
    /**
     * 偏好设置窗口数据
     * 用于管理插件的配置界面状态
     */
    prefs?: {
      /**
       * 偏好设置窗口对象
       */
      window: Window;
      
      /**
       * 表格列配置
       * 用于配置界面中的数据表格显示
       */
      columns: Array<ColumnOptions>;
      
      /**
       * 表格行数据
       * 每行数据以键值对形式存储
       */
      rows: Array<{ [dataKey: string]: string }>;
    };
    
    /**
     * 对话框助手实例
     * 用于创建和管理插件的各种对话框窗口
     */
    dialog?: DialogHelper;
  };
  
  /**
   * 生命周期钩子函数集合
   * 定义插件在不同生命周期阶段的行为
   * 
   * 主要钩子包括:
   * - onStartup: 插件启动时执行
   * - onShutdown: 插件关闭时执行
   * - onMainWindowLoad: 主窗口加载时执行
   * - onMainWindowUnload: 主窗口卸载时执行
   */
  public hooks: typeof hooks;
  
  /**
   * API 接口对象
   * 预留的扩展点,用于暴露插件的公共 API
   * 其他插件或脚本可以通过此对象与本插件交互
   */
  public api: object;

  /**
   * 构造函数
   * 初始化插件实例,设置默认状态和工具对象
   */
  constructor() {
    // 初始化数据对象
    this.data = {
      alive: true,                    // 插件处于活动状态
      config,                         // 加载插件配置
      env: __env__,                   // 设置运行环境(由构建系统注入)
      initialized: false,             // 初始化状态标志
      ztoolkit: createZToolkit(),     // 创建工具包实例
    };
    
    // 引用生命周期钩子
    this.hooks = hooks;
    
    // 初始化空 API 对象
    this.api = {};
  }
}

export default Addon;
