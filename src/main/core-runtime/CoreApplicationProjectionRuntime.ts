import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type {
  CodexAutomationRunsUpdatedEvent,
  CodexScheduledAutomationChangedEvent,
} from "../../shared/types";
import type { CoreAuthorizedDeliveryAtom, CoreEventEnvelope } from "../core-client";
import {
  allProjectSessionInvalidation,
  planCoreWorkspaceNotifications,
} from "../core-client/core-project-workspace-invalidation";
import type { DatabaseNotificationPublisher } from "../host-runtime/DatabaseNotifierRuntime";
import { getLogger } from "../logging/logger";
import { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import { projectCoreApplicationEvent } from "./CoreApplicationEventProjection";

export interface CoreAutomationProjectionPort {
  readonly notifyAutomationRunsUpdated: (event: CodexAutomationRunsUpdatedEvent) => void;
  readonly notifyScheduledAutomationChanged: (event: CodexScheduledAutomationChangedEvent) => void;
  readonly synchronize: Effect.Effect<void>;
}

export interface CoreApplicationProjectionRuntimeOptions {
  readonly automation: CoreAutomationProjectionPort;
  readonly notifications: DatabaseNotificationPublisher;
}

export class CoreApplicationProjectionRuntime extends Context.Service<
  CoreApplicationProjectionRuntime,
  {
    readonly publish: (
      envelope: CoreEventEnvelope,
      atom: CoreAuthorizedDeliveryAtom,
      libraryId: string,
    ) => void;
    readonly publishResync: (input: {
      readonly commitSeq: number;
      readonly libraryId: string;
      readonly storeEpoch: string | null;
    }) => void;
  }
>()("nodex/main/core-runtime/CoreApplicationProjectionRuntime") {}

export const live = (
  options: CoreApplicationProjectionRuntimeOptions,
): Layer.Layer<CoreApplicationProjectionRuntime, never, ScopedCallbackRuntime> =>
  Layer.effect(
    CoreApplicationProjectionRuntime,
    Effect.gen(function* () {
      const callbacks = yield* ScopedCallbackRuntime;
      const logger = getLogger({ component: "core-application-projection-runtime" });

      const publish = (
        envelope: CoreEventEnvelope,
        atom: CoreAuthorizedDeliveryAtom,
        libraryId: string,
      ): void => {
        const projected = projectCoreApplicationEvent(envelope, atom, libraryId);
        if (!projected || projected.kind === "store-administration") return;

        if (projected.kind === "automation") {
          const automationEvent = projected.value;
          callbacks.fork(
            options.automation.synchronize.pipe(
              Effect.catchCause((cause) =>
                Effect.sync(() => {
                  logger.warn("Failed to refresh Automation runtime cache", { cause });
                }),
              ),
            ),
          );
          for (const automationId of automationEvent.automationIds) {
            options.automation.notifyScheduledAutomationChanged({
              automationId,
              targetThreadId: null,
              reason: "upsert",
            });
          }
          if (automationEvent.automationIds.length > 0 || automationEvent.runIds.length > 0) {
            options.automation.notifyAutomationRunsUpdated({
              automationId:
                automationEvent.automationIds.length === 1
                  ? (automationEvent.automationIds[0] ?? null)
                  : null,
              threadId:
                automationEvent.runIds.length === 1 ? (automationEvent.runIds[0] ?? null) : null,
              reason: "settle",
            });
          }
          return;
        }

        if (projected.kind === "database") {
          const databaseEvent = projected.value;
          options.notifications.notifyDatabaseChanged(databaseEvent);
          if ((databaseEvent.affectedViewIds ?? []).length > 0) {
            // The Project catalog projects a Database's primary default View.
            options.notifications.notifyProjectsChanged("update", databaseEvent.projectId);
          }
          return;
        }

        if (projected.kind === "library-navigation") {
          options.notifications.notifyLibraryNavigationChanged(projected.value);
          return;
        }

        const workspaceEvent = projected.value;
        const notifications = planCoreWorkspaceNotifications(workspaceEvent);
        if (notifications.project) {
          options.notifications.notifyProjectsChanged(
            notifications.project.changeType,
            notifications.project.projectId,
          );
        }
        if (notifications.invalidateStandaloneRoots) {
          options.notifications.notifyLibraryNavigationChanged({
            version: 1,
            libraryId,
            storeEpoch: envelope.packet.manifest.identity.store_epoch,
            commitSeq: envelope.packet.manifest.identity.commit_seq,
            changeKind: "lifecycle",
            affectedParentKeys: ["standalone_roots"],
            affectedPageIds: [],
            affectedDatabaseIds: [],
            affectedViewIds: [],
          });
        }
        if (notifications.sessions) {
          options.notifications.notifyProjectSessionInvalidation(notifications.sessions);
        }
      };

      return CoreApplicationProjectionRuntime.of({
        publish,
        publishResync: ({ commitSeq, libraryId, storeEpoch }) => {
          options.notifications.notifyLibraryNavigationChanged({
            version: 1,
            libraryId,
            storeEpoch,
            commitSeq,
            changeKind: "content",
            affectedParentKeys: ["library", "catalog"],
            affectedPageIds: [],
            affectedDatabaseIds: [],
            affectedViewIds: [],
          });
          options.notifications.notifyProjectsChanged("update");
          options.notifications.notifyProjectSessionInvalidation(allProjectSessionInvalidation());
        },
      });
    }),
  );
