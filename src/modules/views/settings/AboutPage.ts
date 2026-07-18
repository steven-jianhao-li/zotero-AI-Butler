/**
 * 关于页面
 *
 * @file AboutPage.ts
 * @author AI Butler Team
 */

import { version, config, repository } from "../../../../package.json";
import { createCard, createStyledButton } from "../ui/components";
import { openInteractiveOnboardingTour } from "../../onboarding";
import { getString } from "../../../utils/locale";

export class AboutPage {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public render(): void {
    this.container.innerHTML = "";

    const doc = Zotero.getMainWindow().document;

    // 标题
    const title = doc.createElement("h2");
    title.textContent = getString("settings-about-title");
    Object.assign(title.style, {
      color: "#59c0bc",
      marginBottom: "20px",
      fontSize: "20px",
      borderBottom: "2px solid #59c0bc",
      paddingBottom: "10px",
    });
    this.container.appendChild(title);

    const tutorialButton = createStyledButton(
      getString("settings-about-open-tutorial"),
      "#00a67e",
      "medium",
    );
    tutorialButton.addEventListener("click", () => {
      void openInteractiveOnboardingTour("settings");
    });
    this.container.appendChild(tutorialButton);

    const aboutContent = doc.createElement("div");
    Object.assign(aboutContent.style, {
      padding: "0",
      maxWidth: "800px",
      display: "flex",
      flexDirection: "column",
      gap: "16px",
    });

    // 项目简介 - 从 README 获取
    const introContent = doc.createElement("div");
    introContent.innerHTML = `
      <blockquote style="margin: 0 0 15px 0; padding: 0; font-style: italic; color: #666; border-left: none;">
        <p style="margin: 5px 0; font-size: 15px;">${getString("settings-about-quote-line-1")}</p>
        <p style="margin: 5px 0; font-size: 15px;">${getString("settings-about-quote-line-2")}</p>
      </blockquote>
      <p style="font-size: 14px; color: #666; line-height: 1.8; margin-bottom: 10px;">
        ${getString("settings-about-intro-line-1")}
      </p>
      <p style="font-size: 14px; color: #666; line-height: 1.8; margin-bottom: 10px;">
        ${getString("settings-about-intro-line-2")}
      </p>
      <p style="font-size: 14px; color: #666; line-height: 1.8; margin-bottom: 10px;">
        ${getString("settings-about-intro-line-3-prefix")} <strong style="color: #59c0bc;">Zotero-AI-Butler</strong> ${getString("settings-about-intro-line-3-suffix")}
      </p>
      <p style="font-size: 14px; color: #666; line-height: 1.8;">
        ${getString("settings-about-intro-line-4")}
      </p>
      <p style="font-size: 14px; color: #666; line-height: 1.8;">
        ${getString("settings-about-intro-line-5")}
      </p>
      <p style="font-size: 14px; color: #666; line-height: 1.8;">
        ${getString("settings-about-intro-line-6")}
      </p>
    `;
    const introSection = createCard("generic", "", introContent, {
      accentColor: "#59c0bc",
    });
    aboutContent.appendChild(introSection);

    // 核心功能
    const featuresSection = createCard(
      "generic",
      getString("settings-about-features-title"),
    );
    const featuresBody = featuresSection.querySelector(
      ".ai-card__body",
    ) as HTMLElement;

    const featuresList = doc.createElement("ol");
    Object.assign(featuresList.style, {
      fontSize: "14px",
      color: "var(--ai-text-muted)",
      lineHeight: "1.8",
      paddingLeft: "20px",
    });

    const features = [
      {
        title: getString("settings-about-feature-auto-scan-title"),
        desc: getString("settings-about-feature-auto-scan-desc"),
      },
      {
        title: getString("settings-about-feature-deep-analysis-title"),
        desc: getString("settings-about-feature-deep-analysis-desc"),
      },
      {
        title: getString("settings-about-feature-context-menu-title"),
        desc: getString("settings-about-feature-context-menu-desc"),
      },
      {
        title: getString("settings-about-feature-lossless-reading-title"),
        desc: getString("settings-about-feature-lossless-reading-desc"),
      },
    ];

    features.forEach((f) => {
      const li = doc.createElement("li");
      Object.assign(li.style, {
        marginBottom: "10px",
      });
      li.innerHTML = `<strong>${f.title}</strong>: ${f.desc}`;
      featuresList.appendChild(li);
    });

    featuresBody.appendChild(featuresList);

    aboutContent.appendChild(featuresSection);

    // Slogan 单独作为一行 Callout，略微悬浮效果
    const sloganWrapper = doc.createElement("div");
    Object.assign(sloganWrapper.style, {
      display: "flex",
      justifyContent: "center",
      marginTop: "4px",
    });

    const slogan = doc.createElement("div");
    Object.assign(slogan.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "8px",
      fontSize: "13px",
      color: "var(--ai-text-muted)",
      padding: "8px 14px",
      borderRadius: "999px",
      background:
        "linear-gradient(135deg, rgba(89,192,188,0.14), rgba(89,192,188,0.02))",
      border: "1px solid rgba(89,192,188,0.25)",
      boxShadow: "0 4px 12px rgba(0,0,0,0.24)",
      backdropFilter: "blur(12px)",
      maxWidth: "420px",
      whiteSpace: "nowrap",
    });

    const sloganIcon = doc.createElement("span");
    sloganIcon.textContent = "✨";
    sloganIcon.style.color = "#59c0bc";

    const sloganText = doc.createElement("span");
    sloganText.textContent = getString("settings-about-slogan");

    slogan.appendChild(sloganIcon);
    slogan.appendChild(sloganText);
    sloganWrapper.appendChild(slogan);

    aboutContent.appendChild(sloganWrapper);

    // 项目信息
    const repoUrl =
      repository?.url?.replace(/^git\+/, "").replace(/\.git$/, "") ||
      "https://github.com/steven-jianhao-li/zotero-AI-Butler";

    const infoBody = doc.createElement("div");
    infoBody.innerHTML = `
      <p style="font-size: 14px; color: var(--ai-text-muted); margin: 8px 0;">
        <strong>${getString("settings-about-info-name")}:</strong> ${config.addonName || "Zotero AI Butler"}
      </p>
      <p style="font-size: 14px; color: var(--ai-text-muted); margin: 8px 0;">
        <strong>${getString("settings-about-info-version")}:</strong> ${version || "1.0.0"}
      </p>
      <p style="font-size: 14px; color: var(--ai-text-muted); margin: 8px 0;">
        <strong>${getString("settings-about-info-author")}:</strong> Steven Jianhao Li
      </p>
      <p style="font-size: 14px; color: var(--ai-text-muted); margin: 8px 0;">
        <strong>GitHub:</strong> <a href="${repoUrl}" target="_blank" style="color: #59c0bc; text-decoration: none;">${repoUrl}</a>
      </p>
      <p style="font-size: 14px; color: var(--ai-text-muted); margin: 8px 0;">
        <strong>${getString("settings-about-info-feedback")}:</strong> <a href="${repoUrl}/issues" target="_blank" style="color: #59c0bc; text-decoration: none;">${repoUrl}/issues</a>
      </p>
    `;

    const infoSection = createCard(
      "generic",
      getString("settings-about-info-title"),
      infoBody,
    );
    aboutContent.appendChild(infoSection);

    // 致谢
    this.container.appendChild(aboutContent);
  }
}
