/**
 * ================================================================
 * Zotero 工具包初始化模块
 * ================================================================
 *
 * 本模块负责创建项目级 ztoolkit 适配层。zotero-plugin-toolkit 5.2.0
 * 将完整 `ZoteroToolkit` 拆分为主入口工具类与 `ztoolkit` 全量预设。
 *
 * AI Butler 只依赖 BasicTool、UITool、DialogHelper 和自定义
 * ModernProgressWindow。按 5.2.0 推荐的按需组合方式显式初始化这些能力，
 * 避免全量 `ZoteroToolkit` 在启动阶段初始化 Prompt/Keyboard/FieldHooks 等
 * 未使用模块并修改 Zotero 全局行为。
 *
 * @module ztoolkit
 * @author AI-Butler Team
 */

import {
  BasicTool,
  DialogHelper,
  UITool,
  makeHelperTool,
  unregister,
} from "zotero-plugin-toolkit";
import { config } from "../../package.json";
import { ModernProgressWindow } from "./modernProgressWindow";
import { prepareDocument } from "../compatibility/document";

class AIButlerDialog extends DialogHelper {
  override createXULElement(doc: Document, type: string): XULElement {
    prepareDocument(doc);
    return super.createXULElement(doc, type);
  }
}

/**
 * 项目实际使用的 toolkit 能力集合。
 *
 * 说明：
 * - 继承 BasicTool，保留 log/getGlobal/basicOptions 等基础能力。
 * - 显式实例化 UITool，用于 createElement 及 UI 配置。
 * - 通过 makeHelperTool 暴露 Dialog，符合 toolkit 5.2.0 helper 的 options 传递模型。
 * - ProgressWindow 使用项目自定义实现，保持现有现代化通知样式。
 */
class AIButlerToolkit extends BasicTool {
  UI: UITool;

  Dialog: typeof DialogHelper;

  ProgressWindow: typeof ModernProgressWindow = ModernProgressWindow;

  constructor() {
    super();
    this.UI = new UITool(this);
    this.Dialog = makeHelperTool(AIButlerDialog, this) as typeof DialogHelper;
  }

  /**
   * 注销所有由 toolkit 管理的 UI/manager 资源。
   */
  unregisterAll() {
    unregister(this);
  }
}

/**
 * 创建并初始化项目级 ztoolkit 实例。
 */
export function createZToolkit() {
  const ztoolkit = new AIButlerToolkit();
  initZToolkit(ztoolkit);
  return ztoolkit;
}

/**
 * 初始化 ZToolkit 配置。
 *
 * @param ztoolkit 待配置的项目级 toolkit 实例
 */
function initZToolkit(ztoolkit: AIButlerToolkit) {
  const env = __env__;

  ztoolkit.basicOptions.log.prefix = `[${config.addonName}]`;
  ztoolkit.basicOptions.log.disableConsole = env === "production";

  ztoolkit.UI.basicOptions.ui.enableElementJSONLog = env === "development";
  ztoolkit.UI.basicOptions.ui.enableElementDOMLog = env === "development";
  ztoolkit.UI.basicOptions.ui.enableElementRecord =
    typeof (globalThis as any).WeakRef === "function";

  ztoolkit.basicOptions.api.pluginID = config.addonID;

  ztoolkit.ProgressWindow.setIconURI(
    "default",
    `chrome://${config.addonRef}/content/icons/favicon.png`,
  );
}
