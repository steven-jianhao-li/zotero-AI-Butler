/**
 * ================================================================
 * 国际化(i18n)工具模块
 * ================================================================
 * 
 * 本模块提供多语言支持功能,管理插件的本地化文本
 * 
 * 技术实现:
 * - 使用 Mozilla Fluent (FTL) 本地化系统
 * - 支持动态参数插值和分支文本
 * - 自动处理语言回退和默认值
 * 
 * @module locale
 * @author AI-Butler Team
 */

import { config } from "../../package.json";
import { FluentMessageId } from "../../typings/i10n";

// 导出公共函数
export { initLocale, getString, getLocaleID };

/**
 * 初始化国际化资源
 * 
 * 执行时机:
 * - 插件启动时调用一次
 * - 加载所有 FTL 本地化文件
 * 
 * 加载的资源文件:
 * - addon.ftl: 插件通用文本
 * - mainWindow.ftl: 主窗口界面文本
 * 
 * 工作原理:
 * 1. 创建 Localization 对象
 * 2. 注册 FTL 资源文件
 * 3. 启用自动更新机制
 * 4. 存储到插件全局数据中
 */
function initLocale() {
  // 兼容不同版本的 Zotero API
  // 优先使用全局 Localization,降级到 ztoolkit 提供的版本
  const l10n = new (
    typeof Localization === "undefined"
      ? ztoolkit.getGlobal("Localization")
      : Localization
  )([
    `${config.addonRef}-addon.ftl`,        // 插件通用文本
    `${config.addonRef}-mainWindow.ftl`,   // 主窗口文本
  ], true);  // 第二个参数 true 表示启用自动资源更新
  
  // 存储 Localization 对象到插件数据中
  addon.data.locale = {
    current: l10n,
  };
}

/**
 * 获取本地化字符串(重载签名1)
 * 
 * 最简单的用法:只提供键名,返回默认分支的文本
 * 
 * @param localString FTL 文件中的消息键名
 * @returns 本地化后的文本
 * 
 * @example
 * ```typescript
 * // FTL 文件内容:
 * // addon-static-example = This is default branch!
 * 
 * const text = getString("addon-static-example");
 * // 输出: "This is default branch!"
 * ```
 */
function getString(localString: FluentMessageId): string;

/**
 * 获取本地化字符串(重载签名2)
 * 
 * 简化的分支访问:直接提供分支名称
 * 
 * @param localString FTL 文件中的消息键名
 * @param branch 分支名称
 * @returns 本地化后的文本
 * 
 * @example
 * ```typescript
 * // FTL 文件内容:
 * // addon-static-example = This is default branch!
 * //     .branch-example = This is a branch!
 * 
 * const text = getString("addon-static-example", "branch-example");
 * // 输出: "This is a branch!"
 * ```
 */
function getString(localString: FluentMessageId, branch: string): string;

/**
 * 获取本地化字符串(重载签名3)
 * 
 * 完整的配置方式:支持分支和参数
 * 
 * @param localeString FTL 文件中的消息键名
 * @param options 配置对象
 * @param options.branch 可选的分支名称
 * @param options.args 可选的参数对象,用于文本插值
 * @returns 本地化后的文本
 * 
 * @example
 * ```typescript
 * // FTL 文件内容:
 * // addon-dynamic-example = 
 * //     { $count ->
 * //         [one] I have { $count } apple
 * //        *[other] I have { $count } apples
 * //     }
 * 
 * const text1 = getString("addon-dynamic-example", { args: { count: 1 } });
 * // 输出: "I have 1 apple"
 * 
 * const text2 = getString("addon-dynamic-example", { args: { count: 2 } });
 * // 输出: "I have 2 apples"
 * ```
 */
function getString(
  localeString: FluentMessageId,
  options: { branch?: string | undefined; args?: Record<string, unknown> },
): string;

/**
 * 获取本地化字符串(实现函数)
 * 
 * 核心实现:处理所有重载情况的统一逻辑
 * 
 * 工作流程:
 * 1. 解析输入参数,确定调用方式
 * 2. 调用内部 _getString 执行实际查询
 * 
 * @param inputs 可变参数列表
 * @returns 本地化后的文本
 * @throws 参数无效时抛出错误
 */
function getString(...inputs: any[]) {
  if (inputs.length === 1) {
    // 单参数:仅消息键名
    return _getString(inputs[0]);
  } else if (inputs.length === 2) {
    if (typeof inputs[1] === "string") {
      // 双参数(字符串):消息键名 + 分支名称
      return _getString(inputs[0], { branch: inputs[1] });
    } else {
      // 双参数(对象):消息键名 + 配置对象
      return _getString(inputs[0], inputs[1]);
    }
  } else {
    // 参数数量不正确
    throw new Error("Invalid arguments");
  }
}

/**
 * 内部字符串获取函数
 * 
 * 实现细节:
 * 1. 自动添加插件前缀到消息键名
 * 2. 尝试查询带前缀的键名
 * 3. 回退到无前缀的键名(向后兼容)
 * 4. 处理分支访问逻辑
 * 5. 返回文本或默认值(键名本身)
 * 
 * 命名约定:
 * - 构建系统会自动为所有消息键添加插件前缀
 * - 例如: "startup-begin" -> "ai-butler-startup-begin"
 * - 此函数优先查找带前缀的版本,确保正确匹配
 * 
 * @param localeString FTL 消息键名
 * @param options 配置选项
 * @returns 本地化后的文本
 */
function _getString(
  localeString: FluentMessageId,
  options: { branch?: string | undefined; args?: Record<string, unknown> } = {},
): string {
  // 构建带插件前缀的完整键名
  const localStringWithPrefix = `${config.addonRef}-${localeString}`;
  const { branch, args } = options;
  
  // 尝试查询带前缀的消息键
  const [patternPrefixed] = addon.data.locale?.current.formatMessagesSync([
    { id: localStringWithPrefix, args },
  ]) || [];
  
  // 如果带前缀的未找到,尝试查询原始键名(向后兼容)
  const [patternRaw] = (!patternPrefixed?.value) 
    ? (addon.data.locale?.current.formatMessagesSync([
        { id: localeString as string, args },
      ]) || [])
    : [];
  
  // 选择有效的模式对象
  const pattern = patternPrefixed?.value ? patternPrefixed : patternRaw;
  
  // 未找到消息定义时,返回键名本身作为默认值
  if (!pattern) {
    return localStringWithPrefix;
  }
  
  // 处理分支访问
  if (branch && pattern.attributes) {
    // 在属性列表中查找匹配的分支
    for (const attr of pattern.attributes) {
      if (attr.name === branch) {
        return attr.value;
      }
    }
    // 分支未找到时,返回键名作为默认值
    return pattern.attributes[branch] || localStringWithPrefix;
  } else {
    // 返回默认分支的文本
    return pattern.value || localStringWithPrefix;
  }
}

/**
 * 获取带插件前缀的完整消息键名
 * 
 * 用途:
 * - 在 FTL 文件中引用消息时需要完整键名
 * - 调试时显示实际使用的键名
 * - 与其他国际化系统集成时需要明确的标识
 * 
 * @param id FTL 消息键名
 * @returns 带插件前缀的完整键名
 * 
 * @example
 * ```typescript
 * const fullId = getLocaleID("startup-begin");
 * // 输出: "ai-butler-startup-begin"
 * ```
 */
function getLocaleID(id: FluentMessageId) {
  return `${config.addonRef}-${id}`;
}
