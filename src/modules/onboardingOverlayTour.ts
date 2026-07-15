import {
  getSummaryTaskId,
  TaskQueueManager,
  TaskStatus,
  type TaskItem,
} from "./taskQueue";
import { MainWindow } from "./views/MainWindow";
import { showSetupWizard } from "./views/SetupWizard";

export type OverlayTourSource = "startup" | "dashboard" | "settings";

type OverlayTourPlacement = "top" | "right" | "bottom" | "left" | "center";
type OverlayTourCardDock = "bottom" | "right";
type OverlayTourHost = "zotero" | "aiButler";
type OverlayTourStageId =
  | "entry"
  | "pages"
  | "setup"
  | "modelTest"
  | "library"
  | "summary"
  | "export"
  | "deepRead";

type OverlayTourStep = {
  id: string;
  stageId: OverlayTourStageId;
  stageTitle: string;
  title: string;
  description: string;
  host?: OverlayTourHost;
  target?: string | ((doc: Document) => Element | null);
  targetRect?: (doc: Document, win: Window) => DOMRect | null;
  placement?: OverlayTourPlacement;
  cardDock?: OverlayTourCardDock;
  nextLabel?: string;
  action?: {
    label: string;
    run: () => void | Promise<void>;
    advance?: boolean;
    enabled?: (state: OverlayTourState) => boolean;
    disabledLabel?: string;
  };
  requireTargetClick?: boolean;
  advanceOnTargetClick?: boolean;
  advanceOnSetupApplied?: boolean;
  advanceDelayMs?: number;
  waitForVisibleSelectors?: string[];
  secondaryAction?: {
    label: string;
    run: () => void | Promise<void>;
  };
  fallbackDescription?: string;
};

type OverlayTourOptions = {
  onComplete: () => void;
};

type OverlayTourState = {
  win: Window;
  doc: Document;
  root: HTMLElement;
  masks: HTMLElement[];
  highlight: HTMLElement;
  card: HTMLElement;
  index: number;
  steps: OverlayTourStep[];
  options: OverlayTourOptions;
  reposition: () => void;
  keyHandler: (event: KeyboardEvent) => void;
  clickHandler: (event: MouseEvent) => void;
  setupAppliedHandler: () => void;
  targetClickCleanup: (() => void) | null;
  confettiStepId: string | null;
  importStartedAt: number | null;
  trackedItemId: number | null;
  trackedSummaryTaskId: string | null;
  importObserverId: string | null;
  importPollTimer: number | null;
  taskProgressCleanup: (() => void) | null;
};

const OVERLAY_ID = "ai-butler-onboarding-overlay-tour";
const CARD_WIDTH = 420;

let activeTour: OverlayTourState | null = null;

export async function startOnboardingOverlayTour(
  source: OverlayTourSource,
  options: OverlayTourOptions,
): Promise<boolean> {
  if (source !== "startup") {
    MainWindow.getInstance().close();
    await delay(120);
  }

  const steps = buildTourSteps();
  const initial = getStepWindow(steps[0]);
  const doc = initial?.document;
  if (!initial || !doc?.documentElement) return false;

  closeOnboardingOverlayTour();

  const state = createTourState(initial, steps, options);
  activeTour = state;
  attachTourEvents(state);

  ztoolkit.log(`[AI-Butler] 启动覆盖式新手教程: ${source}`);
  renderActiveStep();
  return true;
}

export function closeOnboardingOverlayTour(): void {
  if (!activeTour) return;
  const state = activeTour;
  detachTourEvents(state);
  stopImportTracking(state);
  state.root.remove();
  activeTour = null;
}

function buildTourSteps(): OverlayTourStep[] {
  return [
    {
      id: "entry-toolbar",
      stageId: "entry",
      stageTitle: "AI 管家仪表盘",
      title: "AI 管家仪表盘",
      description:
        "文献库工具栏上的 🤖 会打开 AI 管家仪表盘。请直接点击这个真实按钮，教程会自动进入下一步。",
      host: "zotero",
      target: "#ai-butler-library-toolbar-btn",
      placement: "bottom",
      requireTargetClick: true,
      advanceOnTargetClick: true,
      advanceDelayMs: 550,
      fallbackDescription:
        "如果没有看到 🤖 按钮，请确认当前在 Zotero 文献库主窗口，并等待插件工具栏加载完成。",
    },
    {
      id: "content-dashboard",
      stageId: "pages",
      stageTitle: "四个页面",
      title: "仪表盘内容区",
      description:
        "点击 🤖 后默认进入仪表盘。这里上方显示管家状态和处理统计，下方是快捷操作。后面的一键初始化配置就在这里点击。",
      host: "aiButler",
      target: "#ai-butler-dashboard-view",
      placement: "left",
      cardDock: "bottom",
    },
    {
      id: "page-summary",
      stageId: "pages",
      stageTitle: "四个页面",
      title: "页面 2：AI 总结",
      description:
        "请点击高亮的“AI 总结”页签。点击后，下一步会展示 AI 总结内容区。",
      host: "aiButler",
      target: "#tab-summary",
      placement: "bottom",
      requireTargetClick: true,
      advanceOnTargetClick: true,
      advanceDelayMs: 80,
    },
    {
      id: "content-summary",
      stageId: "pages",
      stageTitle: "四个页面",
      title: "AI 总结内容区",
      description:
        "这里用于展示总结输出、后续追问和总结结果。以后从右键论文或侧边栏进入时，会在这里看到更完整的生成过程。",
      host: "aiButler",
      target: "#ai-butler-summary-view",
      placement: "left",
      cardDock: "bottom",
    },
    {
      id: "page-tasks",
      stageId: "pages",
      stageTitle: "四个页面",
      title: "页面 3：任务队列",
      description:
        "请点击高亮的“任务队列”页签。点击后，下一步会展示任务队列内容区。",
      host: "aiButler",
      target: "#tab-tasks",
      placement: "bottom",
      requireTargetClick: true,
      advanceOnTargetClick: true,
      advanceDelayMs: 80,
    },
    {
      id: "content-tasks",
      stageId: "pages",
      stageTitle: "四个页面",
      title: "任务队列内容区",
      description:
        "这里会列出正在运行、等待中、已完成和失败的任务。导入 PDF、生成总结、精读论文时，都可以回到这里看进度。",
      host: "aiButler",
      target: "#ai-butler-task-queue-view",
      placement: "left",
      cardDock: "bottom",
    },
    {
      id: "page-settings",
      stageId: "pages",
      stageTitle: "四个页面",
      title: "页面 4：快捷设置",
      description:
        "请点击高亮的“快捷设置”页签。点击后，下一步会展示快捷设置内容区。",
      host: "aiButler",
      target: "#tab-settings",
      placement: "bottom",
      requireTargetClick: true,
      advanceOnTargetClick: true,
      advanceDelayMs: 80,
    },
    {
      id: "content-settings",
      stageId: "pages",
      stageTitle: "四个页面",
      title: "快捷设置内容区",
      description:
        "这里是快捷设置页面：左侧是设置分类，右侧是当前分类的全部内容。下一阶段会点击左侧“模型平台”来测试 DeepSeek。",
      host: "aiButler",
      target: "#ai-butler-settings-scaffold",
      placement: "left",
      cardDock: "bottom",
    },
    {
      id: "setup-go-dashboard",
      stageId: "setup",
      stageTitle: "初始化配置",
      title: "准备初始化模型配置",
      description:
        "接下来要用仪表盘里的“一键初始化配置”写入 DeepSeek 端点、模型和 API Key。请点击顶部真实的“仪表盘”页签，回到快捷操作区。",
      host: "aiButler",
      target: "#tab-dashboard",
      placement: "bottom",
      requireTargetClick: true,
      advanceOnTargetClick: true,
      advanceDelayMs: 80,
    },
    {
      id: "setup-open",
      stageId: "setup",
      stageTitle: "初始化配置",
      title: "先用一键初始化配置 DeepSeek",
      description:
        "请直接点击高亮的“一键初始化配置”按钮，按向导粘贴 DeepSeek API Key。完成后会自动创建 DeepSeek 模型端点，并继续下一阶段。",
      host: "aiButler",
      target: "#ai-butler-quick-action-setup",
      placement: "top",
      requireTargetClick: true,
      advanceOnSetupApplied: true,
      fallbackDescription:
        "如果没有看到按钮，请先点击顶部“仪表盘”页签，再点击“一键初始化配置”。",
    },
    {
      id: "model-go-settings",
      stageId: "modelTest",
      stageTitle: "测试模型",
      title: "准备验证模型可用性",
      description:
        "DeepSeek 初始化完成后，需要确认这个模型端点真的能返回结果。请点击顶部真实的“快捷设置”页签，进入模型相关配置。",
      host: "aiButler",
      target: "#tab-settings",
      placement: "bottom",
      requireTargetClick: true,
      advanceOnTargetClick: true,
      advanceDelayMs: 80,
    },
    {
      id: "model-platform",
      stageId: "modelTest",
      stageTitle: "测试模型",
      title: "查看模型平台里的 DeepSeek 端点",
      description:
        "模型平台集中管理所有供应商和端点。请点击左侧“模型平台”，找到刚才一键初始化生成的 DeepSeek 配置。",
      host: "aiButler",
      target: "#settings-nav-modelPlatform",
      placement: "right",
      requireTargetClick: true,
      advanceOnTargetClick: true,
      advanceDelayMs: 120,
    },
    {
      id: "model-deepseek-card",
      stageId: "modelTest",
      stageTitle: "测试模型",
      title: "检查 DeepSeek 详细配置",
      description:
        "为了确认一键初始化写入的端点、模型和 PDF 处理方式，请点击 DeepSeek 卡片右侧真实的“详情”按钮展开配置。",
      host: "aiButler",
      target: (doc) =>
        queryFirst(
          [
            "#endpoint-expand-endpoint-preset-deepseek",
            "#endpoint-card-endpoint-preset-deepseek",
            '[data-ai-butler-endpoint-name="DeepSeek"]',
            "#ai-butler-endpoint-settings-panel article",
          ],
          doc,
        ),
      placement: "top",
      requireTargetClick: true,
      advanceOnTargetClick: true,
      advanceDelayMs: 180,
      fallbackDescription:
        "如果没有看到 DeepSeek 卡片，请先完成上一阶段的一键初始化配置。",
    },
    {
      id: "model-detail-overview",
      stageId: "modelTest",
      stageTitle: "测试模型",
      title: "这是刚才配置好的 DeepSeek",
      description:
        "详情里包含 API 地址、API 密钥、模型名称、PDF 处理方式等配置。先确认这些内容来自刚才的一键初始化配置。",
      host: "aiButler",
      target: "#endpoint-card-endpoint-preset-deepseek",
      placement: "left",
      cardDock: "bottom",
    },
    {
      id: "model-scroll-to-test",
      stageId: "modelTest",
      stageTitle: "测试模型",
      title: "向下滚动到连接测试",
      description:
        "请在模型平台详情区域使用鼠标滚轮向下滑动，完整浏览 DeepSeek 配置，直到看到“连接测试 / 测试连接”按钮。看到后教程会自动进入下一步。",
      host: "aiButler",
      target: "#endpoint-card-endpoint-preset-deepseek",
      placement: "left",
      cardDock: "bottom",
      waitForVisibleSelectors: [
        "#endpoint-test-button-endpoint-preset-deepseek",
        ".ai-butler-endpoint-test-button",
      ],
    },
    {
      id: "model-test-button",
      stageId: "modelTest",
      stageTitle: "测试模型",
      title: "测试 DeepSeek 连接",
      description:
        "点击“测试连接”，确认 API Key、模型和网络都可用。点击后下一步会展示连接测试结果，帮助你判断大模型是否真的返回了内容。",
      host: "aiButler",
      target: (doc) =>
        queryFirst(
          [
            "#endpoint-test-button-endpoint-preset-deepseek",
            ".ai-butler-endpoint-test-button",
            "#endpoint-status-endpoint-preset-deepseek",
          ],
          doc,
        ),
      placement: "top",
      requireTargetClick: true,
      advanceOnTargetClick: true,
      advanceDelayMs: 800,
    },
    {
      id: "model-test-result",
      stageId: "modelTest",
      stageTitle: "测试模型",
      title: "查看 DeepSeek 返回结果",
      description:
        "这里是连接测试结果区。如果看到绿色成功文本，说明 DeepSeek 已经返回响应，后续 AI 总结/精读可以使用这个模型；如果看到红色错误，请检查 API Key、模型名、API 地址或网络后再重新测试。若还显示“正在测试...”，请稍等几秒。",
      host: "aiButler",
      target: "#endpoint-status-endpoint-preset-deepseek",
      placement: "top",
      fallbackDescription:
        "如果暂时没有看到测试结果，请先点击上方“测试连接”按钮，并等待大模型返回响应。",
    },
    {
      id: "model-to-library-transition",
      stageId: "library",
      stageTitle: "导入论文",
      title: "进入论文导入阶段",
      description:
        "模型已经完成初始化和连接验证，下一阶段的目标是在 Zotero 主界面建立一个测试分类，并导入第一篇 PDF。为了让分类区和论文区完整可见，请关闭 AI 管家窗口后继续。",
      host: "aiButler",
      placement: "center",
      action: {
        label: "关闭 AI 管家并继续",
        run: closeAiButlerWindowSoon,
        advance: true,
      },
    },
    {
      id: "collection-area",
      stageId: "library",
      stageTitle: "导入论文",
      title: "左侧是分类区：先新建一个分类",
      description:
        "左侧上方有新建分类按钮，下方是分类树。请用这里新建一个分类，例如“AI Butler 测试”，并点击进入这个分类。分类能让后续批量综述和笔记导出更清晰。",
      host: "zotero",
      targetRect: getCollectionAreaRect,
      placement: "right",
      nextLabel: "分类已新建",
      fallbackDescription:
        "如果左侧分类区为空或隐藏，请先展开 Zotero 左侧面板；新建分类按钮通常在分类区顶部。",
    },
    {
      id: "paper-area-drop",
      stageId: "library",
      stageTitle: "导入论文",
      title: "中间是论文区：把 PDF 拖进来",
      description:
        "进入刚才新建的分类后，把一篇 PDF 拖到中间论文列表。教程会监听新拖入的 PDF，先等待 Zotero 创建条目、完成元数据检索并让自动扫描把论文加入总结队列。",
      host: "zotero",
      target: (doc) =>
        queryFirst(
          [
            "#zotero-items-tree",
            "#items-tree-main-default",
            "#item-tree-main-default",
            "#zotero-items-pane",
            ".items-tree",
          ],
          doc,
        ),
      placement: "right",
      action: {
        label: "我已拖入 PDF / 继续",
        run: () => undefined,
        advance: true,
        enabled: (state) => !!state.trackedItemId,
        disabledLabel: "等待检测 PDF",
      },
      fallbackDescription:
        "请回到 Zotero 文献库窗口，把 PDF 拖到中间论文列表区域。",
    },
    {
      id: "task-open-dashboard",
      stageId: "library",
      stageTitle: "导入论文",
      title: "查看论文总结处理进度",
      description:
        "PDF 已经拖入 Zotero，下一阶段的目标是在 AI 管家任务队列确认它是否开始自动总结。请点击文献库工具栏上的 🤖 AI 管家入口打开仪表盘。",
      host: "zotero",
      target: "#ai-butler-library-toolbar-btn",
      placement: "bottom",
      requireTargetClick: true,
      advanceOnTargetClick: true,
      advanceDelayMs: 550,
      fallbackDescription:
        "如果没有看到 🤖 按钮，请确认当前在 Zotero 文献库主窗口，并等待插件工具栏加载完成。",
    },
    {
      id: "task-progress",
      stageId: "library",
      stageTitle: "导入论文",
      title: "定位刚导入论文的总结任务",
      description:
        "任务队列用于确认后台任务是否入队、运行或完成。请点击顶部“任务队列”页签，下一步会展示刚才拖入论文对应的 AI 总结任务。",
      host: "aiButler",
      target: "#tab-tasks",
      placement: "bottom",
      requireTargetClick: true,
      advanceOnTargetClick: true,
      advanceDelayMs: 120,
    },
    {
      id: "summary-task-progress",
      stageId: "library",
      stageTitle: "导入论文",
      title: "查看当前论文总结进度",
      description:
        "这里是刚才拖入论文的 AI 总结任务。进度表示等待、提取 PDF、调用模型、生成或保存笔记；把鼠标移到阶段标签上可看具体说明。",
      host: "aiButler",
      targetRect: getTrackedSummaryTaskRect,
      placement: "top",
      fallbackDescription:
        "暂时还没找到刚才拖入论文的总结任务。请保持任务队列页面打开，等待 Zotero 完成元数据检索和自动扫描入队；如果自动扫描关闭，可稍后从论文右键手动生成 AI 总结。",
    },
    {
      id: "summary-close-dashboard",
      stageId: "summary",
      stageTitle: "查看总结",
      title: "回到论文区查看总结",
      description:
        "AI 总结任务已经在任务队列里确认过。下一阶段的目标是在 Zotero 论文区选中刚导入的论文，并通过右侧 AI 管家侧边栏查看生成结果。为了看清论文列表和侧边栏，请关闭 AI 管家窗口后继续。",
      host: "aiButler",
      placement: "center",
      action: {
        label: "关闭 AI 管家并继续",
        run: closeAiButlerWindowSoon,
        advance: true,
      },
    },
    {
      id: "select-paper",
      stageId: "summary",
      stageTitle: "查看总结",
      title: "在论文区选中刚导入的论文",
      description:
        "要查看某篇论文的 AI 结果，需要先在 Zotero 论文列表选中它。请选择刚才导入的论文，右侧条目面板会随选中文献刷新。",
      host: "zotero",
      target: (doc) =>
        queryFirst(
          [
            "#zotero-items-tree",
            "#items-tree-main-default",
            "#item-tree-main-default",
            "#zotero-items-pane",
            ".items-tree",
          ],
          doc,
        ),
      placement: "right",
    },
    {
      id: "sidebar-ai-butler",
      stageId: "summary",
      stageTitle: "查看总结",
      title: "打开当前论文的 AI 管家侧边栏",
      description:
        "当前论文的总结结果在右侧 AI 管家区块里查看。请点击最右侧竖排图标栏里的 AI 管家图标（通常在这一列靠下位置）打开它。",
      host: "zotero",
      target: getAiButlerSidenavIcon,
      placement: "left",
      requireTargetClick: true,
      advanceOnTargetClick: true,
      advanceDelayMs: 450,
      fallbackDescription:
        "如果暂时看不到最右侧 AI 管家图标，请先选中一篇论文，并确认 Zotero 右侧条目面板没有被隐藏。",
    },
    {
      id: "sidebar-ai-butler-content",
      stageId: "summary",
      stageTitle: "查看总结",
      title: "这里是 AI 管家侧边栏",
      description:
        "侧边栏会按当前选中的论文展示 AI 总结、AI 精读、一图总结、思维导图和快速追问。上方按钮可以打开完整追问或临时快速追问；中间的折叠区用于查看已经生成的笔记内容。",
      host: "zotero",
      targetRect: getAiButlerSidebarContentRect,
      placement: "left",
      fallbackDescription:
        "如果侧边栏内容还没展开，请再点击一次最右侧 AI 管家图标，或确认当前已选中一篇论文。",
    },
    {
      id: "collection-export",
      stageId: "export",
      stageTitle: "导出笔记",
      title: "把分类里的 AI 笔记导出到本地",
      description:
        "分类右键菜单可以批量导出该分类下已生成的 AI 总结/精读笔记。请右键刚才新建的分类，选择导出该分类 AI 笔记；默认目录和格式可以之后在快捷设置里调整。",
      host: "zotero",
      targetRect: getCollectionAreaRect,
      placement: "right",
    },
    {
      id: "paper-deep-read",
      stageId: "deepRead",
      stageTitle: "精读论文",
      title: "为重点论文启动 AI 精读",
      description:
        "精读适合需要深入理解的重点论文。请在论文列表右键这篇论文，选择 AI 管家里的精读/重新精读功能。",
      host: "zotero",
      target: (doc) =>
        queryFirst(
          [
            "#zotero-itemmenu-ai-butler-multi-round",
            "#zotero-itemmenu-ai-butler-root",
            "#zotero-items-tree",
            "#items-tree-main-default",
            "#zotero-items-pane",
          ],
          doc,
        ),
      placement: "right",
      fallbackDescription:
        "请先选中一篇论文并右键。如果右键菜单还没打开，本步骤会先高亮论文列表区域。",
    },
    {
      id: "deep-read-open-dashboard",
      stageId: "deepRead",
      stageTitle: "精读论文",
      title: "查看精读任务处理进度",
      description:
        "精读任务已经启动，下一阶段的目标是在任务队列确认多轮精读是否入队、运行或完成。请点击文献库工具栏上的 🤖 AI 管家入口打开仪表盘。",
      host: "zotero",
      target: "#ai-butler-library-toolbar-btn",
      placement: "bottom",
      requireTargetClick: true,
      advanceOnTargetClick: true,
      advanceDelayMs: 550,
      fallbackDescription:
        "如果没有看到 🤖 按钮，请确认当前在 Zotero 文献库主窗口，并等待插件工具栏加载完成。",
    },
    {
      id: "deep-read-tasks",
      stageId: "deepRead",
      stageTitle: "精读论文",
      title: "确认精读任务状态",
      description:
        "任务队列会展示精读任务的等待、运行、完成或失败状态。请点击顶部“任务队列”页签，确认刚才启动的精读流程。",
      host: "aiButler",
      target: "#tab-tasks",
      placement: "bottom",
      requireTargetClick: true,
      advanceOnTargetClick: true,
      advanceDelayMs: 120,
    },
    {
      id: "deep-read-explain",
      stageId: "deepRead",
      stageTitle: "精读论文",
      title: "AI 精读：把论文读厚",
      description:
        "AI 精读会把论文拆成多个阅读轮次，多次调用模型 API，把论文读厚。进度表示等待、提取 PDF、规划轮次、AI 精读 3/25、保存笔记等阶段；把鼠标移到“AI 精读 3/25”这类阶段标签上，可看具体进度详情。",
      host: "aiButler",
      targetRect: getTaskQueueListRect,
      placement: "top",
      fallbackDescription:
        "AI 精读会多轮调用模型来深入分析论文；如果暂时看不到任务列表，请保持任务队列页面打开并稍等。",
    },
    {
      id: "final-settings-tab",
      stageId: "deepRead",
      stageTitle: "精读论文",
      title: "继续探索快捷设置",
      description:
        "核心流程已经走完。快捷设置里还有模型平台、自动扫描、笔记导出、侧边栏显示和右键菜单等个性化选项。请点击顶部“快捷设置”页签。",
      host: "aiButler",
      target: "#tab-settings",
      placement: "bottom",
      requireTargetClick: true,
      advanceOnTargetClick: true,
      advanceDelayMs: 120,
    },
    {
      id: "final-settings-catalog",
      stageId: "deepRead",
      stageTitle: "精读论文",
      title: "左侧是可配置项目录",
      description:
        "这里集中放着模型平台、API 配置、提示词、一图总结、笔记自动导出、界面设置、数据管理等入口。以后想调整 AI 管家行为，通常都从这里开始。",
      host: "aiButler",
      target: "#settings-sidebar",
      placement: "right",
    },
    {
      id: "final-ui-settings-nav",
      stageId: "deepRead",
      stageTitle: "精读论文",
      title: "进入界面设置",
      description:
        "界面设置里可以调整自动扫描、右键菜单、侧边栏显示和已有笔记处理策略。请点击左侧“界面设置”。",
      host: "aiButler",
      target: "#settings-nav-ui",
      placement: "right",
      requireTargetClick: true,
      advanceOnTargetClick: true,
      advanceDelayMs: 160,
    },
    {
      id: "final-auto-deepread-setting",
      stageId: "deepRead",
      stageTitle: "精读论文",
      title: "自动扫描时生成 AI 精读",
      description:
        "这个选项会让新导入的论文自动加入 AI 精读队列。它很适合重点阅读场景，但精读会多轮调用模型，消耗的 token 明显多于普通总结；是否开启完全取决于你的使用习惯。",
      host: "aiButler",
      target: "#ui-setting-auto-scan-deep-read",
      placement: "left",
      nextLabel: "知道了",
      fallbackDescription:
        "界面设置中可以找到“自动扫描时生成 AI 精读”。它会消耗较多 token，不需要现在勾选，了解用途即可。",
    },
    {
      id: "finish",
      stageId: "deepRead",
      stageTitle: "精读论文",
      title: "🎉 恭喜，教程完成！",
      description:
        "你已经走完 AI 管家的核心流程：配置模型、导入论文、查看总结、导出笔记、启动精读并查看任务状态。之后可以随时从仪表盘重温教程。",
      host: "aiButler",
      placement: "center",
    },
  ];
}

function createTourState(
  win: Window,
  steps: OverlayTourStep[],
  options: OverlayTourOptions,
): OverlayTourState {
  const doc = win.document;
  const root = doc.createElement("div");
  root.id = OVERLAY_ID;
  Object.assign(root.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483646",
    pointerEvents: "none",
    fontFamily: "system-ui, -apple-system, sans-serif",
  } as Partial<CSSStyleDeclaration>);

  const masks = Array.from({ length: 4 }, () => {
    const mask = doc.createElement("div");
    Object.assign(mask.style, {
      position: "fixed",
      backgroundColor: "rgba(0, 0, 0, 0.58)",
      transition: "all 0.18s ease",
      pointerEvents: "auto",
    } as Partial<CSSStyleDeclaration>);
    root.appendChild(mask);
    return mask;
  });

  const highlight = doc.createElement("div");
  Object.assign(highlight.style, {
    position: "fixed",
    border: "3px solid #00d4a1",
    borderRadius: "12px",
    boxShadow:
      "0 0 0 4px rgba(0, 212, 161, 0.22), 0 10px 32px rgba(0,0,0,0.28)",
    transition: "all 0.18s ease",
    pointerEvents: "none",
    display: "none",
  } as Partial<CSSStyleDeclaration>);

  const card = doc.createElement("div");
  Object.assign(card.style, {
    position: "fixed",
    width: `min(${CARD_WIDTH}px, calc(100vw - 32px))`,
    maxHeight: "calc(100vh - 32px)",
    overflow: "auto",
    backgroundColor: "var(--ai-bg, #fff)",
    color: "var(--ai-text, #222)",
    border: "1px solid rgba(89, 192, 188, 0.35)",
    borderRadius: "16px",
    boxShadow: "0 18px 50px rgba(0,0,0,0.34)",
    padding: "18px",
    boxSizing: "border-box",
    transition: "all 0.18s ease",
    pointerEvents: "auto",
  } as Partial<CSSStyleDeclaration>);

  root.appendChild(highlight);
  root.appendChild(card);
  const mountRoot = doc.documentElement || doc.body;
  if (!mountRoot) {
    throw new Error("Cannot mount onboarding overlay: document has no root");
  }
  mountRoot.appendChild(root);

  return {
    win,
    doc,
    root,
    masks,
    highlight,
    card,
    index: 0,
    steps,
    options,
    reposition: () => renderActiveStep(),
    keyHandler: (event) => {
      if (event.key === "Escape") closeOnboardingOverlayTour();
      else if (event.key === "ArrowRight" && !currentStepRequiresAction())
        goNext();
      else if (event.key === "ArrowLeft") goPrev();
    },
    clickHandler: (event) => handleDocumentClick(event),
    setupAppliedHandler: () => handleSetupApplied(),
    targetClickCleanup: null,
    confettiStepId: null,
    importStartedAt: null,
    trackedItemId: null,
    trackedSummaryTaskId: null,
    importObserverId: null,
    importPollTimer: null,
    taskProgressCleanup: null,
  };
}

function attachTourEvents(state: OverlayTourState): void {
  state.win.addEventListener("resize", state.reposition);
  state.win.addEventListener("scroll", state.reposition, true);
  state.doc.addEventListener("keydown", state.keyHandler, true);
  state.doc.addEventListener("click", state.clickHandler, true);
  state.doc.addEventListener(
    "ai-butler-setup-wizard-applied",
    state.setupAppliedHandler,
  );
  state.win.addEventListener(
    "ai-butler-setup-wizard-applied",
    state.setupAppliedHandler,
  );
}

function detachTourEvents(state: OverlayTourState): void {
  clearTargetClickBinding(state);
  state.win.removeEventListener("resize", state.reposition);
  state.win.removeEventListener("scroll", state.reposition, true);
  state.doc.removeEventListener("keydown", state.keyHandler, true);
  state.doc.removeEventListener("click", state.clickHandler, true);
  state.doc.removeEventListener(
    "ai-butler-setup-wizard-applied",
    state.setupAppliedHandler,
  );
  state.win.removeEventListener(
    "ai-butler-setup-wizard-applied",
    state.setupAppliedHandler,
  );
}

function moveTourToWindow(win: Window): void {
  const state = activeTour;
  if (!state || state.win === win) return;
  const tracking = {
    importStartedAt: state.importStartedAt,
    trackedItemId: state.trackedItemId,
    trackedSummaryTaskId: state.trackedSummaryTaskId,
    confettiStepId: state.confettiStepId,
  };
  detachTourEvents(state);
  stopImportTracking(state);
  state.root.remove();

  const replacement = createTourState(win, state.steps, state.options);
  replacement.index = state.index;
  replacement.importStartedAt = tracking.importStartedAt;
  replacement.trackedItemId = tracking.trackedItemId;
  replacement.trackedSummaryTaskId = tracking.trackedSummaryTaskId;
  replacement.confettiStepId = tracking.confettiStepId;
  activeTour = replacement;
  attachTourEvents(replacement);
}

function renderActiveStep(): void {
  const state = activeTour;
  if (!state) return;
  const step = state.steps[state.index];
  prepareStep(step);
  try {
    syncStepTracking(state, step);
  } catch (error) {
    ztoolkit.log("[AI-Butler] 新手教程步骤跟踪失败:", error);
  }
  const stepWin = getStepWindow(step);
  if (stepWin && stepWin !== state.win) {
    moveTourToWindow(stepWin);
    renderActiveStep();
    return;
  }

  const nextState = activeTour;
  if (!nextState) return;
  const target = resolveTarget(step, nextState.doc);
  const rect = resolveTargetRect(step, nextState.doc, nextState.win, target);
  if (shouldAutoAdvanceStep(step, nextState.doc)) {
    setTimeout(() => {
      if (activeTour?.steps[activeTour.index]?.id === step.id) goNext();
    }, 120);
  }
  bindTargetClickForStep(nextState, step, target, !!rect);
  renderStepCelebration(nextState, step);

  if (rect) {
    renderSpotlight(nextState, rect);
    renderCard(nextState, step, rect);
  } else {
    renderFullMask(nextState, step.requireTargetClick === true);
    renderCard(nextState, step, null);
  }
}

function renderSpotlight(state: OverlayTourState, rect: DOMRect): void {
  const padding = 8;
  const left = Math.max(0, rect.left - padding);
  const top = Math.max(0, rect.top - padding);
  const right = Math.min(state.win.innerWidth, rect.right + padding);
  const bottom = Math.min(state.win.innerHeight, rect.bottom + padding);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);

  setBox(state.masks[0], 0, 0, state.win.innerWidth, top);
  setBox(
    state.masks[1],
    0,
    bottom,
    state.win.innerWidth,
    state.win.innerHeight - bottom,
  );
  setBox(state.masks[2], 0, top, left, height);
  setBox(state.masks[3], right, top, state.win.innerWidth - right, height);
  state.masks.forEach((mask) => {
    mask.style.pointerEvents = "auto";
  });

  Object.assign(state.highlight.style, {
    display: "block",
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  } as Partial<CSSStyleDeclaration>);
}

function renderFullMask(
  state: OverlayTourState,
  allowClickThrough: boolean = false,
): void {
  setBox(state.masks[0], 0, 0, state.win.innerWidth, state.win.innerHeight);
  state.masks[0].style.pointerEvents = allowClickThrough ? "none" : "auto";
  for (let i = 1; i < state.masks.length; i++) {
    setBox(state.masks[i], 0, 0, 0, 0);
    state.masks[i].style.pointerEvents = "none";
  }
  state.highlight.style.display = "none";
}

function renderCard(
  state: OverlayTourState,
  step: OverlayTourStep,
  rect: DOMRect | null,
): void {
  const isLast = state.index === state.steps.length - 1;
  const requiresAction =
    step.action?.advance === true || step.requireTargetClick === true;
  const missingTarget = !rect && (step.target || step.targetRect);
  const stageProgress = getStageProgress(state.steps, state.index);
  state.card.innerHTML = "";

  const stage = state.doc.createElement("div");
  stage.textContent = `大步骤 ${stageProgress.stageIndex + 1}/${stageProgress.stageTotal}：${step.stageTitle}`;
  Object.assign(stage.style, {
    color: "#00a67e",
    fontSize: "12px",
    fontWeight: "800",
    letterSpacing: "0.02em",
    marginBottom: "6px",
  } as Partial<CSSStyleDeclaration>);

  const small = state.doc.createElement("div");
  small.textContent = `小步骤 ${stageProgress.stepIndex + 1}/${stageProgress.stepTotal}`;
  Object.assign(small.style, {
    color: "var(--ai-text-muted, #666)",
    fontSize: "12px",
    fontWeight: "700",
    marginBottom: "10px",
  } as Partial<CSSStyleDeclaration>);

  const progressWrap = state.doc.createElement("div");
  Object.assign(progressWrap.style, {
    height: "6px",
    borderRadius: "999px",
    background: "rgba(89, 192, 188, 0.16)",
    overflow: "hidden",
    marginBottom: "14px",
  } as Partial<CSSStyleDeclaration>);
  const progressBar = state.doc.createElement("div");
  Object.assign(progressBar.style, {
    width: `${Math.round(((state.index + 1) / state.steps.length) * 100)}%`,
    height: "100%",
    borderRadius: "999px",
    background: "linear-gradient(90deg, #00a67e, #59c0bc)",
  } as Partial<CSSStyleDeclaration>);
  progressWrap.appendChild(progressBar);

  const title = state.doc.createElement("div");
  title.textContent = step.title;
  Object.assign(title.style, {
    fontSize: "19px",
    fontWeight: "800",
    marginBottom: "10px",
    lineHeight: "1.35",
  } as Partial<CSSStyleDeclaration>);

  const desc = state.doc.createElement("div");
  desc.textContent = missingTarget
    ? step.fallbackDescription || step.description
    : step.description;
  Object.assign(desc.style, {
    color: "var(--ai-text-muted, #666)",
    fontSize: "14px",
    lineHeight: "1.65",
  } as Partial<CSSStyleDeclaration>);

  if (step.waitForVisibleSelectors?.length) {
    const hint = state.doc.createElement("div");
    hint.textContent = "请滚动页面，直到目标按钮出现在可视区域。";
    Object.assign(hint.style, {
      marginTop: "10px",
      padding: "9px 11px",
      borderRadius: "10px",
      background: "rgba(0, 166, 126, 0.09)",
      color: "#007f61",
      fontSize: "13px",
      fontWeight: "700",
      lineHeight: "1.45",
    } as Partial<CSSStyleDeclaration>);
    desc.appendChild(hint);
  }

  if (step.requireTargetClick && rect) {
    const hint = state.doc.createElement("div");
    hint.textContent = "请直接点击被高亮的真实按钮继续。";
    Object.assign(hint.style, {
      marginTop: "10px",
      padding: "9px 11px",
      borderRadius: "10px",
      background: "rgba(0, 166, 126, 0.09)",
      color: "#007f61",
      fontSize: "13px",
      fontWeight: "700",
      lineHeight: "1.45",
    } as Partial<CSSStyleDeclaration>);
    desc.appendChild(hint);
  }

  appendLiveStatus(state, step, desc);

  const actions = state.doc.createElement("div");
  Object.assign(actions.style, {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
    marginTop: "18px",
  } as Partial<CSSStyleDeclaration>);

  const left = state.doc.createElement("div");
  Object.assign(left.style, {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  } as Partial<CSSStyleDeclaration>);
  if (state.index > 0)
    left.appendChild(createTourButton("上一步", "secondary", goPrev));

  const right = state.doc.createElement("div");
  Object.assign(right.style, {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
    marginLeft: "auto",
  } as Partial<CSSStyleDeclaration>);
  if (step.secondaryAction) {
    right.appendChild(
      createTourButton(step.secondaryAction.label, "secondary", () => {
        void step.secondaryAction?.run();
        setTimeout(renderActiveStep, 180);
      }),
    );
  }
  if (step.action) {
    const actionEnabled = step.action.enabled?.(state) ?? true;
    right.appendChild(
      createTourButton(
        actionEnabled
          ? step.action.label
          : step.action.disabledLabel || step.action.label,
        "secondary",
        () => {
          if (!actionEnabled) return;
          void Promise.resolve(step.action?.run()).then(() => {
            if (step.action?.advance) goNext();
            else setTimeout(renderActiveStep, 180);
          });
        },
        !actionEnabled,
      ),
    );
  }
  if (!requiresAction) {
    right.appendChild(
      createTourButton(
        isLast ? "完成教程" : step.nextLabel || "下一步",
        "primary",
        () => {
          if (isLast) finishTour();
          else goNext();
        },
      ),
    );
  }
  right.appendChild(
    createTourButton("跳过", "ghost", showSkipConfirmationDialog),
  );

  actions.appendChild(left);
  actions.appendChild(right);
  state.card.append(stage, small, progressWrap, title, desc, actions);

  positionCard(state, step, rect);
}

function closeAiButlerWindowSoon(): void {
  const win = MainWindow.getInstance();
  Zotero.Promise.delay(80)
    .then(() => win.close())
    .catch((error) => {
      ztoolkit.log("[AI-Butler] 新手教程关闭 AI 管家窗口失败:", error);
    });
}

function showSkipConfirmationDialog(): void {
  const state = activeTour;
  if (!state) return;
  state.root
    .querySelectorAll<HTMLElement>(".ai-butler-tour-skip-dialog")
    .forEach((element: HTMLElement) => element.remove());

  const backdrop = state.doc.createElement("div");
  backdrop.className = "ai-butler-tour-skip-dialog";
  Object.assign(backdrop.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    background: "rgba(0, 0, 0, 0.32)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "auto",
    padding: "18px",
    boxSizing: "border-box",
  } as Partial<CSSStyleDeclaration>);

  const panel = state.doc.createElement("div");
  Object.assign(panel.style, {
    width: "min(440px, calc(100vw - 36px))",
    background: "var(--ai-bg, #fff)",
    color: "var(--ai-text, #222)",
    border: "1px solid rgba(89, 192, 188, 0.32)",
    borderRadius: "16px",
    boxShadow: "0 18px 48px rgba(0,0,0,0.35)",
    padding: "20px",
    boxSizing: "border-box",
  } as Partial<CSSStyleDeclaration>);

  const title = state.doc.createElement("div");
  title.textContent = "确认跳过新手教程？";
  Object.assign(title.style, {
    fontSize: "18px",
    fontWeight: "800",
    marginBottom: "10px",
  } as Partial<CSSStyleDeclaration>);

  const desc = state.doc.createElement("div");
  desc.textContent =
    "跳过后，本设备不会再自动弹出当前版本的新手教程。如果之后想再看一遍，可以打开 AI 管家仪表盘，在快捷操作里点击“新手教程 / 重温教程”；也可以从设置/帮助入口重新打开。";
  Object.assign(desc.style, {
    color: "var(--ai-text-muted, #666)",
    fontSize: "14px",
    lineHeight: "1.7",
    marginBottom: "18px",
  } as Partial<CSSStyleDeclaration>);

  const actions = state.doc.createElement("div");
  Object.assign(actions.style, {
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
    flexWrap: "wrap",
  } as Partial<CSSStyleDeclaration>);

  const keepButton = createTourButton("继续教程", "secondary", () => {
    backdrop.remove();
  });
  const confirmButton = createTourButton("确认跳过", "primary", () => {
    state.options.onComplete();
    new ztoolkit.ProgressWindow("AI Butler", { closeTime: 2200 })
      .createLine({ text: "已跳过新手教程，可在仪表盘重温", type: "default" })
      .show();
    closeOnboardingOverlayTour();
  });

  actions.append(keepButton, confirmButton);
  panel.append(title, desc, actions);
  backdrop.appendChild(panel);
  state.root.appendChild(backdrop);
}

function positionCard(
  state: OverlayTourState,
  step: OverlayTourStep,
  rect: DOMRect | null,
): void {
  const margin = 16;
  const docked = step.cardDock === "bottom" || step.cardDock === "right";
  const cardWidth = Math.min(
    step.cardDock === "bottom" ? 760 : CARD_WIDTH,
    state.win.innerWidth - 32,
  );
  state.card.style.width = cardWidth + "px";
  const measuredHeight = Math.max(
    state.card.scrollHeight || 0,
    state.card.getBoundingClientRect().height || 0,
    280,
  );
  const cardHeight = Math.min(
    measuredHeight,
    step.cardDock === "bottom"
      ? Math.max(170, state.win.innerHeight * 0.36)
      : state.win.innerHeight - 32,
  );
  let left = (state.win.innerWidth - cardWidth) / 2;
  let top = (state.win.innerHeight - cardHeight) / 2;

  if (step.cardDock === "bottom") {
    top = state.win.innerHeight - cardHeight - margin;
  } else if (step.cardDock === "right") {
    left = state.win.innerWidth - cardWidth - margin;
    top = margin;
  } else if (rect) {
    const placement = step.placement || "bottom";
    if (placement === "right") {
      left = rect.right + margin;
      top = rect.top;
    } else if (placement === "left") {
      left = rect.left - cardWidth - margin;
      top = rect.top;
    } else if (placement === "top") {
      left = rect.left;
      top = rect.top - cardHeight - margin;
    } else if (placement === "bottom") {
      left = rect.left;
      top = rect.bottom + margin;
    }
  }

  left = clamp(left, margin, state.win.innerWidth - cardWidth - margin);
  top = clamp(top, margin, state.win.innerHeight - cardHeight - margin);

  if (rect && cardOverlapsRect(left, top, cardWidth, cardHeight, rect)) {
    const alternative = findNonOverlappingCardPosition(
      state,
      rect,
      cardWidth,
      cardHeight,
      margin,
      step.placement || "bottom",
    );
    if (alternative) {
      left = alternative.left;
      top = alternative.top;
    }
  }

  Object.assign(state.card.style, {
    width: `${cardWidth}px`,
    maxHeight: docked ? `${cardHeight}px` : "calc(100vh - 32px)",
    left: `${left}px`,
    top: `${top}px`,
  } as Partial<CSSStyleDeclaration>);
}

function findNonOverlappingCardPosition(
  state: OverlayTourState,
  rect: DOMRect,
  cardWidth: number,
  cardHeight: number,
  margin: number,
  preferred: OverlayTourPlacement,
): { left: number; top: number } | null {
  const placements: OverlayTourPlacement[] = [
    preferred,
    "top",
    "left",
    "right",
    "bottom",
    "center",
  ];
  const uniquePlacements = [...new Set(placements)];
  for (const placement of uniquePlacements) {
    const candidate = getCardPositionForPlacement(
      state,
      rect,
      cardWidth,
      cardHeight,
      margin,
      placement,
    );
    if (
      !cardOverlapsRect(
        candidate.left,
        candidate.top,
        cardWidth,
        cardHeight,
        rect,
      )
    ) {
      return candidate;
    }
  }
  return null;
}

function getCardPositionForPlacement(
  state: OverlayTourState,
  rect: DOMRect,
  cardWidth: number,
  cardHeight: number,
  margin: number,
  placement: OverlayTourPlacement,
): { left: number; top: number } {
  let left = (state.win.innerWidth - cardWidth) / 2;
  let top = (state.win.innerHeight - cardHeight) / 2;
  if (placement === "right") {
    left = rect.right + margin;
    top = rect.top;
  } else if (placement === "left") {
    left = rect.left - cardWidth - margin;
    top = rect.top;
  } else if (placement === "top") {
    left = rect.left;
    top = rect.top - cardHeight - margin;
  } else if (placement === "bottom") {
    left = rect.left;
    top = rect.bottom + margin;
  }
  return {
    left: clamp(left, margin, state.win.innerWidth - cardWidth - margin),
    top: clamp(top, margin, state.win.innerHeight - cardHeight - margin),
  };
}

function cardOverlapsRect(
  left: number,
  top: number,
  width: number,
  height: number,
  rect: DOMRect,
): boolean {
  const padding = 10;
  return !(
    left + width + padding <= rect.left ||
    left >= rect.right + padding ||
    top + height + padding <= rect.top ||
    top >= rect.bottom + padding
  );
}

function syncStepTracking(
  state: OverlayTourState,
  step: OverlayTourStep,
): void {
  if (step.id === "paper-area-drop") {
    beginImportTracking(state);
  }
  if (step.id === "summary-task-progress") {
    beginImportTracking(state);
    bindTrackedTaskProgress(state);
    refreshTrackedTaskFromQueue(state);
  }
}

function beginImportTracking(state: OverlayTourState): void {
  if (!state.importStartedAt) state.importStartedAt = Date.now();
  bindTrackedTaskProgress(state);
  if (!state.importObserverId) {
    try {
      state.importObserverId = Zotero.Notifier.registerObserver(
        {
          notify: async (
            event: string,
            type: string,
            ids: Array<string | number>,
          ) => {
            if (type !== "item" || !["add", "modify"].includes(event)) return;
            await handleImportItemNotify(state, ids);
          },
        },
        ["item"],
        `ai-butler-onboarding-import-watch-${Date.now()}`,
      );
    } catch (error) {
      ztoolkit.log("[AI-Butler] 注册新手教程导入监听失败:", error);
    }
  }
  let shouldRunInitialPoll = false;
  if (!state.importPollTimer) {
    shouldRunInitialPoll = true;
    state.importPollTimer = state.win.setInterval(() => {
      void pollImportTracking(state).catch((error) =>
        ztoolkit.log("[AI-Butler] 新手教程导入轮询失败:", error),
      );
    }, 1400);
  }
  if (shouldRunInitialPoll) {
    state.win.setTimeout(() => {
      void pollImportTracking(state).catch((error) =>
        ztoolkit.log("[AI-Butler] 新手教程导入初始轮询失败:", error),
      );
    }, 80);
  }
}

function stopImportTracking(state: OverlayTourState): void {
  if (state.importObserverId) {
    try {
      Zotero.Notifier.unregisterObserver(state.importObserverId);
    } catch (error) {
      ztoolkit.log("[AI-Butler] 注销新手教程导入监听失败:", error);
    }
    state.importObserverId = null;
  }
  if (state.importPollTimer) {
    state.win.clearInterval(state.importPollTimer);
    state.importPollTimer = null;
  }
  state.taskProgressCleanup?.();
  state.taskProgressCleanup = null;
}

function bindTrackedTaskProgress(state: OverlayTourState): void {
  if (state.taskProgressCleanup) return;
  state.taskProgressCleanup = TaskQueueManager.getInstance().onProgress(
    (taskId) => {
      const trackedId = state.trackedSummaryTaskId;
      if (trackedId && taskId !== trackedId) return;
      refreshTrackedTaskFromQueue(state);
      if (activeTour === state && isTrackingStep(state.steps[state.index])) {
        renderActiveStep();
      }
    },
  );
}

function isTrackingStep(step: OverlayTourStep): boolean {
  return ["paper-area-drop", "summary-task-progress"].includes(step.id);
}

async function handleImportItemNotify(
  state: OverlayTourState,
  ids: Array<string | number>,
): Promise<void> {
  for (const rawId of ids) {
    const id = Number(rawId);
    if (!Number.isFinite(id)) continue;
    const item = await Zotero.Items.getAsync(id);
    if (!item) continue;
    await considerImportedItem(state, item);
  }
  refreshTrackedTaskFromQueue(state);
  if (activeTour === state && isTrackingStep(state.steps[state.index])) {
    renderActiveStep();
  }
}

async function pollImportTracking(state: OverlayTourState): Promise<void> {
  const selected = getSelectedZoteroItems();
  for (const item of selected) {
    await considerImportedItem(state, item);
  }
  refreshTrackedTaskFromQueue(state);
  if (activeTour === state && isTrackingStep(state.steps[state.index])) {
    renderActiveStep();
  }
}

function getSelectedZoteroItems(): Zotero.Item[] {
  try {
    const pane = Zotero.getActiveZoteroPane?.();
    const selected = pane?.getSelectedItems?.() || [];
    return Array.from(selected) as Zotero.Item[];
  } catch {
    return [];
  }
}

async function considerImportedItem(
  state: OverlayTourState,
  item: Zotero.Item,
): Promise<void> {
  const parent = await getTopLevelParentForImportedItem(item);
  if (!parent || !isRegularTopLevelItem(parent)) return;

  const hasPdf = await hasPdfAttachment(parent, item);
  if (!hasPdf && state.trackedItemId !== parent.id) return;

  if (!state.trackedItemId) {
    state.trackedItemId = parent.id;
  }
  if (state.trackedItemId === parent.id) {
    state.trackedSummaryTaskId = getSummaryTaskId(parent.id);
  }
}

async function getTopLevelParentForImportedItem(
  item: Zotero.Item,
): Promise<Zotero.Item | null> {
  try {
    const raw = item as any;
    if (raw.isAttachment?.()) {
      const parentID = Number(raw.parentID || raw.parentItemID || 0);
      return parentID ? await Zotero.Items.getAsync(parentID) : null;
    }
    if (raw.parentID || raw.parentItemID || raw.isNote?.()) return null;
    return item;
  } catch {
    return null;
  }
}

function isRegularTopLevelItem(item: Zotero.Item): boolean {
  const raw = item as any;
  if (raw.isNote?.() || raw.isAttachment?.()) return false;
  if (raw.parentID || raw.parentItemID) return false;
  if (raw.isRegularItem?.() === false) return false;
  return true;
}

async function hasPdfAttachment(
  parent: Zotero.Item,
  changedItem?: Zotero.Item,
): Promise<boolean> {
  if (changedItem && isPdfAttachment(changedItem)) return true;
  try {
    const attachmentIds = ((parent as any).getAttachments?.() ||
      []) as number[];
    for (const id of attachmentIds) {
      const attachment = await Zotero.Items.getAsync(id);
      if (attachment && isPdfAttachment(attachment)) return true;
    }
  } catch {
    // Best effort: Zotero may still be creating the attachment.
  }
  return false;
}

function isPdfAttachment(item: Zotero.Item): boolean {
  const raw = item as any;
  if (!raw.isAttachment?.()) return false;
  const mime = String(raw.attachmentMIMEType || "").toLowerCase();
  if (mime === "application/pdf") return true;
  const path = String(raw.getFilePath?.() || "");
  return /\.pdf$/i.test(path);
}

function refreshTrackedTaskFromQueue(state: OverlayTourState): void {
  const manager = TaskQueueManager.getInstance();
  manager.refreshFromStorage();
  if (
    state.trackedSummaryTaskId &&
    manager.getTask(state.trackedSummaryTaskId)
  ) {
    return;
  }
  const tasks = manager
    .getAllTasks()
    .filter((task) => {
      const isSummary = !task.taskType || task.taskType === "summary";
      if (!isSummary) return false;
      if (state.trackedItemId) return task.itemId === state.trackedItemId;
      const createdAt = task.createdAt?.getTime?.() || 0;
      return state.importStartedAt
        ? createdAt >= state.importStartedAt - 5000
        : true;
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const task = tasks[0];
  if (task) {
    state.trackedItemId = task.itemId;
    state.trackedSummaryTaskId = task.id;
  }
}

function getTrackedTask(state: OverlayTourState): TaskItem | undefined {
  refreshTrackedTaskFromQueue(state);
  const taskId = state.trackedSummaryTaskId;
  return taskId ? TaskQueueManager.getInstance().getTask(taskId) : undefined;
}

function getTaskQueueListRect(doc: Document, win: Window): DOMRect | null {
  const list = doc.getElementById("task-list-container");
  const listRect = list ? getVisibleRect(list, win) : null;
  if (listRect) return listRect;

  const view = doc.getElementById("ai-butler-task-queue-view");
  const viewRect = view ? getVisibleRect(view, win) : null;
  const header = doc.getElementById("task-header-wrapper");
  const headerRect = header ? getVisibleRect(header, win) : null;
  if (!viewRect) return null;
  const top = headerRect
    ? Math.min(viewRect.bottom, headerRect.bottom)
    : viewRect.top;
  return makeRect(
    win,
    viewRect.left,
    top,
    viewRect.width,
    Math.max(1, viewRect.bottom - top),
  );
}

function getTrackedSummaryTaskRect(doc: Document, win: Window): DOMRect | null {
  const state = activeTour;
  if (!state) return null;
  const task = getTrackedTask(state);
  const selectors = [
    task ? `[data-task-id="${cssEscape(task.id)}"]` : "",
    state.trackedSummaryTaskId
      ? `#ai-butler-task-${cssEscape(sanitizeTaskElementId(state.trackedSummaryTaskId))}`
      : "",
    state.trackedItemId ? `[data-item-id="${state.trackedItemId}"]` : "",
  ].filter(Boolean);
  const target = queryFirst(selectors, doc);
  if (target) return getVisibleRect(target, win);
  return null;
}

function sanitizeTaskElementId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function cssEscape(value: string): string {
  const escapeFn = (
    globalThis as { CSS?: { escape?: (value: string) => string } }
  ).CSS?.escape;
  return escapeFn
    ? escapeFn(value)
    : value.replace(/(["\\#.:[\]>~+*])/g, "\\$1");
}

function appendLiveStatus(
  state: OverlayTourState,
  step: OverlayTourStep,
  container: HTMLElement,
): void {
  if (step.id !== "paper-area-drop" && step.id !== "summary-task-progress") {
    return;
  }
  let task: TaskItem | undefined;
  try {
    task = getTrackedTask(state);
  } catch (error) {
    ztoolkit.log("[AI-Butler] 读取新手教程任务状态失败:", error);
  }
  const panel = state.doc.createElement("div");
  Object.assign(panel.style, {
    marginTop: "12px",
    padding: "11px 12px",
    borderRadius: "12px",
    border: "1px solid rgba(0, 166, 126, 0.22)",
    background: "rgba(0, 166, 126, 0.08)",
    color: "var(--ai-text, #222)",
    fontSize: "13px",
    lineHeight: "1.55",
  } as Partial<CSSStyleDeclaration>);

  const title = state.doc.createElement("div");
  title.style.fontWeight = "800";
  title.style.color = "#007f61";
  title.style.marginBottom = "6px";
  title.textContent = getLiveStatusTitle(state, task);
  panel.appendChild(title);

  const body = state.doc.createElement("div");
  body.textContent = getLiveStatusBody(state, task);
  panel.appendChild(body);

  if (task) {
    const progress = Math.max(0, Math.min(100, Math.round(task.progress || 0)));
    const track = state.doc.createElement("div");
    Object.assign(track.style, {
      height: "6px",
      marginTop: "9px",
      borderRadius: "999px",
      overflow: "hidden",
      background: "rgba(0, 166, 126, 0.18)",
    } as Partial<CSSStyleDeclaration>);
    const bar = state.doc.createElement("div");
    Object.assign(bar.style, {
      height: "100%",
      width: progress + "%",
      borderRadius: "999px",
      background: task.status === TaskStatus.FAILED ? "#f44336" : "#00a67e",
      transition: "width 0.2s ease",
    } as Partial<CSSStyleDeclaration>);
    track.appendChild(bar);
    panel.appendChild(track);
  }

  container.appendChild(panel);
}

function getLiveStatusTitle(state: OverlayTourState, task?: TaskItem): string {
  if (task)
    return `已追踪到当前论文总结任务：${Math.round(task.progress || 0)}%`;
  if (state.trackedItemId) return "已检测到 PDF 论文，正在等待总结任务入队";
  return "正在监听拖入的 PDF";
}

function getLiveStatusBody(state: OverlayTourState, task?: TaskItem): string {
  if (!task) {
    return state.trackedItemId
      ? "Zotero 可能仍在检索元数据，自动扫描也会等待 PDF 附件就绪后再入队。请保持当前窗口打开，稍等几秒。"
      : "把 PDF 拖入中间论文区后，这里会自动更新状态；如果 Zotero 正在抓取题名、作者、DOI，教程会先停在这里等待。";
  }
  const statusMap: Record<string, string> = {
    [TaskStatus.PENDING]: "等待处理",
    [TaskStatus.PRIORITY]: "优先等待",
    [TaskStatus.PROCESSING]: "处理中",
    [TaskStatus.COMPLETED]: "已完成",
    [TaskStatus.FAILED]: "失败",
  };
  const stage = task.stageLabel || task.workflowStage || statusMap[task.status];
  const detail = task.stageDetail ? `；${task.stageDetail}` : "";
  if (task.status === TaskStatus.COMPLETED) {
    return "AI 总结已完成。下一步回到论文区查看结果。";
  }
  if (task.status === TaskStatus.FAILED) {
    return `当前总结任务失败：${task.error || stage}。你仍然可以继续教程，稍后在任务队列里重试或检查配置。`;
  }
  return `当前阶段：${stage}${detail}。鼠标移到任务卡片的阶段标签上可看完整进度详情。`;
}

function renderStepCelebration(
  state: OverlayTourState,
  step: OverlayTourStep,
): void {
  if (step.id !== "finish") {
    clearConfetti(state);
    state.confettiStepId = null;
    return;
  }
  if (state.confettiStepId === step.id) return;
  clearConfetti(state);
  state.confettiStepId = step.id;
  renderConfetti(state);
}

function clearConfetti(state: OverlayTourState): void {
  state.root
    .querySelectorAll<HTMLElement>(".ai-butler-tour-confetti")
    .forEach((piece: HTMLElement) => piece.remove());
}

function renderConfetti(state: OverlayTourState): void {
  const colors = [
    "#00a67e",
    "#59c0bc",
    "#ffd166",
    "#ef476f",
    "#7c3aed",
    "#118ab2",
  ];
  const count = 150;
  for (let i = 0; i < count; i++) {
    const piece = state.doc.createElement("div");
    piece.className = "ai-butler-tour-confetti";
    const size = 6 + Math.random() * 8;
    const startX = Math.random() * state.win.innerWidth;
    const drift = (Math.random() - 0.5) * 360;
    const fall = state.win.innerHeight * (0.58 + Math.random() * 0.42);
    const rotate = 180 + Math.random() * 720;
    const duration = 2800 + Math.random() * 1800;
    const fadeDelay = 2600 + Math.random() * 1400;
    Object.assign(piece.style, {
      position: "fixed",
      left: startX + "px",
      top: "-18px",
      width: size + "px",
      height: size * (0.55 + Math.random() * 0.9) + "px",
      borderRadius: Math.random() > 0.55 ? "999px" : "2px",
      background: colors[i % colors.length],
      opacity: "0.95",
      zIndex: "2147483647",
      pointerEvents: "none",
      transform: "translate3d(0, 0, 0) rotate(0deg)",
      transition:
        "transform " +
        duration +
        "ms cubic-bezier(.16,.84,.44,1), opacity 500ms ease " +
        fadeDelay +
        "ms",
    } as Partial<CSSStyleDeclaration>);
    state.root.appendChild(piece);
    state.win.setTimeout(
      () => {
        piece.style.transform =
          "translate3d(" +
          drift +
          "px, " +
          fall +
          "px, 0) rotate(" +
          rotate +
          "deg)";
        piece.style.opacity = "0";
      },
      20 + Math.random() * 220,
    );
    state.win.setTimeout(() => piece.remove(), 6200);
  }
}
function createTourButton(
  label: string,
  variant: "primary" | "secondary" | "ghost",
  onClick: () => void,
  disabled: boolean = false,
): HTMLButtonElement {
  const doc = activeTour?.doc || Zotero.getMainWindow().document;
  const button = doc.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.disabled = disabled;
  const palette =
    variant === "primary"
      ? {
          bg: "#00a67e",
          fg: "#ffffff",
          border: "#00a67e",
        }
      : variant === "secondary"
        ? {
            bg: "var(--ai-bg, #fff)",
            fg: "#00a67e",
            border: "rgba(0, 166, 126, 0.62)",
          }
        : {
            bg: "transparent",
            fg: "var(--ai-text-muted, #666)",
            border: "rgba(128, 128, 128, 0.28)",
          };
  Object.assign(button.style, {
    minHeight: "34px",
    padding: "0 13px",
    border: `1px solid ${palette.border}`,
    borderRadius: "999px",
    background: palette.bg,
    color: palette.fg,
    fontSize: "13px",
    fontWeight: "750",
    cursor: disabled ? "not-allowed" : "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: "1",
    whiteSpace: "nowrap",
    boxSizing: "border-box",
  } as Partial<CSSStyleDeclaration>);
  if (disabled) {
    button.setAttribute("aria-disabled", "true");
    button.title = "检测到拖入的 PDF 后才能继续";
    button.style.opacity = "0.48";
    button.style.filter = "grayscale(0.55)";
    button.style.background = "rgba(128, 128, 128, 0.08)";
    button.style.color = "var(--ai-text-muted, #777)";
    button.style.borderColor = "rgba(128, 128, 128, 0.32)";
  }
  button.addEventListener("mouseenter", () => {
    if (disabled) return;
    button.style.transform = "translateY(-1px)";
    button.style.boxShadow = "0 6px 14px rgba(0,0,0,0.12)";
  });
  button.addEventListener("mouseleave", () => {
    if (disabled) return;
    button.style.transform = "translateY(0)";
    button.style.boxShadow = "none";
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    onClick();
  });
  return button;
}

function shouldAutoAdvanceStep(step: OverlayTourStep, doc: Document): boolean {
  if (step.id === "model-deepseek-card") {
    return !!doc.getElementById("endpoint-status-endpoint-preset-deepseek");
  }
  if (step.waitForVisibleSelectors?.length) {
    return !!queryFirst(step.waitForVisibleSelectors, doc);
  }
  return false;
}

function bindTargetClickForStep(
  state: OverlayTourState,
  step: OverlayTourStep,
  target: Element | null,
  visible: boolean,
): void {
  clearTargetClickBinding(state);
  if (!target || !visible || !step.requireTargetClick) return;

  const handler = () => {
    if (!step.advanceOnTargetClick) return;
    setTimeout(() => {
      if (activeTour?.steps[activeTour.index]?.id === step.id) {
        goNext();
      }
    }, step.advanceDelayMs ?? 120);
  };

  target.addEventListener("click", handler, true);
  target.addEventListener("command", handler, true);
  state.targetClickCleanup = () => {
    target.removeEventListener("click", handler, true);
    target.removeEventListener("command", handler, true);
  };
}

function clearTargetClickBinding(state: OverlayTourState): void {
  state.targetClickCleanup?.();
  state.targetClickCleanup = null;
}

function prepareStep(_step: OverlayTourStep): void {
  // 教程流程必须完全由用户点击推进；这里不主动切换页面。
}

function currentStepRequiresAction(): boolean {
  const state = activeTour;
  if (!state) return false;
  const step = state.steps[state.index];
  return (
    step.action?.advance === true ||
    step.requireTargetClick === true ||
    !!step.waitForVisibleSelectors?.length
  );
}

function handleDocumentClick(event: MouseEvent): void {
  const state = activeTour;
  if (!state) return;
  const step = state.steps[state.index];
  if (!step.requireTargetClick) return;

  const targetElement = resolveTarget(step, state.doc);
  if (!targetElement) return;
  const clicked =
    event.target instanceof Node && targetElement.contains(event.target);
  if (!clicked) return;

  if (step.advanceOnTargetClick) {
    setTimeout(() => {
      if (activeTour?.steps[activeTour.index]?.id === step.id) {
        goNext();
      }
    }, step.advanceDelayMs ?? 120);
  }
}

function handleSetupApplied(): void {
  const state = activeTour;
  if (!state) return;
  const step = state.steps[state.index];
  if (!step.advanceOnSetupApplied) return;
  setTimeout(() => {
    if (activeTour?.steps[activeTour.index]?.id === step.id) {
      goNext();
    }
  }, 700);
}

function goNext(): void {
  if (!activeTour) return;
  activeTour.index = Math.min(
    activeTour.steps.length - 1,
    activeTour.index + 1,
  );
  renderActiveStep();
}

function goPrev(): void {
  if (!activeTour) return;
  activeTour.index = Math.max(0, activeTour.index - 1);
  renderActiveStep();
}

function finishTour(): void {
  const options = activeTour?.options;
  options?.onComplete();
  new ztoolkit.ProgressWindow("AI Butler", { closeTime: 2400 })
    .createLine({ text: "✅ 新手教程已完成", type: "success" })
    .show();
  closeOnboardingOverlayTour();
}

function resolveTargetRect(
  step: OverlayTourStep,
  doc: Document,
  win: Window,
  target: Element | null,
): DOMRect | null {
  if (step.targetRect) return step.targetRect(doc, win);
  return target ? getVisibleRect(target, win) : null;
}

function resolveTarget(step: OverlayTourStep, doc: Document): Element | null {
  try {
    if (!step.target) return null;
    if (typeof step.target === "function") return step.target(doc);
    return doc.querySelector(step.target);
  } catch {
    return null;
  }
}

function getStepWindow(step: OverlayTourStep): Window | null {
  if (step.host === "aiButler") {
    return MainWindow.getInstance().getDialogWindow() || Zotero.getMainWindow();
  }
  return Zotero.getMainWindow();
}

function getAiButlerDocument(): Document {
  return (
    MainWindow.getInstance().getDialogWindow()?.document ||
    getCurrentTourDocument()
  );
}

function getCurrentTourDocument(): Document {
  return activeTour?.doc || Zotero.getMainWindow().document;
}

function getCollectionAreaRect(doc: Document, win: Window): DOMRect | null {
  const pane = queryFirst(
    [
      "#zotero-collections-pane",
      "#collections-pane",
      "#collections-pane-container",
      "#zotero-collections-pane-container",
    ],
    doc,
  );
  const collectionElements = [
    pane,
    ...queryVisibleAll(
      [
        "#zotero-collections-toolbar",
        "#collections-toolbar",
        "#zotero-tb-add-collection",
        "#zotero-tb-collection-add",
        "#zotero-tb-new-collection",
        "#new-collection-button",
        '[command="cmd_zotero_newCollection"]',
        '[aria-label*="New Collection"]',
        '[title*="New Collection"]',
        '[tooltiptext*="New Collection"]',
        '[aria-label*="新建分类"]',
        '[title*="新建分类"]',
        '[tooltiptext*="新建分类"]',
        '[aria-label*="新建集合"]',
        '[title*="新建集合"]',
        '[tooltiptext*="新建集合"]',
        "#zotero-collections-tree",
        "#collections-tree",
        ".collections-tree",
      ],
      doc,
      win,
    ),
  ].filter((element): element is Element => !!element);

  const union = unionElementRects(collectionElements, win);
  if (union) {
    const expandedTop = Math.max(0, union.top - 56);
    return makeRect(
      win,
      union.left,
      expandedTop,
      union.width,
      Math.min(win.innerHeight - expandedTop, union.bottom - expandedTop),
    );
  }

  const itemsTree = queryFirst(
    [
      "#zotero-items-tree",
      "#items-tree-main-default",
      "#item-tree-main-default",
      "#zotero-items-pane",
      ".items-tree",
    ],
    doc,
  );
  const itemsRect = itemsTree ? getVisibleRect(itemsTree, win) : null;
  if (itemsRect && itemsRect.left > 120) {
    return makeRect(win, 0, 0, itemsRect.left, win.innerHeight);
  }
  return null;
}

function getAiButlerSidebarContentRect(
  doc: Document,
  win: Window,
): DOMRect | null {
  const candidates = queryVisibleAll(
    [
      '[data-pane="ai-butler-chat-section"]',
      "#ai-butler-quick-chat-btn",
      "#ai-butler-refresh-btn",
      ".ai-butler-note-section",
      "#ai-butler-inline-chat",
      "#zotero-item-pane section",
      "#item-pane section",
    ],
    doc,
    win,
  ).filter((element) => {
    const rect = getVisibleRect(element, win);
    return !!rect && !isRightEdgeRect(rect, win) && rect.width > 80;
  });

  const union = unionElementRects(candidates, win);
  if (union) return union;

  const pane = queryFirst(
    ["#zotero-item-pane", "#item-pane", '[data-pane="item-pane"]'],
    doc,
  );
  const paneRect = pane ? getVisibleRect(pane, win) : null;
  if (!paneRect) return null;
  return makeRect(
    win,
    paneRect.left,
    paneRect.top,
    Math.max(1, paneRect.width - 44),
    paneRect.height,
  );
}

function getAiButlerSidenavIcon(doc: Document): Element | null {
  const win = doc.defaultView || Zotero.getMainWindow();
  const explicit = queryFirst(
    [
      '#zotero-item-pane [data-pane="ai-butler-chat-section"]',
      '#item-pane [data-pane="ai-butler-chat-section"]',
      '[aria-label="AI 管家"]',
      '[title="AI 管家"]',
      '[tooltiptext="AI 管家"]',
      '[label="AI 管家"]',
    ],
    doc,
  );
  if (explicit && isRightEdgeElement(explicit, win)) return explicit;

  const candidates = Array.from<Element>(doc.querySelectorAll("*"))
    .filter((element): element is Element => {
      const rect = getVisibleRect(element, win);
      if (!rect || !isRightEdgeRect(rect, win)) return false;
      return elementLooksLikeAiButlerSidenav(element);
    })
    .sort((a, b) => {
      const rectA = getVisibleRect(a, win);
      const rectB = getVisibleRect(b, win);
      if (!rectA || !rectB) return 0;
      return rectB.left - rectA.left || rectB.top - rectA.top;
    });

  return candidates[0] || getRightItemPaneSidenavFallback(doc, win);
}

function isRightEdgeElement(element: Element, win: Window): boolean {
  const rect = getVisibleRect(element, win);
  return !!rect && isRightEdgeRect(rect, win);
}

function isRightEdgeRect(rect: DOMRect, win: Window): boolean {
  return rect.left >= Math.max(0, win.innerWidth - 120);
}

function elementLooksLikeAiButlerSidenav(element: Element): boolean {
  const attrs = [
    element.id,
    element.className?.toString?.() || "",
    element.getAttribute("aria-label") || "",
    element.getAttribute("title") || "",
    element.getAttribute("tooltiptext") || "",
    element.getAttribute("label") || "",
    element.getAttribute("data-pane") || "",
  ]
    .join(" ")
    .toLowerCase();
  if (attrs.includes("ai-butler") || attrs.includes("ai 管家")) return true;

  const image = element.matches("img,image")
    ? element
    : element.querySelector("img,image");
  const imageSrc =
    image?.getAttribute("src") ||
    image?.getAttribute("href") ||
    image?.getAttribute("xlink:href") ||
    "";
  return imageSrc.includes("icon24.png") || imageSrc.includes("ai-butler");
}

function getRightItemPaneSidenavFallback(
  doc: Document,
  win: Window,
): Element | null {
  const candidates = Array.from<Element>(
    doc.querySelectorAll(
      '#zotero-item-pane button, #zotero-item-pane toolbarbutton, #zotero-item-pane [role="tab"], #item-pane button, #item-pane toolbarbutton, #item-pane [role="tab"]',
    ),
  )
    .filter((element): element is Element => {
      const rect = getVisibleRect(element, win);
      return !!rect && isRightEdgeRect(rect, win);
    })
    .sort((a, b) => {
      const rectA = getVisibleRect(a, win);
      const rectB = getVisibleRect(b, win);
      if (!rectA || !rectB) return 0;
      return rectB.left - rectA.left || rectB.top - rectA.top;
    });
  return candidates[0] || null;
}

function queryFirst(selectors: string[], doc: Document): Element | null {
  const win = doc.defaultView || Zotero.getMainWindow();
  for (const selector of selectors) {
    const element = doc.querySelector(selector);
    if (element && getVisibleRect(element, win)) return element;
  }
  return null;
}

function queryVisibleAll(
  selectors: string[],
  doc: Document,
  win: Window,
): Element[] {
  const elements: Element[] = [];
  for (const selector of selectors) {
    try {
      doc.querySelectorAll(selector).forEach((element: Element) => {
        if (getVisibleRect(element, win)) elements.push(element);
      });
    } catch {
      // Ignore selectors unsupported by the current Zotero/XUL document.
    }
  }
  return [...new Set(elements)];
}

function unionElementRects(elements: Element[], win: Window): DOMRect | null {
  const rects = elements
    .map((element) => getVisibleRect(element, win))
    .filter((rect): rect is DOMRect => !!rect);
  if (!rects.length) return null;
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return makeRect(win, left, top, right - left, bottom - top);
}

function makeRect(
  win: Window,
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  const rectFactory = win.DOMRect || DOMRect;
  if (typeof rectFactory === "function") {
    return new rectFactory(left, top, width, height);
  }
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function getVisibleRect(element: Element, win: Window): DOMRect | null {
  const rect = element.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return null;
  if (rect.bottom <= 0 || rect.right <= 0) return null;
  if (rect.top >= win.innerHeight || rect.left >= win.innerWidth) return null;
  return rect;
}

function getStageProgress(
  steps: OverlayTourStep[],
  index: number,
): {
  stageIndex: number;
  stageTotal: number;
  stepIndex: number;
  stepTotal: number;
} {
  const stageIds = [...new Set(steps.map((step) => step.stageId))];
  const current = steps[index];
  const stageSteps = steps.filter((step) => step.stageId === current.stageId);
  return {
    stageIndex: stageIds.indexOf(current.stageId),
    stageTotal: stageIds.length,
    stepIndex: stageSteps.findIndex((step) => step.id === current.id),
    stepTotal: stageSteps.length,
  };
}

function setBox(
  element: HTMLElement,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  Object.assign(element.style, {
    left: `${Math.max(0, left)}px`,
    top: `${Math.max(0, top)}px`,
    width: `${Math.max(0, width)}px`,
    height: `${Math.max(0, height)}px`,
  } as Partial<CSSStyleDeclaration>);
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

function delay(ms: number): Promise<void> {
  return Zotero.Promise.delay(ms);
}
