/**
 * ================================================================
 * 偏好设置管理工具模块
 * ================================================================
 *
 * 本模块提供统一的配置读写接口,封装了 Zotero 偏好设置 API
 *
 * 主要职责:
 * 1. 提供类型安全的配置项访问接口
 * 2. 自动处理配置键的命名空间前缀
 * 3. 简化配置的读取、设置和清除操作
 *
 * 技术特点:
 * - 使用 TypeScript 泛型确保类型安全
 * - 封装 Zotero.Prefs API,提供更简洁的调用方式
 * - 支持插件特定的配置命名空间,避免与其他插件冲突
 *
 * 使用示例:
 * ```typescript
 * // 读取配置
 * const openaiApiKey = getPref("openaiApiKey");
 *
 * // 设置配置
 * setPref("openaiApiKey", "sk-xxxxx");
 *
 * // 清除配置
 * clearPref("openaiApiKey");
 * ```
 *
 * @module prefs
 * @author AI-Butler Team
 */

import { config } from "../../package.json";

/**
 * 插件偏好设置映射类型
 * 定义了所有可用的配置项及其类型
 */
type PluginPrefsMap = _ZoteroTypes.Prefs["PluginPrefsMap"];

/**
 * 配置键前缀
 * 所有配置项都会自动添加此前缀,形成完整的配置键
 * 例如: "ai-butler.openaiApiKey"
 */
const PREFS_PREFIX = config.prefsPrefix;

/**
 * 获取偏好设置值
 *
 * 从 Zotero 偏好系统中读取指定配置项的值
 *
 * 类型安全:
 * - 使用泛型约束 key 必须是 PluginPrefsMap 的有效键
 * - 返回值类型自动推断为对应配置项的类型
 *
 * 命名空间:
 * - 自动添加插件前缀,无需手动拼接完整键名
 * - 使用分支配置模式(参数 true),支持插件特定配置
 *
 * @template K 配置键类型,必须是 PluginPrefsMap 的键
 * @param key 配置键名(不包含前缀)
 * @returns 配置值,类型由 PluginPrefsMap 定义
 *
 * @example
 * ```typescript
 * // 读取 API 密钥(类型: string)
 * const openaiApiKey = getPref("openaiApiKey");
 *
 * // 读取流式开关(类型: boolean)
 * const streamEnabled = getPref("stream");
 * ```
 */
export function getPref<K extends keyof PluginPrefsMap>(key: K) {
  return Zotero.Prefs.get(`${PREFS_PREFIX}.${key}`, true) as PluginPrefsMap[K];
}

/**
 * 设置偏好设置值
 *
 * 将指定值保存到 Zotero 偏好系统
 *
 * 类型安全:
 * - value 的类型必须与配置键对应的类型匹配
 * - TypeScript 编译时会进行类型检查,防止类型错误
 *
 * 持久化:
 * - 设置的值会立即保存到 Zotero 的偏好存储
 * - 偏好值在 Zotero 重启后依然保留
 *
 * @template K 配置键类型,必须是 PluginPrefsMap 的键
 * @param key 配置键名(不包含前缀)
 * @param value 要设置的值,类型必须匹配配置项定义
 * @returns Zotero.Prefs.set 的返回值
 *
 * @example
 * ```typescript
 * // 设置 API 密钥
 * setPref("openaiApiKey", "sk-xxxxx");
 *
 * // 设置模型名称
 * setPref("openaiApiModel", "gpt-4");
 *
 * // 设置流式开关
 * setPref("stream", true);
 * ```
 */
export function setPref<K extends keyof PluginPrefsMap>(
  key: K,
  value: PluginPrefsMap[K],
) {
  return Zotero.Prefs.set(`${PREFS_PREFIX}.${key}`, value, true);
}

/**
 * 清除偏好设置值
 *
 * 从 Zotero 偏好系统中删除指定配置项
 *
 * 用途:
 * - 重置配置项到默认状态
 * - 清理过时或无效的配置
 * - 执行配置迁移时移除旧配置键
 *
 * 注意事项:
 * - 清除后,getPref 将返回 undefined(直到重新设置)
 * - 系统级默认值(如果有)可能会生效
 *
 * @param key 配置键名(不包含前缀)
 * @returns Zotero.Prefs.clear 的返回值
 *
 * @example
 * ```typescript
 * // 清除 API 密钥
 * clearPref("openaiApiKey");
 *
 * // 清除自定义提示词(恢复到默认提示词)
 * clearPref("summaryPrompt");
 * ```
 */
export function clearPref(key: string) {
  return Zotero.Prefs.clear(`${PREFS_PREFIX}.${key}`, true);
}
