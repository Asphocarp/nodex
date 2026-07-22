import type {
  CoreEventEnvelope,
  CoreEventReplayRequired,
  CoreEventSubscription,
} from "./types";
import { CoreEventCompatibilityError } from "./uds-http";

export interface CoreEventStreamSupervisorInput {
  readonly initialAfter: number;
  readonly open: (
    after: number,
    onEvent: (event: CoreEventEnvelope) => void,
    onResyncRequired: (event: CoreEventReplayRequired) => void,
  ) => Promise<CoreEventSubscription>;
  readonly onEvent: (event: CoreEventEnvelope) => unknown;
  readonly onResyncRequired: (
    event: CoreEventReplayRequired,
  ) => unknown;
  readonly onInterrupted?: (error: unknown | null) => void;
  readonly retryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
}

const wait = async (milliseconds: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, milliseconds));

export function superviseCoreEventStream(
  input: CoreEventStreamSupervisorInput,
): CoreEventSubscription {
  let after = input.initialAfter;
  let closed = false;
  let active: CoreEventSubscription | null = null;
  const initialRetryDelayMs = input.retryDelayMs ?? 250;
  const maxRetryDelayMs = input.maxRetryDelayMs ?? 5_000;
  let retryDelayMs = initialRetryDelayMs;

  const done = (async () => {
    while (!closed) {
      let resyncRequested = false;
      let interruption: unknown | null = null;
      let delivery = Promise.resolve();
      let deliveryError: unknown | null = null;
      const enqueue = (work: () => void | Promise<void>): void => {
        delivery = delivery.then(async () => {
          if (deliveryError !== null) return;
          await work();
        }).catch((error) => {
          deliveryError ??= error;
          active?.close();
        });
      };
      try {
        const subscription = await input.open(
          after,
          (envelope) => {
            enqueue(async () => {
              await input.onEvent(envelope);
              after = Math.max(after, envelope.event.sequence);
            });
          },
          (boundary) => {
            resyncRequested = true;
            enqueue(async () => {
              await input.onResyncRequired(boundary);
              after = boundary.event_head;
            });
            active?.close();
          },
        );
        active = subscription;
        retryDelayMs = initialRetryDelayMs;
        if (closed || resyncRequested) subscription.close();
        await subscription.done;
        await delivery;
        if (deliveryError !== null) throw deliveryError;
      } catch (error) {
        interruption = error;
      } finally {
        active = null;
      }
      if (closed) return;
      if (interruption instanceof CoreEventCompatibilityError) {
        input.onInterrupted?.(interruption);
        throw interruption;
      }
      if (!resyncRequested) input.onInterrupted?.(interruption);
      if (!resyncRequested && retryDelayMs > 0) {
        await wait(retryDelayMs);
        retryDelayMs = Math.min(retryDelayMs * 2, maxRetryDelayMs);
      }
    }
  })();

  return {
    done,
    close: () => {
      if (closed) return;
      closed = true;
      active?.close();
    },
  };
}
