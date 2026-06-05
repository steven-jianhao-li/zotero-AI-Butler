import { expect } from "chai";
import {
  isDeepReadTask,
  isSummaryTask,
  resolveCombinedAiStatusFromTasks,
  resolveDeepReadStatusFromTasks,
  resolveSummaryStatusFromTasks,
  type SummaryTaskLike,
} from "../src/modules/libraryStatusColumn";
import { TaskStatus } from "../src/modules/taskQueue";

function createTask(
  status: TaskStatus,
  options: Partial<SummaryTaskLike> = {},
): SummaryTaskLike {
  return {
    id: `task-${options.itemId || 1}-${status}`,
    itemId: options.itemId || 1,
    status,
    progress: options.progress ?? 0,
    createdAt: options.createdAt || new Date("2026-01-01T00:00:00Z"),
    completedAt: options.completedAt,
    error: options.error,
    taskType: options.taskType,
  };
}

describe("library status column", function () {
  it("treats unset and summary task types as summary tasks only", function () {
    expect(isSummaryTask(createTask(TaskStatus.PENDING))).to.equal(true);
    expect(
      isSummaryTask(
        createTask(TaskStatus.PENDING, {
          taskType: "summary",
        }),
      ),
    ).to.equal(true);
    expect(
      isSummaryTask(
        createTask(TaskStatus.PENDING, {
          taskType: "imageSummary",
        }),
      ),
    ).to.equal(false);
  });

  it("returns idle when there is no task or summary note", function () {
    const status = resolveSummaryStatusFromTasks([], false);

    expect(status.status).to.equal("idle");
    expect(status.progress).to.equal(0);
    expect(status.tooltip).to.equal("\u672a\u603b\u7ed3");
  });

  it("uses active task status before existing summary notes", function () {
    const status = resolveSummaryStatusFromTasks(
      [createTask(TaskStatus.PROCESSING, { progress: 43 })],
      true,
    );

    expect(status.status).to.equal("processing");
    expect(status.progress).to.equal(43);
    expect(status.tooltip).to.equal("AI \u603b\u7ed3\u5904\u7406\u4e2d 43%");
  });

  it("shows queued state for pending and priority summary tasks", function () {
    const status = resolveSummaryStatusFromTasks(
      [createTask(TaskStatus.PRIORITY)],
      false,
    );

    expect(status.status).to.equal("queued");
    expect(status.tooltip).to.contain("优先");
  });

  it("shows completed when a regular summary note exists", function () {
    const status = resolveSummaryStatusFromTasks([], true);

    expect(status.status).to.equal("completed");
    expect(status.progress).to.equal(100);
    expect(status.tooltip).to.equal("AI \u603b\u7ed3\u5df2\u5b8c\u6210");
  });

  it("keeps completed green when a failed task has an existing summary note", function () {
    const status = resolveSummaryStatusFromTasks(
      [createTask(TaskStatus.FAILED, { error: "quota exceeded" })],
      true,
    );

    expect(status.status).to.equal("completed");
    expect(status.progress).to.equal(100);
  });

  it("ignores non-summary tasks when calculating status", function () {
    const status = resolveSummaryStatusFromTasks(
      [
        createTask(TaskStatus.PROCESSING, {
          progress: 80,
          taskType: "mindmap",
        }),
      ],
      false,
    );

    expect(status.status).to.equal("idle");
    expect(status.tooltip).to.equal("\u672a\u603b\u7ed3");
  });

  it("resolves deep-read task status independently", function () {
    const summaryStatus = resolveSummaryStatusFromTasks(
      [
        createTask(TaskStatus.PROCESSING, {
          progress: 80,
          taskType: "deepRead",
        }),
      ],
      false,
    );
    const deepReadStatus = resolveDeepReadStatusFromTasks(
      [
        createTask(TaskStatus.PROCESSING, {
          progress: 80,
          taskType: "deepRead",
        }),
      ],
      false,
    );

    expect(summaryStatus.status).to.equal("idle");
    expect(summaryStatus.tooltip).to.equal("\u672a\u603b\u7ed3");
    expect(deepReadStatus.status).to.equal("processing");
    expect(deepReadStatus.progress).to.equal(80);
    expect(deepReadStatus.tooltip).to.equal(
      "AI \u7cbe\u8bfb\u5904\u7406\u4e2d 80%",
    );
  });

  it("returns idle when there is no deep-read task or note", function () {
    const status = resolveDeepReadStatusFromTasks([], false);

    expect(status.status).to.equal("idle");
    expect(status.progress).to.equal(0);
    expect(status.tooltip).to.equal("\u672a\u7cbe\u8bfb");
  });

  it("shows completed when a deep-read note exists", function () {
    const status = resolveDeepReadStatusFromTasks([], true);

    expect(status.status).to.equal("completed");
    expect(status.progress).to.equal(100);
    expect(status.tooltip).to.equal("AI \u7cbe\u8bfb\u5df2\u5b8c\u6210");
  });

  it("treats deepRead as its own task type", function () {
    const task = createTask(TaskStatus.PENDING, { taskType: "deepRead" });
    expect(isSummaryTask(task)).to.equal(false);
    expect(isDeepReadTask(task)).to.equal(true);
  });

  it("combines summary and deep-read status in one tooltip", function () {
    const status = resolveCombinedAiStatusFromTasks(
      [
        createTask(TaskStatus.PROCESSING, {
          progress: 42,
          taskType: "deepRead",
        }),
      ],
      true,
      false,
    );

    expect(status.status).to.equal("processing");
    expect(status.progress).to.equal(42);
    expect(status.tooltip).to.contain("AI 总结已完成");
    expect(status.tooltip).to.contain("AI 精读处理中 42%");
  });
});
