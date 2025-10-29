/**
 * 关于页面
 * 
 * @file AboutPage.ts
 * @author AI Butler Team
 */

import { version, config, repository } from "../../../../package.json";

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
    title.textContent = "ℹ️ 关于";
    Object.assign(title.style, {
      color: "#59c0bc",
      marginBottom: "20px",
      fontSize: "20px",
      borderBottom: "2px solid #59c0bc",
      paddingBottom: "10px",
    });
    this.container.appendChild(title);

    const aboutContent = doc.createElement("div");
    Object.assign(aboutContent.style, {
      padding: "0",
      maxWidth: "800px",
    });
    
    // 项目简介 - 从 README 获取
    const introSection = doc.createElement("div");
    Object.assign(introSection.style, {
      marginBottom: "30px",
      padding: "20px",
      backgroundColor: "#f9f9f9",
      borderRadius: "8px",
      borderLeft: "4px solid #59c0bc",
    });
    
    introSection.innerHTML = `
      <blockquote style="margin: 0 0 15px 0; padding: 0; font-style: italic; color: #666; border-left: none;">
        <p style="margin: 5px 0; font-size: 15px;">文献下载一时爽，打开阅读火葬场。</p>
        <p style="margin: 5px 0; font-size: 15px;">天书难啃骨头硬，管家嚼碎再喂粮。</p>
      </blockquote>
      <p style="font-size: 14px; color: #666; line-height: 1.8; margin-bottom: 10px;">
        想着稍后阅读的论文，最后却变成了永不阅读？
      </p>
      <p style="font-size: 14px; color: #666; line-height: 1.8; margin-bottom: 10px;">
        长篇大论的学术论文，有翻译却也抓不住重点？
      </p>
      <p style="font-size: 14px; color: #666; line-height: 1.8; margin-bottom: 10px;">
        别慌！您的专属AI管家 <strong style="color: #59c0bc;">Zotero-AI-Butler</strong> 已闪亮登场！
      </p>
      <p style="font-size: 14px; color: #666; line-height: 1.8;">
        TA 是您7x24小时待命、不知疲倦且绝对忠诚的私人管家。
      </p>
      <p style="font-size: 14px; color: #666; line-height: 1.8;">
        您只管像往常一样把文献丢进 Zotero，剩下的体力活全交给TA！
      </p>
      <p style="font-size: 14px; color: #666; line-height: 1.8;">
        管家会自动帮您精读论文，将文章揉碎了总结为笔记，让您"十分钟完全了解"这篇论文！
      </p>
    `;
    aboutContent.appendChild(introSection);

    // 核心功能
    const featuresSection = doc.createElement("div");
    Object.assign(featuresSection.style, {
      marginBottom: "30px",
    });
    
    const featuresTitle = doc.createElement("h3");
    featuresTitle.textContent = "核心功能";
    Object.assign(featuresTitle.style, {
      fontSize: "16px",
      fontWeight: "600",
      marginBottom: "12px",
      color: "#333",
    });
    featuresSection.appendChild(featuresTitle);
    
    const featuresList = doc.createElement("ol");
    Object.assign(featuresList.style, {
      fontSize: "14px",
      color: "#666",
      lineHeight: "1.8",
      paddingLeft: "20px",
    });
    
    const features = [
      {
        title: "自动巡视 (自动扫描)",
        desc: "管家会在后台默默巡视您的文献库，一旦发现您丢进来了新论文（或是您积压已久的旧论文），只要还没有笔记，TA 就会自动开工。"
      },
      {
        title: "深度解析 (生成笔记)",
        desc: "管家的核心任务——利用大模型将论文精读、揉碎、嚼烂后，整理成一份热腾腾、条理清晰的 Markdown 笔记塞进您的 Zotero 条目下。"
      },
      {
        title: "随时待命 (右键菜单)",
        desc: "除了全自动托管，您也可以随时右键点击任何一篇论文，让管家现在、立刻、最高优先级地分析这篇文章。"
      },
      {
        title: "管家智能（无损阅读）",
        desc: "管家会根据自己模型的多模态能力直接处理PDF文件，不经过本地OCR或文本提取，最大程度保留论文内容的完整性和准确性，图片、表格、公式等都不在话下！"
      }
    ];
    
    features.forEach(f => {
      const li = doc.createElement("li");
      Object.assign(li.style, {
        marginBottom: "10px",
      });
      li.innerHTML = `<strong>${f.title}</strong>: ${f.desc}`;
      featuresList.appendChild(li);
    });
    
    featuresSection.appendChild(featuresList);
    
    const recommendation = doc.createElement("p");
    Object.assign(recommendation.style, {
      fontSize: "14px",
      color: "#666",
      lineHeight: "1.6",
      marginTop: "15px",
      padding: "10px",
      backgroundColor: "#fffbea",
      borderRadius: "4px",
    });
    recommendation.innerHTML = `💡 <strong>推荐使用 Google Gemini 2.5 pro 模型，Gemini读论文讲的很到位。</strong>`;
    featuresSection.appendChild(recommendation);
    
    const slogan = doc.createElement("p");
    Object.assign(slogan.style, {
      fontSize: "15px",
      color: "#59c0bc",
      fontWeight: "600",
      textAlign: "center",
      marginTop: "20px",
      padding: "15px",
      backgroundColor: "#f0f9f8",
      borderRadius: "6px",
    });
    slogan.textContent = "您只负责思考，Zotero-AI-Butler 负责为您的阅读扫清障碍！";
    featuresSection.appendChild(slogan);
    
    aboutContent.appendChild(featuresSection);

    // 项目信息
    const infoSection = doc.createElement("div");
    Object.assign(infoSection.style, {
      marginBottom: "30px",
      padding: "20px",
      backgroundColor: "#f5f5f5",
      borderRadius: "8px",
    });
    
    const repoUrl = repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '') || 
                    "https://github.com/steven-jianhao-li/zotero-AI-Butler";
    
    infoSection.innerHTML = `
      <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 12px; color: #333;">项目信息</h3>
      <p style="font-size: 14px; color: #666; margin: 8px 0;">
        <strong>名称:</strong> ${config.addonName || "Zotero AI Butler"}
      </p>
      <p style="font-size: 14px; color: #666; margin: 8px 0;">
        <strong>版本:</strong> ${version || "1.0.0"}
      </p>
      <p style="font-size: 14px; color: #666; margin: 8px 0;">
        <strong>作者:</strong> Steven Jianhao Li
      </p>
      <p style="font-size: 14px; color: #666; margin: 8px 0;">
        <strong>GitHub:</strong> <a href="${repoUrl}" target="_blank" style="color: #59c0bc; text-decoration: none;">${repoUrl}</a>
      </p>
      <p style="font-size: 14px; color: #666; margin: 8px 0;">
        <strong>问题反馈:</strong> <a href="${repoUrl}/issues" target="_blank" style="color: #59c0bc; text-decoration: none;">${repoUrl}/issues</a>
      </p>
    `;
    aboutContent.appendChild(infoSection);

    // 致谢
    const thanksSection = doc.createElement("div");
    Object.assign(thanksSection.style, {
      paddingTop: "20px",
      borderTop: "1px solid #e0e0e0",
    });
        
    this.container.appendChild(aboutContent);
  }
}
