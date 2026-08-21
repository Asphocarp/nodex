import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { WebContents } from "electron";
import type { DeliveryAddress, RecipientAdmissionResult } from "../../shared/recipient-delivery";
import { projectionScopeDeliveryAddress } from "../../shared/recipient-delivery";
import { revocationsFromVisibilityDelta } from "../../shared/local-commit-delivery";
import { LocalCommitAudienceBroker } from "../core-client/local-commit-audience-broker";
import { LocalCommitCoordinator } from "../core-client/local-commit-coordinator";
import { RecipientDeliveryRouter } from "../core-client/recipient-delivery-router";
import { ScopedProjectionLiveSupervisor } from "../core-client/scoped-projection-live-supervisor";
import type {
  CoreAuthorizedDeliveryAtom,
  CoreEventEnvelope,
  CoreStreamCheckpoint,
  DesktopDataAuthorityRuntime,
  DesktopDocumentSyncPort,
} from "../core-client";
import { safeSendToWebContents } from "../ipc-safe-send";
import { getLogger } from "../logging/logger";

export class ProjectionDeliveryError extends Schema.TaggedError<ProjectionDeliveryError>()(
  "ProjectionDeliveryError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export interface ProjectionDeliveryRuntimeOptions {
  readonly authority: DesktopDataAuthorityRuntime;
  readonly documentSync: DesktopDocumentSyncPort;
  readonly onNotification: (
    envelope: CoreEventEnvelope,
    atom: CoreAuthorizedDeliveryAtom,
    libraryId: string,
  ) => void;
}

export class ProjectionDeliveryRuntime extends Context.Service<
  ProjectionDeliveryRuntime,
  {
    readonly admitRecipientResult: (senderId: number, result: RecipientAdmissionResult) => boolean;
    readonly deliverTail: (
      envelope: CoreEventEnvelope,
    ) => Effect.Effect<void, ProjectionDeliveryError>;
    readonly observeCheckpoint: (checkpoint: CoreStreamCheckpoint) => void;
    readonly releaseSender: (senderId: number) => void;
    readonly resetStream: (reason: "event_gap" | "reconnect" | "store_epoch_changed") => void;
    readonly subscribe: (sender: WebContents, address: DeliveryAddress) => () => void;
  }
>()("nodex/main/core-runtime/ProjectionDeliveryRuntime") {}

export const live = (
  options: ProjectionDeliveryRuntimeOptions,
): Layer.Layer<ProjectionDeliveryRuntime> =>
  Layer.effect(
    ProjectionDeliveryRuntime,
    Effect.acquireRelease(
      Effect.sync(() => {
        const logger = getLogger({ component: "projection-delivery-runtime" });
        const coreClient = options.authority.rootClient;
        const coreIdentity = options.authority.identity;
        const router = new RecipientDeliveryRouter({
          send: (sender, channel, envelope) => safeSendToWebContents(sender, channel, [envelope]),
        });
        let supervisor: ScopedProjectionLiveSupervisor | null = null;
        const audience = new LocalCommitAudienceBroker({
          router,
          onScopesChanged: (scopes) => supervisor?.setScopes(scopes),
          resolveLibraryId: () => coreIdentity.libraryId,
        });
        const coordinator = new LocalCommitCoordinator({
          expectedLibraryId: coreIdentity.libraryId,
          expectedStoreEpoch: coreIdentity.storeEpoch,
          onDocument: (packet, documentId) =>
            options.documentSync.publishDocumentEffects(packet, documentId),
          onProjection: () => undefined,
          onNotification: (packet, atom) => {
            options.onNotification(
              {
                transport_version: coreClient.handshake.selected_transport_version,
                packet,
              },
              atom,
              coreIdentity.libraryId,
            );
          },
          onVisibility: (packet, delta) => {
            for (const revocation of revocationsFromVisibilityDelta(delta)) {
              if (revocation.resource_kind === "document") {
                options.documentSync.publishResourceRevocation(packet, revocation);
              }
            }
          },
          onError: (failure) => {
            logger.error("LocalCommit delivery lane failed", {
              lane: failure.lane,
              laneKey: failure.laneKey,
              commitSeq: failure.packet.manifest.identity.commit_seq,
              storeEpoch: failure.packet.manifest.identity.store_epoch,
              error: failure.error instanceof Error ? failure.error.message : String(failure.error),
            });
            if (failure.lane !== "projection" && failure.lane !== "visibility") return;
            audience.reset(
              {
                storeEpoch: failure.packet.manifest.identity.store_epoch,
                commitSeq: failure.packet.manifest.identity.commit_seq,
              },
              "integrity_failure",
              [failure.packet.delivery_address],
            );
          },
        });
        supervisor = new ScopedProjectionLiveSupervisor({
          open: (scopes, onEvent, onRepair, signal) =>
            coreClient.openProjectionEventStream(scopes, onEvent, onRepair, signal),
          onPacket: (envelope) => {
            coordinator.admit(envelope.packet, "projection_live");
            audience.publish(envelope.packet);
          },
          onBarrier: (barrier, scopes, resetScopes) => {
            const storeEpochChanged = barrier.store_epoch !== coreIdentity.storeEpoch;
            audience.installLeases(
              barrier.recipient_leases,
              {
                storeEpoch: barrier.store_epoch,
                commitSeq: barrier.commit_head,
              },
              (storeEpochChanged ? scopes : resetScopes).map(projectionScopeDeliveryAddress),
              storeEpochChanged ? "store_epoch_replacement" : "stream_gap",
            );
          },
          onRepair: (repair) => {
            audience.reset(
              {
                storeEpoch: repair.store_epoch,
                commitSeq: repair.commit_head,
              },
              repair.reason === "identity_changed" ? "store_epoch_replacement" : "stream_gap",
            );
          },
          onError: (error) => {
            logger.warn("Scoped Projection live broker interrupted", {
              error: error instanceof Error ? error.message : String(error),
            });
          },
        });
        audience.refreshScopes();

        return {
          service: ProjectionDeliveryRuntime.of({
            admitRecipientResult: (senderId, result) => router.admit(senderId, result),
            deliverTail: (envelope) =>
              Effect.tryPromise({
                try: () => coordinator.admitAndWait(envelope.packet, "tailer"),
                catch: (cause) => new ProjectionDeliveryError({ operation: "deliver-tail", cause }),
              }).pipe(Effect.asVoid),
            observeCheckpoint: (checkpoint) => coordinator.observeCheckpoint(checkpoint),
            releaseSender: (senderId) => audience.releaseSender(senderId),
            resetStream: (reason) => coordinator.resetStream(reason),
            subscribe: (sender, address) => audience.subscribe(sender, address),
          }),
          dispose: () => {
            supervisor?.stop();
            audience.dispose();
          },
        };
      }),
      ({ dispose }) => Effect.sync(dispose),
    ).pipe(Effect.map(({ service }) => service)),
  );
