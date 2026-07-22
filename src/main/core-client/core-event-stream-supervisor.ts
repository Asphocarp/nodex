import type {
  CoreEventEnvelope,
  CoreEventReplayRequired,
  CoreEventSubscription,
} from "./types";

export interface CoreEventStreamSupervisorInput {
  readonly initialAfter: number;
  readonly open: (
    after: number,
    onEvent: (event: CoreEventEnvelope) => void,
    onResyncRequired: (event: CoreEventReplayRequired) => void,
  ) => Promise<CoreEventSubscription>;
  readonly onEvent: (event: CoreEventEnvelope) => void;
  readonly onResyncRequired: (event: CoreEventReplayRequired) => void;
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
      try {
        const subscription = await input.open(
          after,
          (envelope) => {
            after = Math.max(after, envelope.event.sequence);
            input.onEvent(envelope);
          },
          (boundary) => {
            after = boundary.event_head;
            resyncRequested = true;
            input.onResyncRequired(boundary);
            active?.close();
          },
        );
        active = subscription;
        retryDelayMs = initialRetryDelayMs;
        if (closed || resyncRequested) subscription.close();
        await subscription.done;
      } catch (error) {
        interruption = error;
      } finally {
        active = null;
      }
      if (closed) return;
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
