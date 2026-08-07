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
export interface ResourceRevocationMessage {
  readonly version: 1;
  readonly kind: "revocation";
  readonly scope: ProjectionScope;
  readonly stream: ProjectionCursor;
  readonly delivery: ResourceRevocationDelivery;
}
