import { EventEmitter } from "events";
import type { DatabasePageSummary } from "../../shared/types";
import type { ProjectSessionsChangeEvent } from "../../shared/ipc-api";
import type { DatabaseChangeEvent } from "../../shared/database-events";
import type { PageTargetChangedEvent } from "../../shared/page-target-events";
import type { PageOwnershipPathsChangedEvent } from "../../shared/page-ownership-path-events";
import type { AuthorityResyncEvent } from "../../shared/authority-resync-events";
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
      changeLogSeq: event.changeLogSeq,
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

  notifyPageTargetChanged(
    event: PageTargetChangedEvent,
    options: { readonly notifyLibraryNavigation?: boolean } = {},
  ): void {
    this.emit("page-target-changed", event);
    if (options.notifyLibraryNavigation === false) return;
    this.notifyLibraryNavigationChanged({
      version: LIBRARY_NAVIGATION_EVENT_VERSION,
      libraryId: event.libraryId,
      storeEpoch: event.storeEpoch,
      changeLogSeq: event.changeLogSeq,
      changeKind: event.changeKind === "metadata"
        ? "content"
        : event.changeKind,
      affectedParentKeys: ["library", "catalog", `page:${event.targetPageId}`],
      affectedPageIds: [event.targetPageId],
      affectedDatabaseIds: event.affectedDatabaseIds.map(parseDatabaseId),
      affectedViewIds: [],
    });
    if (event.changeKind === "location" || event.changeKind === "lifecycle") {
      this.notifyPageOwnershipPathsChanged({
        libraryId: event.libraryId,
        changeKind: event.changeKind,
      });
    }
  }

  notifyLibraryNavigationChanged(event: LibraryNavigationChangedEvent): void {
    this.emit("library-navigation-changed", event);
  }

  notifyPageOwnershipPathsChanged(event: PageOwnershipPathsChangedEvent): void {
    this.emit("page-ownership-paths-changed", event);
  }

  notifyAuthorityResync(event: AuthorityResyncEvent): void {
    this.emit("authority-resync", event);
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
