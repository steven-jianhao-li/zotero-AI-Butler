/**
 * 模型平台设置页面
 */

import { getString } from "../../../utils/locale";
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
    title.textContent = getString("settings-model-platform-title");
    Object.assign(title.style, {
      color: "#59c0bc",
      marginBottom: "20px",
      fontSize: "20px",
      borderBottom: "2px solid #59c0bc",
      paddingBottom: "10px",
    });
    this.container.appendChild(title);

    this.container.appendChild(
      createNotice(getString("settings-model-platform-description")),
    );

    const endpointPanel = new EndpointSettingsPanel({
      modalHost: this.container,
      showTitle: false,
    });
    this.container.appendChild(endpointPanel.getElement());
  }
}
