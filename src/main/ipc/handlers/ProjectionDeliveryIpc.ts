import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import type { DeliveryAddress, RecipientAdmissionResult } from "../../../shared/recipient-delivery";
import { MainConfig } from "../../app/MainConfig";
import { ProjectionDeliveryRuntime } from "../../core-runtime/ProjectionDeliveryRuntime";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

export class ProjectionDeliveryIpcError extends Schema.TaggedError<ProjectionDeliveryIpcError>()(
  "ProjectionDeliveryIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

interface SenderSubscriptions {
  readonly sender: WebContents;
  readonly releases: Map<string, () => void>;
  readonly onDestroyed: () => void;
}

export const live: Layer.Layer<
  never,
  never,
  ElectronIpc | MainConfig | ProjectionDeliveryRuntime | WindowRuntime
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* MainConfig;
    const delivery = yield* ProjectionDeliveryRuntime;
    const ipc = yield* ElectronIpc;
    const windows = yield* WindowRuntime;
    const senders = new Map<number, SenderSubscriptions>();

    const authorize = (event: IpcMainInvokeEvent) =>
      Effect.try({
        try: () => {
          requireTrustedAppRendererSender(event, "Local commit audience", config.rendererUrl);
          if (!windows.has(event.sender.id)) {
            throw new Error("Local commit audience sender is not an owned window");
          }
        },
        catch: (cause) =>
          new ProjectionDeliveryIpcError({ operation: "authorize-renderer", cause }),
      });
    const releaseSender = (senderId: number, clearRecipientRecovery: boolean): void => {
      const state = senders.get(senderId);
      if (!state) return;
      senders.delete(senderId);
      state.sender.removeListener("destroyed", state.onDestroyed);
      for (const release of state.releases.values()) release();
      state.releases.clear();
      if (clearRecipientRecovery) delivery.releaseSender(senderId);
    };
    const ensureSender = (sender: WebContents): SenderSubscriptions => {
      const existing = senders.get(sender.id);
      if (existing) return existing;
      const state: SenderSubscriptions = {
        sender,
        releases: new Map(),
        onDestroyed: () => releaseSender(sender.id, true),
      };
      senders.set(sender.id, state);
      sender.once("destroyed", state.onDestroyed);
      return state;
    };
    const unsubscribe = (senderId: number, address: DeliveryAddress): void => {
      const state = senders.get(senderId);
      if (!state) return;
      const key = JSON.stringify(address);
      state.releases.get(key)?.();
      state.releases.delete(key);
      if (state.releases.size === 0) releaseSender(senderId, false);
    };

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const senderId of [...senders.keys()]) releaseSender(senderId, true);
      }),
    );
    yield* ipc.handle("local-commit-audience:subscribe", (event, address: DeliveryAddress) =>
      authorize(event).pipe(
        Effect.andThen(
          Effect.try({
            try: () => {
              unsubscribe(event.sender.id, address);
              const state = ensureSender(event.sender);
              state.releases.set(
                JSON.stringify(address),
                delivery.subscribe(event.sender, address),
              );
            },
            catch: (cause) => new ProjectionDeliveryIpcError({ operation: "subscribe", cause }),
          }),
        ),
      ),
    );
    yield* ipc.handle("local-commit-audience:unsubscribe", (event, address: DeliveryAddress) =>
      authorize(event).pipe(
        Effect.andThen(Effect.sync(() => unsubscribe(event.sender.id, address))),
      ),
    );
    yield* ipc.handle("recipient-delivery:admit", (event, result: RecipientAdmissionResult) =>
      authorize(event).pipe(
        Effect.map(() => delivery.admitRecipientResult(event.sender.id, result)),
      ),
    );
  }),
);
