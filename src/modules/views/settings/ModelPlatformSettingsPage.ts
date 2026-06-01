/**
 * 模型平台设置页面
 */

import { createNotice } from "../ui/components";
import { EndpointSettingsPanel } from "../ui/EndpointSettingsPanel";

export class ModelPlatformSettingsPage {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public render(): void {
    this.container.innerHTML = "";

    const title = Zotero.getMainWindow().document.createElement("h2");
    title.textContent = "🧩 模型平台";
    Object.assign(title.style, {
      color: "#59c0bc",
      marginBottom: "20px",
      fontSize: "20px",
      borderBottom: "2px solid #59c0bc",
      paddingBottom: "10px",
    });
    this.container.appendChild(title);

    this.container.appendChild(
      createNotice(
        "添加并管理一个或多个大模型供应商。这里负责供应商类型、API 地址、API 密钥、模型、路由策略、最大 API 请求次数和多模型同时总结。",
      ),
    );

    const endpointPanel = new EndpointSettingsPanel({
      modalHost: this.container,
      showTitle: false,
    });
    this.container.appendChild(endpointPanel.getElement());
  }
}
