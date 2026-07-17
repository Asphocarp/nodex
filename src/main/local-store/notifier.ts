import { EventEmitter } from "events";
import type { DatabasePageSummary } from "../../shared/types";
import type { DatabaseChangeEvent } from "../../shared/database-events";
import type { PageTargetChangedEvent } from "../../shared/page-target-events";
import type { PageOwnershipPathsChangedEvent } from "../../shared/page-ownership-path-events";
import { recordDevRuntimeMetricCounter } from "../dev-runtime-metrics";

export type ChangeType = "create" | "update" | "delete" | "move" | "undo" | "redo" | "revert" | "restore";
export type ProjectChangeType = "create" | "update" | "delete" | "reorder" | "pin";
export type ProjectSessionChangeType =
  | "create"
  | "update"
  | "delete"
  | "move"
  | "reorder"
  | "pin"
  | "archive"
  | "unarchive"
  | "unread"
  | "link"
  | "thread";

export interface BoardChangeEvent {
  projectId: string;
  changeType: ChangeType;
  columnId: string;
  status: string;
  pageId?: string;
  summary?: DatabasePageSummary;
  mutationId?: string;
  metrics?: {
    workerDurationMs?: number;
    queueWaitMs?: number;
    transactionMs?: number;
  };
}

export interface ProjectSessionsChangeEvent {
  projectId: string | null;
  changeType: ProjectSessionChangeType;
  sessionId?: string;
}

export interface ProjectsChangeEvent {
  projectId?: string;
  changeType: ProjectChangeType;
}

export class DatabaseNotifier extends EventEmitter {
  constructor() {
    super();
    // Each SSE connection adds a listener; disable the default cap
    // since listeners are properly removed on disconnect.
    this.setMaxListeners(0);
  }

  notifyChange(
    projectId: string,
    changeType: ChangeType,
    columnId: string,
    pageId?: string,
    details?: Pick<BoardChangeEvent, "summary" | "mutationId" | "metrics">,
  ): void {
    this.emit("board-changed", {
      projectId,
      changeType,
      columnId,
      status: columnId,
      pageId,
      ...details,
    });
  }

  notifyDatabaseChanged(event: DatabaseChangeEvent): void {
    this.emit("database-changed", event);
  }

  notifyPageTargetChanged(event: PageTargetChangedEvent): void {
    this.emit("page-target-changed", event);
    if (event.changeKind === "location" || event.changeKind === "lifecycle") {
      this.notifyPageOwnershipPathsChanged({
        libraryId: event.libraryId,
        changeKind: event.changeKind,
      });
    }
  }

  notifyPageOwnershipPathsChanged(event: PageOwnershipPathsChangedEvent): void {
    this.emit("page-ownership-paths-changed", event);
  }

  notifyProjectsChanged(changeType: ProjectChangeType, projectId?: string): void {
    this.emit("projects-changed", { projectId, changeType });
  }

  notifyProjectSessionsChanged(
    projectId: string | null,
    changeType: ProjectSessionChangeType,
    sessionId?: string,
  ): void {
    recordDevRuntimeMetricCounter("project_sessions_changed.burst_window", {
      projectId,
      changeType,
      sessionId,
    }, {
      groupBy: ["projectId", "changeType"],
      windowMs: 1_000,
      burstThreshold: 20,
      burstMetric: "project_sessions_changed.burst",
    });
    this.emit("project-sessions-changed", { projectId, changeType, sessionId });
  }
}

export const dbNotifier = new DatabaseNotifier();
