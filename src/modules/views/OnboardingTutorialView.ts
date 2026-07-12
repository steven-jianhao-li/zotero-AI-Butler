import { BaseView } from "./BaseView";
import { MainWindow } from "./MainWindow";
import {
  markOnboardingTutorialSeen,
  openInteractiveOnboardingTour,
} from "../onboarding";
import {
  ONBOARDING_DOCS_URL,
  onboardingSteps,
  type OnboardingAction,
  type OnboardingStep,
} from "../onboardingContent";
import { showSetupWizard, openExternalUrl } from "./SetupWizard";
import { createStyledButton } from "./ui/components";

export class OnboardingTutorialView extends BaseView {
  private currentIndex = 0;
  private stepContainer: HTMLElement | null = null;
  private progressContainer: HTMLElement | null = null;

  constructor() {
    super("onboarding-tutorial-view");
  }

  protected renderContent(): HTMLElement {
    const container = this.createElement("div", {
      id: "ai-butler-onboarding-view",
      styles: {
        height: "100%",
        width: "100%",
        overflow: "auto",
        background:
          "linear-gradient(135deg, rgba(89, 192, 188, 0.12), rgba(121, 82, 179, 0.10))",
        color: "var(--ai-text, #222)",
        fontFamily: "system-ui, -apple-system, sans-serif",
      },
    });

    const shell = this.createElement("div", {
      styles: {
        maxWidth: "980px",
        margin: "0 auto",
        padding: "28px min(32px, 5vw)",
        boxSizing: "border-box",
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "18px",
      },
    });

    this.progressContainer = this.createElement("div", {
      styles: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))",
        gap: "8px",
      },
    });
    this.stepContainer = this.createElement("div");

    shell.appendChild(this.createTopBar());
    shell.appendChild(this.progressContainer);
    shell.appendChild(this.stepContainer);
    container.appendChild(shell);

    this.renderStep();
    return container;
  }

  protected onShow(): void {
    super.onShow();
    this.applyTheme();
    this.renderStep();
  }

  private createTopBar(): HTMLElement {
    const bar = this.createElement("div", {
      styles: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "12px",
        flexWrap: "wrap",
      },
    });
    bar.appendChild(
      this.createElement("div", {
        children: [
          this.createElement("div", {
            textContent: "🎓 新手教程",
            styles: {
              fontSize: "24px",
              fontWeight: "800",
              color: "var(--ai-text, #222)",
            },
          }),
          this.createElement("div", {
            textContent: "首次配置、入口导览和第一个任务闭环。",
            styles: {
              marginTop: "4px",
              color: "var(--ai-text-muted, #666)",
              fontSize: "13px",
            },
          }),
        ],
      }),
    );

    const interactive = createStyledButton("交互式引导", "#00a67e", "small");
    interactive.addEventListener(
      "click",
      () => void openInteractiveOnboardingTour("dashboard"),
    );
    bar.appendChild(interactive);

    const later = createStyledButton("稍后再说", "#9e9e9e", "small");
    later.addEventListener("click", () =>
      MainWindow.getInstance().switchTab("dashboard"),
    );
    bar.appendChild(later);
    return bar;
  }

  private renderStep(): void {
    if (!this.stepContainer || !this.progressContainer) return;
    const step = onboardingSteps[this.currentIndex] || onboardingSteps[0];

    this.progressContainer.innerHTML = "";
    onboardingSteps.forEach((item, index) => {
      const pill = this.createElement("button", {
        textContent: String(index + 1),
        attributes: { title: item.title },
        styles: {
          height: "8px",
          border: "none",
          borderRadius: "999px",
          backgroundColor:
            index <= this.currentIndex ? "#00a67e" : "rgba(89, 192, 188, 0.22)",
          cursor: "pointer",
          padding: "0",
        },
      });
      pill.addEventListener("click", () => {
        this.currentIndex = index;
        this.renderStep();
      });
      this.progressContainer!.appendChild(pill);
    });

    this.stepContainer.innerHTML = "";
    this.stepContainer.appendChild(this.createStepCard(step));
  }

  private createStepCard(step: OnboardingStep): HTMLElement {
    const card = this.createElement("div", {
      styles: {
        backgroundColor: "var(--ai-bg, #fff)",
        border: "1px solid rgba(89, 192, 188, 0.25)",
        borderRadius: "18px",
        boxShadow: "0 12px 36px rgba(0, 0, 0, 0.10)",
        padding: "clamp(20px, 4vw, 34px)",
      },
    });

    card.appendChild(
      this.createElement("div", {
        textContent: step.eyebrow,
        styles: {
          color: "#00a67e",
          fontWeight: "800",
          fontSize: "13px",
          letterSpacing: "0.03em",
          marginBottom: "10px",
        },
      }),
    );
    card.appendChild(
      this.createElement("h2", {
        textContent: step.title,
        styles: {
          margin: "0 0 10px 0",
          fontSize: "clamp(24px, 5vw, 36px)",
          lineHeight: "1.18",
          color: "var(--ai-text, #222)",
        },
      }),
    );
    card.appendChild(
      this.createElement("div", {
        textContent: step.description,
        styles: {
          color: "var(--ai-text-muted, #666)",
          lineHeight: "1.7",
          fontSize: "15px",
          maxWidth: "760px",
        },
      }),
    );

    card.appendChild(this.createFeatureGrid(step));
    const actionRow = this.createActionRow(step);
    card.appendChild(actionRow);
    return card;
  }

  private createFeatureGrid(step: OnboardingStep): HTMLElement {
    const grid = this.createElement("div", {
      styles: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
        gap: "12px",
        marginTop: "24px",
      },
    });

    step.cards.forEach((item) => {
      grid.appendChild(
        this.createElement("div", {
          styles: {
            padding: "16px",
            border: "1px solid rgba(89, 192, 188, 0.2)",
            borderRadius: "14px",
            backgroundColor: "rgba(89, 192, 188, 0.045)",
            minWidth: "0",
          },
          children: [
            this.createElement("div", {
              textContent: item.icon,
              styles: { fontSize: "28px", marginBottom: "10px" },
            }),
            this.createElement("div", {
              textContent: item.title,
              styles: {
                fontWeight: "800",
                marginBottom: "8px",
                color: "var(--ai-text, #222)",
              },
            }),
            this.createElement("div", {
              textContent: item.detail,
              styles: {
                color: "var(--ai-text-muted, #666)",
                lineHeight: "1.55",
                fontSize: "13px",
              },
            }),
          ],
        }),
      );
    });

    return grid;
  }

  private createActionRow(step: OnboardingStep): HTMLElement {
    const row = this.createElement("div", {
      styles: {
        display: "flex",
        justifyContent: "space-between",
        gap: "12px",
        flexWrap: "wrap",
        marginTop: "28px",
        borderTop: "1px solid rgba(89, 192, 188, 0.18)",
        paddingTop: "18px",
      },
    });

    const left = this.createElement("div", {
      styles: { display: "flex", gap: "10px", flexWrap: "wrap" },
    });
    if (this.currentIndex > 0) {
      const prev = createStyledButton("上一步", "#607d8b", "medium");
      prev.addEventListener("click", () => {
        this.currentIndex = Math.max(0, this.currentIndex - 1);
        this.renderStep();
      });
      left.appendChild(prev);
    }
    const dashboard = createStyledButton("回到仪表盘", "#9e9e9e", "medium");
    dashboard.addEventListener("click", () =>
      MainWindow.getInstance().switchTab("dashboard"),
    );
    left.appendChild(dashboard);

    const right = this.createElement("div", {
      styles: { display: "flex", gap: "10px", flexWrap: "wrap" },
    });
    step.actions.forEach((action) => {
      const button = createStyledButton(action.label, action.color, "medium");
      button.addEventListener("click", () => this.handleAction(action));
      right.appendChild(button);
    });
    if (this.currentIndex < onboardingSteps.length - 1) {
      const next = createStyledButton("下一步", "#00a67e", "medium");
      next.addEventListener("click", () => {
        this.currentIndex = Math.min(
          onboardingSteps.length - 1,
          this.currentIndex + 1,
        );
        this.renderStep();
      });
      right.appendChild(next);
    }

    row.appendChild(left);
    row.appendChild(right);
    return row;
  }

  private handleAction(action: OnboardingAction): void {
    switch (action.id) {
      case "openSetupWizard":
        showSetupWizard(this.container?.ownerDocument || undefined);
        break;
      case "openSettings":
        MainWindow.getInstance().switchTab("settings");
        break;
      case "openScanner":
        MainWindow.getInstance().openLibraryScanner("summary");
        break;
      case "openTasks":
        MainWindow.getInstance().switchTab("tasks");
        break;
      case "openDocs":
        openExternalUrl(ONBOARDING_DOCS_URL);
        break;
      case "finish":
        markOnboardingTutorialSeen();
        new ztoolkit.ProgressWindow("AI Butler", { closeTime: 2400 })
          .createLine({ text: "✅ 新手教程已完成", type: "success" })
          .show();
        MainWindow.getInstance().switchTab("dashboard");
        break;
      case "dismiss":
        MainWindow.getInstance().switchTab("dashboard");
        break;
    }
  }
}
