import { AgentStore } from "../../agent/AgentStore";
import { button, element, t } from "./dom";
import { icon } from "./icons";

/** Explain local persistence and open the same directory used by AgentStore. */
export function agentStorageInfo(
  doc: Document,
  onError: (error: unknown) => void,
): HTMLElement {
  const details = element(doc, "details", "agent-storage-info");
  const summary = element(doc, "summary", "agent-storage-summary");
  summary.title = t("agent-storage-details");
  summary.append(
    icon(doc, "local"),
    element(doc, "span", "", t("agent-session-storage")),
    icon(doc, "info"),
  );
  const panel = element(doc, "div", "agent-storage-panel");
  const path = element(
    doc,
    "code",
    "agent-storage-path",
    AgentStore.directory(),
  );
  path.tabIndex = 0;
  const open = button(doc, t("agent-storage-open"), () => {
    open.disabled = true;
    void AgentStore.openDirectory()
      .catch(onError)
      .finally(() => {
        open.disabled = false;
      });
  });
  panel.append(
    element(doc, "strong", "", t("agent-storage-details")),
    element(doc, "p", "", t("agent-storage-description")),
    path,
    open,
  );
  details.append(summary, panel);
  details.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Escape") {
      details.open = false;
      summary.focus();
    }
  });
  return details;
}
