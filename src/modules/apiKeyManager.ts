/**
 * API 密钥管理器
 *
 * 管理多个 API 密钥，支持等权重轮换、失败标记和冷却机制
 * 设计原则：所有密钥等权重，依次轮流调用；向后兼容单密钥用户
 *
 * @file apiKeyManager.ts
 * @author AI Butler Team
 */

import { getPref, setPref } from "../utils/prefs";

/**
 * 支持的提供商 ID
 */
export type ProviderId =
  | "openai"
  | "openai-compat"
  | "google"
  | "anthropic"
  | "openrouter";

/**
 * 提供商密钥配置映射
 */
interface ProviderKeyMapping {
  /** 第一个密钥的偏好设置名称（向后兼容） */
  primaryPrefKey: string;
  /** 额外密钥列表偏好设置名称（JSON 数组） */
  extraKeysPrefKey: string;
}

/**
 * 提供商密钥配置映射表
 */
const PROVIDER_KEY_MAPPINGS: Record<ProviderId, ProviderKeyMapping> = {
  openai: {
    primaryPrefKey: "openaiApiKey",
    extraKeysPrefKey: "openaiApiKeysFallback",
  },
  "openai-compat": {
    primaryPrefKey: "openaiCompatApiKey",
    extraKeysPrefKey: "openaiCompatApiKeysFallback",
  },
  google: {
    primaryPrefKey: "geminiApiKey",
    extraKeysPrefKey: "geminiApiKeysFallback",
  },
  anthropic: {
    primaryPrefKey: "anthropicApiKey",
    extraKeysPrefKey: "anthropicApiKeysFallback",
  },
  openrouter: {
    primaryPrefKey: "openRouterApiKey",
    extraKeysPrefKey: "openRouterApiKeysFallback",
  },
};

/**
 * 运行时轮换状态（每个提供商）
 */
interface RotationState {
  /** 当前活动的密钥索引 */
  currentIndex: number;
  /** 失败的密钥记录（key -> failedAt timestamp） */
  failedKeys: Map<string, number>;
  /** 成功调用计数（用于轮换） */
  successCount: number;
}

/**
 * API 密钥管理器类
 */
export class ApiKeyManager {
  /** 轮换状态缓存（运行时，不持久化） */
  private static rotationStates: Map<ProviderId, RotationState> = new Map();

  /**
   * 获取提供商的所有密钥
   * 合并第一个密钥（向后兼容）和额外密钥列表
   *
   * @param providerId 提供商ID
   * @returns 密钥数组
   */
  static getAllKeys(providerId: ProviderId): string[] {
    const mapping = PROVIDER_KEY_MAPPINGS[providerId];
    if (!mapping) {
      return [];
    }

    const keys: string[] = [];

    // 1. 获取第一个密钥（向后兼容原有用户）
    const firstKey = (
      (getPref(mapping.primaryPrefKey as any) as string) || ""
    ).trim();
    if (firstKey) {
      keys.push(firstKey);
    }

    // 2. 获取额外密钥列表
    try {
      const json =
        (getPref(mapping.extraKeysPrefKey as any) as string) || "[]";
      const extraKeys = JSON.parse(json) as string[];
      if (Array.isArray(extraKeys)) {
        for (const k of extraKeys) {
          const key = (k || "").trim();
          if (key && !keys.includes(key)) {
            keys.push(key);
          }
        }
      }
    } catch (e) {
      ztoolkit.log(`[ApiKeyManager] 解析额外密钥失败: ${e}`);
    }

    return keys;
  }

  /**
   * 获取当前活动的密钥
   * 正常情况下轮流使用所有密钥；如有失败密钥则跳过冷却中的
   *
   * @param providerId 提供商ID
   * @returns 当前活动密钥，如无可用密钥返回空字符串
   */
  static getCurrentKey(providerId: ProviderId): string {
    const allKeys = this.getAllKeys(providerId);
    if (allKeys.length === 0) {
      return "";
    }

    const state = this.getRotationState(providerId);
    const cooldown = this.getFailedKeyCooldown();
    const now = Date.now();

    // 确保索引在范围内
    if (state.currentIndex >= allKeys.length) {
      state.currentIndex = 0;
    }

    // 从当前索引开始查找可用密钥（跳过冷却中的）
    for (let i = 0; i < allKeys.length; i++) {
      const index = (state.currentIndex + i) % allKeys.length;
      const key = allKeys[index];
      const failedAt = state.failedKeys.get(key);

      // 如果未失败或已过冷却期，使用该密钥
      if (!failedAt || now - failedAt > cooldown) {
        if (i !== 0) {
          state.currentIndex = index;
        }
        return key;
      }
    }

    // 所有密钥都在冷却中，返回当前索引的密钥（尽力而为）
    return allKeys[state.currentIndex];
  }

  /**
   * 请求成功后调用，移动到下一个密钥（等权重轮换）
   *
   * @param providerId 提供商ID
   */
  static advanceToNextKey(providerId: ProviderId): void {
    const allKeys = this.getAllKeys(providerId);
    if (allKeys.length <= 1) {
      return; // 只有一个密钥，无需轮换
    }

    const state = this.getRotationState(providerId);
    state.currentIndex = (state.currentIndex + 1) % allKeys.length;
    state.successCount++;
    ztoolkit.log(
      `[ApiKeyManager] 成功后轮换到下一个密钥 ${state.currentIndex + 1}/${allKeys.length}`,
    );
  }

  /**
   * 轮换到下一个可用密钥（错误时调用）
   *
   * @param providerId 提供商ID
   * @returns 是否成功轮换（如果没有更多可用密钥返回 false）
   */
  static rotateToNextKey(providerId: ProviderId): boolean {
    const allKeys = this.getAllKeys(providerId);
    if (allKeys.length <= 1) {
      return false; // 只有一个密钥，无法轮换
    }

    const state = this.getRotationState(providerId);
    const cooldown = this.getFailedKeyCooldown();
    const now = Date.now();
    const startIndex = state.currentIndex;

    // 标记当前密钥为失败
    const currentKey = allKeys[state.currentIndex];
    state.failedKeys.set(currentKey, now);

    // 查找下一个可用密钥
    for (let i = 1; i < allKeys.length; i++) {
      const nextIndex = (startIndex + i) % allKeys.length;
      const key = allKeys[nextIndex];
      const failedAt = state.failedKeys.get(key);

      // 如果未失败或已过冷却期
      if (!failedAt || now - failedAt > cooldown) {
        state.currentIndex = nextIndex;
        ztoolkit.log(
          `[ApiKeyManager] 错误后轮换到密钥 ${nextIndex + 1}/${allKeys.length} (${this.maskKey(key)})`,
        );
        return true;
      }
    }

    // 所有密钥都在冷却中
    ztoolkit.log(`[ApiKeyManager] 所有密钥都在冷却中，无法轮换`);
    return false;
  }

  /**
   * 重置轮换状态
   *
   * @param providerId 提供商ID
   */
  static resetRotation(providerId: ProviderId): void {
    // 成功后不重置索引，保持轮换
    // 只有在用户明确要求时才重置
  }

  /**
   * 获取额外密钥列表
   *
   * @param providerId 提供商ID
   * @returns 额外密钥数组
   */
  static getExtraKeys(providerId: ProviderId): string[] {
    const mapping = PROVIDER_KEY_MAPPINGS[providerId];
    if (!mapping) {
      return [];
    }

    try {
      const json =
        (getPref(mapping.extraKeysPrefKey as any) as string) || "[]";
      const keys = JSON.parse(json) as string[];
      return Array.isArray(keys) ? keys : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * 保存额外密钥列表
   *
   * @param providerId 提供商ID
   * @param keys 密钥数组
   */
  static saveExtraKeys(providerId: ProviderId, keys: string[]): void {
    const mapping = PROVIDER_KEY_MAPPINGS[providerId];
    if (!mapping) {
      return;
    }

    const cleanKeys = keys.filter((k) => k && k.trim());
    setPref(mapping.extraKeysPrefKey as any, JSON.stringify(cleanKeys));
    ztoolkit.log(
      `[ApiKeyManager] 保存额外密钥: ${providerId} (${cleanKeys.length} 个)`,
    );
  }

  /**
   * 添加额外密钥
   *
   * @param providerId 提供商ID
   * @param key 密钥值
   */
  static addExtraKey(providerId: ProviderId, key: string): void {
    const keys = this.getExtraKeys(providerId);
    const trimmedKey = key.trim();
    if (trimmedKey && !keys.includes(trimmedKey)) {
      keys.push(trimmedKey);
      this.saveExtraKeys(providerId, keys);
    }
  }

  /**
   * 移除额外密钥
   *
   * @param providerId 提供商ID
   * @param index 密钥在额外列表中的索引
   */
  static removeExtraKey(providerId: ProviderId, index: number): void {
    const keys = this.getExtraKeys(providerId);
    if (index >= 0 && index < keys.length) {
      keys.splice(index, 1);
      this.saveExtraKeys(providerId, keys);
    }
  }

  /**
   * 获取最大切换次数
   */
  static getMaxSwitchCount(): number {
    const raw = (getPref("maxApiSwitchCount" as any) as string) || "3";
    const val = parseInt(raw, 10);
    return isNaN(val) || val < 1 ? 3 : val;
  }

  /**
   * 获取失败密钥冷却时间（毫秒）
   */
  static getFailedKeyCooldown(): number {
    const raw = (getPref("failedKeyCooldown" as any) as string) || "300000";
    const val = parseInt(raw, 10);
    return isNaN(val) || val < 0 ? 300000 : val;
  }

  /**
   * 检查提供商是否配置了多个密钥
   *
   * @param providerId 提供商ID
   * @returns 是否有多个可用密钥
   */
  static hasMultipleKeys(providerId: ProviderId): boolean {
    return this.getAllKeys(providerId).length > 1;
  }

  /**
   * 获取密钥数量
   *
   * @param providerId 提供商ID
   * @returns 密钥数量
   */
  static getKeyCount(providerId: ProviderId): number {
    return this.getAllKeys(providerId).length;
  }

  /**
   * 获取当前密钥的显示信息（遮罩后）
   *
   * @param providerId 提供商ID
   * @returns 遮罩后的密钥信息
   */
  static getCurrentKeyMasked(providerId: ProviderId): string {
    const key = this.getCurrentKey(providerId);
    return this.maskKey(key);
  }

  // ==================== 私有方法 ====================

  /**
   * 获取或初始化轮换状态
   */
  private static getRotationState(providerId: ProviderId): RotationState {
    let state = this.rotationStates.get(providerId);
    if (!state) {
      state = {
        currentIndex: 0,
        failedKeys: new Map(),
        successCount: 0,
      };
      this.rotationStates.set(providerId, state);
    }
    return state;
  }

  /**
   * 遮罩密钥（只显示前4位和后4位）
   */
  static maskKey(key: string): string {
    if (!key) {
      return "(空)";
    }
    // 短密钥直接显示
    if (key.length <= 8) {
      return key;
    }
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  }
}

export default ApiKeyManager;
