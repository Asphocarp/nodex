import { createCoreEventStreamSupervisor } from "../effect-control-plane/core-event-stream";
import type {
  CoreEventEnvelope,
  CoreEventReplayRequired,
  CoreEventSubscription,
  CoreStreamCheckpoint,
} from "./types";
import { CoreHttpError } from "./uds-http";

interface EventReplayBoundary {
  readonly commit_head: number;
}

export interface CoreEventStreamSupervisorInput<
  ResyncBoundary extends EventReplayBoundary = CoreEventReplayRequired,
> {
  readonly initialAfter: number;
  readonly open: (
    after: number,
    onEvent: (event: CoreEventEnvelope) => void,
    onCheckpoint: (checkpoint: CoreStreamCheckpoint) => void,
    onResyncRequired: (event: ResyncBoundary) => void,
    signal: AbortSignal,
  ) => Promise<CoreEventSubscription>;
  readonly onEvent: (event: CoreEventEnvelope) => unknown;
  readonly onCheckpoint?: (checkpoint: CoreStreamCheckpoint) => unknown;
  readonly onResyncRequired: (event: ResyncBoundary) => unknown;
  readonly onInterrupted?: (error: unknown) => void;
  readonly onConnectionStateChanged?: (state: "connected" | "disconnected") => void;
  readonly shouldRetry?: (error: unknown) => boolean;
  readonly maxInitialOpenAttempts?: number;
  readonly retryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
}

export interface SupervisedCoreEventSubscription extends CoreEventSubscription {
  /** Resolves only after the first physical stream is authenticated and open. */
  readonly ready: Promise<void>;
  /** Waits for the physical stream that currently backs the logical subscription. */
  waitUntilConnected(): Promise<void>;
  /** Invalidates a lost server-side lease and waits for a fresh physical stream. */
  reconnectAfterSubscriptionLoss(): Promise<void>;
}

export const isRetryableCoreEventStreamError = (error: unknown): boolean => {
  if (!(error instanceof CoreHttpError)) return true;
  return error.status === 409 || error.status === 429 || error.status >= 500;
};

export function superviseCoreEventStream<
  ResyncBoundary extends EventReplayBoundary = CoreEventReplayRequired,
>(input: CoreEventStreamSupervisorInput<ResyncBoundary>): SupervisedCoreEventSubscription {
  return createCoreEventStreamSupervisor(input);
}
