export type OnboardingStepKind =
  | "welcome"
  | "entry"
  | "setup"
  | "firstTask"
  | "finish";

export interface OnboardingFeatureCard {
  icon: string;
  title: string;
  detail: string;
}

export interface OnboardingAction {
  id:
    | "openSetupWizard"
    | "openSettings"
    | "openScanner"
    | "openTasks"
    | "openDocs"
    | "finish"
    | "dismiss";
  label: string;
  color: string;
}

export interface OnboardingStep {
  id: OnboardingStepKind;
  eyebrow: string;
  title: string;
  description: string;
  cards: OnboardingFeatureCard[];
  actions: OnboardingAction[];
}

export const ONBOARDING_DOCS_URL =
  "https://steven-jianhao-li.github.io/zotero-AI-Butler/";

export const onboardingSteps: OnboardingStep[] = [
  {
    id: "welcome",
    eyebrow: "第 1 步 / 欢迎",
    title: "欢迎使用 Zotero AI Butler",
    description:
      "用 3 分钟完成基础配置后，你就可以让 AI 管家总结论文、生成精读、追问全文、做一图总结和管理任务队列。",
    cards: [
      {
        icon: "📝",
        title: "AI 总结与精读",
        detail:
          "从选中文献或批量扫描开始，自动生成可保存在 Zotero 中的结构化笔记。",
      },
      {
        icon: "💬",
        title: "基于论文追问",
        detail: "在侧边栏或阅读器中围绕全文、附件内容和已有 AI 笔记继续提问。",
      },
      {
        icon: "📋",
        title: "后台任务队列",
        detail: "长任务会进入队列，方便暂停、查看进度、重试失败任务。",
      },
    ],
    actions: [],
  },
  {
    id: "entry",
    eyebrow: "第 2 步 / 界面入口",
    title: "先认识四个常用入口",
    description:
      "不同设备和 Zotero 主题下入口位置可能略有差异，因此教程使用稳定的图文说明，不依赖脆弱的坐标高亮。",
    cards: [
      {
        icon: "🤖",
        title: "顶部工具栏 AI 管家",
        detail:
          "点击文献列表上方的 🤖/AI 管家按钮，可以打开仪表盘、任务队列和快捷设置。",
      },
      {
        icon: "🖱️",
        title: "右键论文",
        detail:
          "选中一篇或多篇论文后右键，可立即生成总结、精读、思维导图、一图总结或追问。",
      },
      {
        icon: "📚",
        title: "右键分类/集合",
        detail:
          "在集合上右键，可做文献综述、批量表格填充、清理或导出 AI 笔记。",
      },
      {
        icon: "📌",
        title: "条目侧边栏",
        detail:
          "选中文献后，侧边栏会显示操作按钮、AI 笔记、一图总结、思维导图和快速追问。",
      },
    ],
    actions: [],
  },
  {
    id: "setup",
    eyebrow: "第 3 步 / 初始化配置",
    title: "配置模型 API Key",
    description:
      "如果你是第一次使用，推荐先用一键初始化配置。它会写入模型端点、PDF 处理模式和常用参数，避免手动填写出错。",
    cards: [
      {
        icon: "🔑",
        title: "准备 API Key",
        detail: "打开供应商平台创建 API Key；密钥只保存在本机 Zotero 配置中。",
      },
      {
        icon: "🧭",
        title: "一键初始化",
        detail: "选择推荐预设、粘贴密钥、确认变更后即可开始使用。",
      },
      {
        icon: "⚙️",
        title: "高级设置",
        detail:
          "需要多个模型端点、PDF 模式或自定义提示词时，可以进入快捷设置继续调整。",
      },
    ],
    actions: [
      { id: "openSetupWizard", label: "一键初始化配置", color: "#00a67e" },
      { id: "openSettings", label: "打开快捷设置", color: "#607d8b" },
    ],
  },
  {
    id: "firstTask",
    eyebrow: "第 4 步 / 第一个任务",
    title: "生成第一篇 AI 总结",
    description:
      "配置完成后，建议先从一篇带 PDF 附件的论文开始。你也可以直接扫描库中还没有 AI 笔记的论文。",
    cards: [
      {
        icon: "1️⃣",
        title: "选择论文",
        detail: "在 Zotero 中选中一篇有 PDF 附件的论文。",
      },
      {
        icon: "2️⃣",
        title: "右键生成总结",
        detail: "右键论文，选择 AI 管家中的生成总结；任务会进入队列。",
      },
      {
        icon: "3️⃣",
        title: "查看结果",
        detail:
          "完成后回到条目侧边栏或 Zotero 笔记列表查看 AI-Generated 笔记。",
      },
    ],
    actions: [
      { id: "openScanner", label: "扫描未总结论文", color: "#2196f3" },
      { id: "openTasks", label: "查看任务队列", color: "#9c27b0" },
    ],
  },
  {
    id: "finish",
    eyebrow: "第 5 步 / 完成",
    title: "你已经准备好了",
    description:
      "之后可以在仪表盘随时重温教程。遇到问题时，先检查任务队列和 API 配置，再查看在线文档。",
    cards: [
      {
        icon: "✅",
        title: "完成教程",
        detail: "点击完成后，本设备不会再自动弹出当前版本的新手教程。",
      },
      {
        icon: "🔁",
        title: "随时重温",
        detail: "仪表盘中的“新手教程 / 重温教程”会一直保留。",
      },
      {
        icon: "📖",
        title: "在线文档",
        detail: "文档包含更多供应商配置、提示词、批处理和常见问题说明。",
      },
    ],
    actions: [
      { id: "openDocs", label: "打开在线文档", color: "#3f51b5" },
      { id: "finish", label: "完成教程", color: "#00a67e" },
    ],
  },
];
