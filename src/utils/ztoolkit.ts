/**
 * ================================================================
 * Zotero 工具包初始化模块
 * ================================================================
 * 
 * 本模块负责创建和配置 ZToolkit 实例
 * ZToolkit 是 Zotero 插件开发的核心工具集,提供 UI 组件、菜单管理、对话框等功能
 * 
 * 主要职责:
 * 1. 创建 ZToolkit 实例
 * 2. 根据运行环境配置工具包行为
 * 3. 设置日志、调试和 UI 选项
 * 
 * @module ztoolkit
 * @author AI-Butler Team
 */

import { ZoteroToolkit } from "zotero-plugin-toolkit";
import { config } from "../../package.json";

/**
 * 创建并初始化 ZToolkit 实例
 * 
 * 工厂函数模式:
 * - 封装创建逻辑,提供统一的实例化接口
 * - 确保每个实例都经过正确配置
 * - 支持未来的工具包定制需求
 * 
 * 优化建议:
 * 如果需要减小插件体积,可以仅导入使用的模块
 * 参考下方的 MyToolkit 类实现选择性导入
 * 
 * @returns 配置完成的 ZToolkit 实例
 */
export function createZToolkit() {
  // 创建完整的 ZToolkit 实例
  const _ztoolkit = new ZoteroToolkit();
  
  /**
   * 体积优化方案(可选):
   * 如果插件包过大,可以使用自定义工具包类
   * 仅导入实际使用的模块,减小打包体积
   * 
   * 使用方法:
   * 1. 取消下行注释,注释上面的 ZoteroToolkit 实例化
   * 2. 在 MyToolkit 类中添加需要的工具模块
   */
  // const _ztoolkit = new MyToolkit();
  
  // 初始化工具包配置
  initZToolkit(_ztoolkit);
  
  return _ztoolkit;
}

/**
 * 初始化 ZToolkit 配置
 * 
 * 配置项说明:
 * 1. 日志配置:设置日志前缀和输出控制
 * 2. UI 配置:控制 UI 元素的调试日志
 * 3. API 配置:设置插件 ID,用于 API 调用
 * 4. 进度窗口:设置默认图标
 * 
 * 环境适配:
 * - 开发环境:启用详细日志和调试信息
 * - 生产环境:禁用控制台日志,减少性能开销
 * 
 * @param _ztoolkit 待配置的 ZToolkit 实例
 */
function initZToolkit(_ztoolkit: ReturnType<typeof createZToolkit>) {
  // 获取当前运行环境(development 或 production)
  const env = __env__;
  
  // 配置日志选项
  _ztoolkit.basicOptions.log.prefix = `[${config.addonName}]`;
  _ztoolkit.basicOptions.log.disableConsole = env === "production";
  
  // 配置 UI 选项
  // 在开发环境启用详细的 UI 元素日志,便于调试
  _ztoolkit.UI.basicOptions.ui.enableElementJSONLog = __env__ === "development";
  _ztoolkit.UI.basicOptions.ui.enableElementDOMLog = __env__ === "development";
  
  // 配置调试桥接
  // 注意:调试桥接功能已计划弃用,避免使用除非必要
  // _ztoolkit.basicOptions.debug.disableDebugBridgePassword =
  //   __env__ === "development";
  
  // 配置 API 选项
  // 设置插件 ID,用于 API 调用时的身份标识
  _ztoolkit.basicOptions.api.pluginID = config.addonID;
  
  // 配置进度窗口默认图标
  _ztoolkit.ProgressWindow.setIconURI(
    "default",
    `chrome://${config.addonRef}/content/icons/favicon.png`,
  );
}

/**
 * 自定义工具包类(可选的体积优化方案)
 * 
 * 使用场景:
 * - 插件打包体积过大时
 * - 仅使用 ZToolkit 的部分功能
 * - 需要精确控制依赖项
 * 
 * 实现方式:
 * 1. 继承 BasicTool 基础类
 * 2. 仅导入和初始化需要的工具模块
 * 3. 实现 unregisterAll 方法用于清理
 * 
 * 示例:
 * ```typescript
 * class MyToolkit extends BasicTool {
 *   UI: UITool;
 *   Menu: MenuTool;
 *   
 *   constructor() {
 *     super();
 *     this.UI = new UITool(this);
 *     this.Menu = new MenuTool(this);
 *   }
 * }
 * ```
 */
import { BasicTool, unregister } from "zotero-plugin-toolkit";
import { UITool } from "zotero-plugin-toolkit";

class MyToolkit extends BasicTool {
  /**
   * UI 工具模块
   * 提供对话框、通知、进度窗口等 UI 组件
   */
  UI: UITool;

  /**
   * 构造函数
   * 初始化工具包及其包含的工具模块
   */
  constructor() {
    super();
    // 初始化 UI 工具模块
    this.UI = new UITool(this);
  }

  /**
   * 注销所有注册的组件
   * 
   * 清理内容:
   * - UI 组件注册
   * - 事件监听器
   * - 菜单项和工具栏按钮
   * 
   * 调用时机:
   * - 插件卸载时
   * - 窗口关闭时
   * - 需要重置插件状态时
   */
  unregisterAll() {
    unregister(this);
  }
}
