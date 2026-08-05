import { EventEmitter } from "events";
import type { DatabasePageSummary } from "../../shared/types";
import type { ProjectSessionsChangeEvent } from "../../shared/ipc-api";
import type { DatabaseChangeEvent } from "../../shared/database-events";
import type { PageOwnershipPathsChangedEvent } from "../../shared/page-ownership-path-events";
import {
  parseDatabaseId,
  parseDatabaseViewId,
} from "../../shared/database-identities";
import {
  LIBRARY_NAVIGATION_EVENT_VERSION,
  type LibraryNavigationChangedEvent,
} from "../../shared/library-events";
import { recordDevRuntimeMetricCounter } from "../dev-runtime-metrics";

export type ChangeType = "create" | "update" | "delete" | "move" | "undo" | "redo" | "revert" | "restore";
export type ProjectChangeType =
  | "create"
  | "update"
  | "metadata"
  | "sources"
  | "lifecycle"
  | "delete"
  | "reorder"
  | "pin";
export interface BoardChangeEvent {
  projectId: string;
  storeEpoch?: string;
  commitSeq?: number;
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
    if (!event.libraryId) return;
    this.notifyLibraryNavigationChanged({
      version: LIBRARY_NAVIGATION_EVENT_VERSION,
      libraryId: event.libraryId,
      storeEpoch: event.storeEpoch,
      commitSeq: event.commitSeq,
      changeKind: "database",
      affectedParentKeys: [
        "library",
        "catalog",
        ...event.affectedDatabaseIds.map((id) => `database:${id}`),
      ],
      affectedPageIds: event.affectedPageIds ?? [],
      affectedDatabaseIds: event.affectedDatabaseIds.map(parseDatabaseId),
      affectedViewIds: (event.affectedViewIds ?? []).map(parseDatabaseViewId),
    });
  }

  notifyLibraryNavigationChanged(event: LibraryNavigationChangedEvent): void {
    this.emit("library-navigation-changed", event);
  }

  notifyPageOwnershipPathsChanged(event: PageOwnershipPathsChangedEvent): void {
    this.emit("page-ownership-paths-changed", event);
  }

  notifyProjectsChanged(changeType: ProjectChangeType, projectId?: string): void {
    this.emit("projects-changed", { projectId, changeType });
  }

  notifyProjectSessionInvalidation(event: ProjectSessionsChangeEvent): void {
    const scopeKey = event.summaryScopes
      .map((scope) => scope.kind === "project" ? scope.projectId : scope.kind)
      .join(",");
    recordDevRuntimeMetricCounter("project_sessions_changed.burst_window", {
      scopeKey,
      changeType: event.changeType,
      detailScope: event.detailInvalidation.kind,
      detailCount: event.detailInvalidation.kind === "sessions"
        ? event.detailInvalidation.sessionIds.length
        : 0,
    }, {
      groupBy: ["scopeKey", "changeType"],
      windowMs: 1_000,
      burstThreshold: 20,
      burstMetric: "project_sessions_changed.burst",
    });
    this.emit("project-sessions-changed", event);
  }
}

export const dbNotifier = new DatabaseNotifier();
