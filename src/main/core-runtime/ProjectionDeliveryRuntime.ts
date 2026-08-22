import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { WebContents } from "electron";
import type { DeliveryAddress, RecipientAdmissionResult } from "../../shared/recipient-delivery";
import { projectionScopeDeliveryAddress } from "../../shared/recipient-delivery";
import { revocationsFromVisibilityDelta } from "../../shared/local-commit-delivery";
import { LocalCommitCoordinator } from "../core-client/local-commit-coordinator";
import type {
  CoreAuthorizedDeliveryAtom,
  CoreEventEnvelope,
  CoreStreamCheckpoint,
  DesktopDataAuthorityRuntime,
  DesktopDocumentSyncPort,
} from "../core-client";
import { safeSendToWebContents } from "../ipc-safe-send";
import { getLogger } from "../logging/logger";
import {
  make as makeProjectionAudienceRuntime,
  ProjectionAudienceRuntimeError,
  type ProjectionAudienceSubscription,
} from "./ProjectionAudienceRuntime";
import {
  make as makeProjectionLiveRuntime,
  ProjectionLiveRuntimeError,
} from "./ProjectionLiveRuntime";

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
    readonly admitRecipientResult: (
      senderId: number,
      result: RecipientAdmissionResult,
    ) => Effect.Effect<boolean>;
    readonly deliverTail: (
      envelope: CoreEventEnvelope,
    ) => Effect.Effect<void, ProjectionDeliveryError>;
    readonly observeCheckpoint: (checkpoint: CoreStreamCheckpoint) => void;
    readonly releaseSender: (senderId: number) => Effect.Effect<void>;
    readonly resetStream: (reason: "event_gap" | "reconnect" | "store_epoch_changed") => void;
    readonly subscribe: (
      sender: WebContents,
      address: DeliveryAddress,
    ) => Effect.Effect<ProjectionAudienceSubscription, ProjectionAudienceRuntimeError>;
  }
>()("nodex/main/core-runtime/ProjectionDeliveryRuntime") {}

export const live = (
  options: ProjectionDeliveryRuntimeOptions,
): Layer.Layer<ProjectionDeliveryRuntime> =>
  Layer.effect(
    ProjectionDeliveryRuntime,
    Effect.gen(function* () {
      const logger = getLogger({ component: "projection-delivery-runtime" });
      const coreClient = options.authority.rootClient;
      const coreIdentity = options.authority.identity;
      const runAudienceEffect = yield* FiberSet.makeRuntime<never, void, never>();
      const audience = yield* makeProjectionAudienceRuntime({
        libraryId: coreIdentity.libraryId,
        send: (sender, channel, envelope) => safeSendToWebContents(sender, channel, [envelope]),
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
          void runAudienceEffect(
            audience.reset(
              {
                storeEpoch: failure.packet.manifest.identity.store_epoch,
                commitSeq: failure.packet.manifest.identity.commit_seq,
              },
              "integrity_failure",
              [failure.packet.delivery_address],
            ),
          );
        },
      });

      const projectionLive = yield* makeProjectionLiveRuntime({
        open: (scopes, onEvent, onRepair) =>
          Effect.tryPromise({
            try: (signal) =>
              coreClient.openProjectionEventStream(scopes, onEvent, onRepair, signal),
            catch: (cause) => new ProjectionLiveRuntimeError({ operation: "stream.open", cause }),
          }).pipe(
            Effect.map((subscription) => ({
              barrier: subscription.barrier,
              close: Effect.sync(() => subscription.close()),
              done: Effect.tryPromise({
                try: () => subscription.done,
                catch: (cause) =>
                  new ProjectionLiveRuntimeError({ operation: "stream.done", cause }),
              }),
            })),
          ),
        onPacket: (envelope) =>
          Effect.try({
            try: () => coordinator.admit(envelope.packet, "projection_live"),
            catch: (cause) =>
              new ProjectionLiveRuntimeError({ operation: "stream.deliver", cause }),
          }).pipe(Effect.andThen(audience.publish(envelope.packet)), Effect.asVoid),
        onBarrier: (barrier, scopes, resetScopes) =>
          audience
            .installLeases(
              barrier.recipient_leases,
              {
                storeEpoch: barrier.store_epoch,
                commitSeq: barrier.commit_head,
              },
              (barrier.store_epoch !== coreIdentity.storeEpoch ? scopes : resetScopes).map(
                projectionScopeDeliveryAddress,
              ),
              barrier.store_epoch !== coreIdentity.storeEpoch
                ? "store_epoch_replacement"
                : "stream_gap",
            )
            .pipe(
              Effect.mapError(
                (cause) =>
                  new ProjectionLiveRuntimeError({
                    operation: "stream.install-barrier",
                    cause,
                  }),
              ),
            ),
        onRepair: (repair) =>
          audience.reset(
            {
              storeEpoch: repair.store_epoch,
              commitSeq: repair.commit_head,
            },
            repair.reason === "identity_changed" ? "store_epoch_replacement" : "stream_gap",
          ),
      });
      yield* Effect.forkScoped(
        audience.scopes.pipe(
          Stream.runForEach((scopes) => projectionLive.setScopes(scopes)),
          Effect.catch((error) =>
            Effect.logWarning("Could not update Projection live scopes").pipe(
              Effect.annotateLogs({
                operation: error.operation,
                error: error.cause instanceof Error ? error.cause.message : String(error.cause),
              }),
            ),
          ),
        ),
      );

      return ProjectionDeliveryRuntime.of({
        admitRecipientResult: audience.admit,
        deliverTail: (envelope) =>
          Effect.tryPromise({
            try: () => coordinator.admitAndWait(envelope.packet, "tailer"),
            catch: (cause) => new ProjectionDeliveryError({ operation: "deliver-tail", cause }),
          }).pipe(Effect.asVoid),
        observeCheckpoint: (checkpoint) => coordinator.observeCheckpoint(checkpoint),
        releaseSender: audience.releaseSender,
        resetStream: (reason) => coordinator.resetStream(reason),
        subscribe: audience.subscribe,
      });
    }),
  );
