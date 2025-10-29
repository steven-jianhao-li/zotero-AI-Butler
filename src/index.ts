/**
 * ================================================================
 * AI-Butler 插件主入口文件
 * ================================================================
 * 
 * 本文件负责插件的全局初始化工作,主要职责包括:
 * 1. 实例化插件主对象(Addon)并注册到全局命名空间
 * 2. 设置全局工具对象(ztoolkit)的访问器
 * 3. 确保插件单例模式,防止重复初始化
 * 
 * 技术说明:
 * - 使用 Zotero 插件工具包(zotero-plugin-toolkit)提供的基础工具类
 * - 通过全局属性定义确保在整个插件生命周期中可以访问核心对象
 * - 遵循 Zotero 7.x 的插件架构规范
 * 
 * @module index
 * @author AI-Butler Team
 */

import { BasicTool } from "zotero-plugin-toolkit";
import Addon from "./addon";
import { config } from "../package.json";

// 创建基础工具实例,用于访问全局对象和执行基础操作
const basicTool = new BasicTool();

/**
 * 插件初始化逻辑
 * 检查插件实例是否已经存在,如果不存在则创建新实例
 * 这种设计确保了插件在 Zotero 环境中的唯一性
 */
// @ts-expect-error - Zotero 全局对象的插件实例属性未在类型定义中声明
if (!basicTool.getGlobal("Zotero")[config.addonInstance]) {
  // 创建插件实例并挂载到全局对象
  _globalThis.addon = new Addon();
  
  // 定义 ztoolkit 全局访问器,提供便捷的工具集访问方式
  defineGlobal("ztoolkit", () => {
    return _globalThis.addon.data.ztoolkit;
  });
  
  // 将插件实例注册到 Zotero 全局对象,使其可在整个应用中访问
  // @ts-expect-error - Zotero 全局对象的插件实例属性未在类型定义中声明
  Zotero[config.addonInstance] = addon;
}

/**
 * 全局对象定义辅助函数(重载签名1)
 * 根据名称定义一个全局可访问的对象引用
 * 
 * @param name - 要定义的全局对象名称,需为 BasicTool.getGlobal 支持的类型
 */
function defineGlobal(name: Parameters<BasicTool["getGlobal"]>[0]): void;

/**
 * 全局对象定义辅助函数(重载签名2)
 * 通过自定义 getter 函数定义全局对象
 * 
 * @param name - 全局对象名称(字符串形式)
 * @param getter - 返回目标对象的 getter 函数
 */
function defineGlobal(name: string, getter: () => any): void;

/**
 * 全局对象定义辅助函数(实现)
 * 在全局对象上定义属性,支持延迟求值
 * 
 * @param name - 全局对象名称
 * @param getter - 可选的 getter 函数,如果未提供则使用 basicTool.getGlobal
 * 
 * 实现细节:
 * - 使用 Object.defineProperty 确保属性定义的灵活性
 * - getter 方式避免了在定义时就执行对象创建,支持延迟初始化
 * - 这种模式在 Zotero 插件开发中很常见,用于处理复杂的依赖关系
 */
function defineGlobal(name: string, getter?: () => any) {
  Object.defineProperty(_globalThis, name, {
    get() {
      return getter ? getter() : basicTool.getGlobal(name);
    },
  });
}
