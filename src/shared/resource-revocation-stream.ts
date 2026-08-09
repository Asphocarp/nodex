import type { components } from "@nodex/core-protocol";

import type { ProjectionCursor, ProjectionScope } from "./projection-stream";

export interface ResourceRevocationDelivery {
  readonly storeEpoch: string;
  readonly commitSeq: number;
  readonly manifestHash: string;
  readonly operationId: string;
  readonly committedAt: string;
  readonly revocation: components["schemas"]["ResourceRevocation"];
}

/** Immediate authorization-loss delivery. Durable progress remains on the projection stream. */
export interface ResourceRevocationDeliveryMessage {
  readonly version: 1;
  readonly kind: "revocation";
  readonly scope: ProjectionScope;
  readonly stream: ProjectionCursor;
  readonly delivery: ResourceRevocationDelivery;
}

/** Recipient-local transport loss requires a scope repair, not a guessed revoke. */
export interface ResourceRevocationResetMessage {
  readonly version: 1;
  readonly kind: "reset";
  readonly scope: ProjectionScope;
  readonly stream: ProjectionCursor;
  readonly reason:
    | "event_gap"
    | "reconnect"
    | "store_epoch_changed"
    | "recipient_delivery_failed";
}

export type ResourceRevocationMessage =
  | ResourceRevocationDeliveryMessage
  | ResourceRevocationResetMessage;
