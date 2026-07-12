import { getPref, setPref } from "../utils/prefs";
import { MainWindow } from "./views/MainWindow";
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
  return seenVersion !== ONBOARDING_TUTORIAL_VERSION;
}

export function markOnboardingTutorialSeen(): void {
  setPref("onboardingTutorialSeenVersion" as any, ONBOARDING_TUTORIAL_VERSION);
}

export async function openOnboardingTutorial(
  source: OnboardingTutorialSource,
): Promise<void> {
  ztoolkit.log(`[AI-Butler] 打开图文新手教程: ${source}`);
  closeOnboardingOverlayTour();
  await MainWindow.getInstance().open("tutorial");
}

export async function openInteractiveOnboardingTour(
  source: OnboardingTutorialSource,
): Promise<void> {
  const started = await startOnboardingOverlayTour(
    source as OverlayTourSource,
    {
      onComplete: markOnboardingTutorialSeen,
      onOpenFallback: () => openOnboardingTutorial(source),
    },
  );

  if (!started) {
    await openOnboardingTutorial(source);
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
