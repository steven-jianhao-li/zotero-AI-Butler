import { getPref, setPref } from "../utils/prefs";
import { TaskQueueManager, TaskStatus } from "./taskQueue";
import {
  closeOnboardingOverlayTour,
  startOnboardingOverlayTour,
  type OverlayTourSource,
} from "./onboardingOverlayTour";

export const ONBOARDING_TUTORIAL_VERSION = "1";

export type OnboardingTutorialSource = "startup" | "dashboard" | "settings";

export function shouldShowOnboardingTutorial(): boolean {
  const seenVersion = String(
    (getPref("onboardingTutorialSeenVersion" as any) as string) || "",
  );
  if (seenVersion === ONBOARDING_TUTORIAL_VERSION) return false;

  // 首次安装/首次升级到带教程版本时，如果用户已经有成功完成的 AI 管家任务，
  // 说明他已经跑通过核心流程，不再自动弹出新手教程；仍可从仪表盘/设置手动重温。
  if (!seenVersion && hasCompletedAiButlerTask()) {
    markOnboardingTutorialSeen();
    ztoolkit.log("[AI-Butler] 检测到已完成任务，跳过首次自动新手教程");
    return false;
  }

  return true;
}

function hasCompletedAiButlerTask(): boolean {
  try {
    const manager = TaskQueueManager.getInstance();
    manager.refreshFromStorage();
    return manager
      .getAllTasks()
      .some((task) => task.status === TaskStatus.COMPLETED);
  } catch (error) {
    ztoolkit.log("[AI-Butler] 检查已完成任务失败:", error);
    return false;
  }
}

export function markOnboardingTutorialSeen(): void {
  setPref("onboardingTutorialSeenVersion" as any, ONBOARDING_TUTORIAL_VERSION);
}

export async function openInteractiveOnboardingTour(
  source: OnboardingTutorialSource,
): Promise<void> {
  const started = await startOnboardingOverlayTour(
    source as OverlayTourSource,
    {
      onComplete: markOnboardingTutorialSeen,
    },
  );

  if (!started) {
    ztoolkit.log(`[AI-Butler] 无法启动交互式新手教程: ${source}`);
  }
}

export async function maybeOpenOnboardingTutorialOnStartup(): Promise<void> {
  if (!shouldShowOnboardingTutorial()) return;

  try {
    await Zotero.Promise.delay(500);
    if (!shouldShowOnboardingTutorial()) return;
    await openInteractiveOnboardingTour("startup");
  } catch (error) {
    ztoolkit.log("[AI-Butler] 自动打开新手教程失败:", error);
  }
}
