import { getString } from "../../../utils/locale";
import { getPref } from "../../../utils/prefs";
import {
  INCOMPLETE_NOTE_TAG,
  isDeepReadNote,
  isRegularSummaryNote,
} from "../../aiNoteClassifier";
import { hasIncompleteDeepReadContent } from "../../deepReadEngine";
import {
  getDeepReadTaskId,
  getLegacySummaryTaskId,
  getSummaryTaskId,
  TaskQueueManager,
  TaskStatus,
  type TaskItem,
} from "../../taskQueue";
import {
  assertObjectScope,
  assertWritable,
  scopedItem,
  source,
  tool,
} from "./libraryAccess";
import type { AgentTool, AgentToolContext } from "./types";
import { booleanArg, enumArg, integerArg, stringArg } from "./validation";

type WorkflowMode = "summary" | "deepRead";
const MAX_WAIT_MS = 30 * 60 * 1000;

function active(task?: TaskItem): boolean {
  return (
    !!task &&
    [TaskStatus.PENDING, TaskStatus.PRIORITY, TaskStatus.PROCESSING].includes(
      task.status,
    )
  );
}

function workflowTask(
  queue: TaskQueueManager,
  itemId: number,
  mode: WorkflowMode,
) {
  return mode === "deepRead"
    ? queue.getTask(getDeepReadTaskId(itemId))
    : queue.getTask(getSummaryTaskId(itemId)) ||
        queue.getTask(getLegacySummaryTaskId(itemId));
}

/** Read classifications directly: AiNoteService.findNote can migrate legacy notes. */
async function artifact(
  item: Zotero.Item,
  mode: WorkflowMode,
  context: AgentToolContext,
) {
  let latest: Zotero.Item | undefined;
  for (const id of item.getNotes()) {
    const note = await Zotero.Items.getAsync(id);
    context.assertActive();
    if (
      !note ||
      note.deleted ||
      note.libraryID !== item.libraryID ||
      note.parentID !== item.id ||
      !note.isNote()
    )
      continue;
    const tags = note.getTags();
    const classificationTags = tags.filter(
      ({ tag }) => tag !== INCOMPLETE_NOTE_TAG,
    );
    const html = note.getNote();
    if (
      !(mode === "summary"
        ? isRegularSummaryNote(classificationTags, html)
        : isDeepReadNote(classificationTags, html))
    )
      continue;
    if (
      !latest ||
      String(note.getField("dateModified")) >
        String(latest.getField("dateModified"))
    )
      latest = note;
  }
  assertObjectScope(item, context);
  if (!latest) return { noteId: null, ready: false, source: null };
  const html = latest.getNote();
  assertObjectScope(latest, context);
  const ready =
    !latest.getTags().some(({ tag }) => tag === INCOMPLETE_NOTE_TAG) &&
    !!html.replace(/<[^>]*>/g, " ").trim() &&
    (mode !== "deepRead" || !hasIncompleteDeepReadContent(html));
  return { noteId: latest.id, ready, source: source(latest) };
}

async function snapshot(
  queue: TaskQueueManager,
  item: Zotero.Item,
  mode: WorkflowMode,
  context: AgentToolContext,
) {
  const note = await artifact(item, mode, context);
  const task = workflowTask(queue, item.id, mode);
  return {
    taskId:
      task?.id ||
      (mode === "summary"
        ? getSummaryTaskId(item.id)
        : getDeepReadTaskId(item.id)),
    source: source(item),
    mode,
    status: task?.status || (note.ready ? "completed" : "not_started"),
    taskPresent: !!task,
    progress: task?.progress || (note.ready && !task ? 100 : 0),
    stage: task?.stage,
    message: task?.workflowStage?.slice(0, 1000),
    error: task?.error?.slice(0, 2000),
    noteId: note.noteId,
    noteSource: note.source,
    artifactReady: note.ready,
    noteStrategy: String(getPref("noteStrategy") || "skip"),
  };
}

/** Suspend this tool call on queue events, without spending model turns polling. */
function waitForTask(
  queue: TaskQueueManager,
  taskId: string,
  context: AgentToolContext,
): Promise<boolean> {
  context.assertActive();
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanups: (() => void)[] = [];
    const finish = (timedOut: boolean, error?: unknown) => {
      if (settled) return;
      settled = true;
      for (const cleanup of cleanups) cleanup();
      if (error) reject(error);
      else resolve(timedOut);
    };
    const check = (id: string) => {
      // Completion callbacks also fire for retriable failures. Wait for a terminal state.
      if (id === taskId && !active(queue.getTask(taskId))) finish(false);
    };
    const aborted = () =>
      finish(false, new Error(getString("provider-error-aborted")));
    cleanups.push(
      queue.onComplete(check),
      queue.onProgress(check),
      queue.onRemoved(check),
    );
    context.signal.addEventListener?.("abort", aborted, { once: true });
    cleanups.push(() => context.signal.removeEventListener?.("abort", aborted));
    const timer = setTimeout(() => finish(true), MAX_WAIT_MS);
    cleanups.push(() => clearTimeout(timer));
    // Subscribe first, then check, so completion/cancellation cannot be lost.
    if (context.signal.aborted) aborted();
    else check(taskId);
  });
}

export function createPaperWorkflowTools(): AgentTool[] {
  return [
    tool(
      "start_paper_workflow",
      "Start the plugin's standard AI summary or multi-round deep-reading workflow for a paper. Requires write permission; runs asynchronously in the existing task queue with saved workflow/model/PDF settings. Reuses active tasks and complete notes by default. Set regenerate=true only when the user explicitly requests regeneration; the saved skip/append/overwrite note strategy still applies. Returns before/after state and taskId, not completion. To continue with results, use get_paper_workflow_status(wait=true), then read_note. Stopping the Agent does not cancel queued tasks.",
      {
        itemId: { type: "integer", minimum: 1 },
        mode: { type: "string", enum: ["summary", "deepRead"] },
        regenerate: { type: "boolean" },
      },
      ["itemId", "mode"],
      async (args, context) => {
        const item = await scopedItem(integerArg(args, "itemId", 1), context);
        if (!item.isRegularItem())
          throw new Error(getString("agent-tool-error-not-paper"));
        const mode = enumArg(args, "mode", ["summary", "deepRead"] as const);
        const regenerate = booleanArg(args, "regenerate");
        const queue = TaskQueueManager.getInstance();
        const before = await snapshot(queue, item, mode, context);
        const currentTask = workflowTask(queue, item.id, mode);
        if (
          currentTask &&
          (currentTask.itemId !== item.id ||
            (currentTask.taskType || "summary") !== mode)
        )
          throw new Error(getString("agent-tool-error-workflow-task"));
        if (active(currentTask)) {
          return {
            disposition: "existing_task",
            taskId: before.taskId,
            before,
            after: before,
          };
        }
        if (before.artifactReady && !regenerate) {
          return {
            disposition: "reused_result",
            taskId: before.taskId,
            before,
            after: before,
          };
        }
        assertWritable(context);
        assertObjectScope(item, context);
        const options = {
          source: "manual" as const,
          summaryMode: mode === "summary" ? "single" : "deepRead",
        };
        const taskId =
          mode === "summary"
            ? await queue.addTask(item, false, options)
            : await queue.addDeepReadTask(item, false, options);
        // Preserve the receipt even if cancellation arrives after enqueueing succeeds.
        return {
          disposition: "submitted",
          taskId,
          before,
          after: {
            status: queue.getTask(taskId)?.status,
            progress: queue.getTask(taskId)?.progress,
          },
          instruction:
            "Query get_paper_workflow_status for the current state and result note. Use wait=true when subsequent research depends on completion.",
        };
      },
      true,
    ),
    tool(
      "get_paper_workflow_status",
      "Read the status, progress, error, and result noteId of a standard summary/deep-reading task in this library. Accepts task IDs returned by start_paper_workflow. Read-only; never regenerates or migrates notes. With wait=true, subscribes to queue events until completion/final failure/removal (up to 30 minutes) and returns the result so you can continue; no repeated polling needed. After timeout report the pending task instead of repeatedly waiting. Stopping the Agent ends this wait but leaves the queue task running. A missing task can still have a reusable note; check artifactReady and read_note.",
      {
        taskId: { type: "string", minLength: 1, maxLength: 100 },
        wait: { type: "boolean" },
      },
      ["taskId"],
      async (args, context) => {
        const taskId = stringArg(args, "taskId", 100);
        const match = /^(summary-task|deepread-task|task)-([1-9]\d*)$/.exec(
          taskId,
        );
        if (!match)
          throw new Error(getString("agent-tool-error-workflow-task"));
        const itemId = integerArg({ itemId: Number(match[2]) }, "itemId", 1);
        const item = await scopedItem(itemId, context);
        if (!item.isRegularItem())
          throw new Error(getString("agent-tool-error-not-paper"));
        const mode = match[1] === "deepread-task" ? "deepRead" : "summary";
        const wait = booleanArg(args, "wait");
        const queue = TaskQueueManager.getInstance();
        const task = workflowTask(queue, item.id, mode);
        if (
          task &&
          (task.itemId !== item.id || (task.taskType || "summary") !== mode)
        )
          throw new Error(getString("agent-tool-error-workflow-task"));
        const waitTimedOut =
          wait && task ? await waitForTask(queue, task.id, context) : false;
        return {
          ...(await snapshot(queue, item, mode, context)),
          waitTimedOut,
          taskRemoved: !!task && !workflowTask(queue, item.id, mode),
        };
      },
    ),
  ];
}
