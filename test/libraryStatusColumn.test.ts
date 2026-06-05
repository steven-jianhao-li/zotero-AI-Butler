import { expect } from "chai";
import {
  isSummaryTask,
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
  });

  it("uses active task status before existing summary notes", function () {
    const status = resolveSummaryStatusFromTasks(
      [createTask(TaskStatus.PROCESSING, { progress: 43 })],
      true,
    );

    expect(status.status).to.equal("processing");
    expect(status.progress).to.equal(43);
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
  });
});
