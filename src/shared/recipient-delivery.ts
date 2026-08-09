import type { ProjectionScope, ProjectionStreamMessage } from "./projection-stream";
import type { ResourceRevocationMessage } from "./resource-revocation-stream";

export const RECIPIENT_DELIVERY_VERSION = 1 as const;

export type RecipientDeliveryLane = "projection" | "revocation";

export type RecipientDeliveryPayload =
  | {
      readonly lane: "projection";
      readonly message: ProjectionStreamMessage;
    }
  | {
      readonly lane: "revocation";
      readonly message: ResourceRevocationMessage;
    };

export interface RecipientDeliveryEnvelope {
  readonly version: typeof RECIPIENT_DELIVERY_VERSION;
  readonly deliveryId: string;
  readonly scope: ProjectionScope;
  readonly payload: RecipientDeliveryPayload;
}

export type RecipientAdmissionResult =
  | {
      readonly version: typeof RECIPIENT_DELIVERY_VERSION;
      readonly deliveryId: string;
      readonly outcome: "ack";
    }
  | {
      readonly version: typeof RECIPIENT_DELIVERY_VERSION;
      readonly deliveryId: string;
      readonly outcome: "nack";
      readonly reason: "capacity" | "causal_divergence" | "invalid_message";
    };
