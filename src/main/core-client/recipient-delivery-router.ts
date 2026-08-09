import { createHash } from "node:crypto";

import {
  RECIPIENT_DELIVERY_VERSION,
  type RecipientAdmissionResult,
  type RecipientDeliveryEnvelope,
  type RecipientDeliveryLane,
} from "../../shared/recipient-delivery";
import {
  projectionScopeKey,
  type ProjectionCursor,
  type ProjectionScope,
  type ProjectionStreamMessage,
} from "../../shared/projection-stream";
import type {
  ResourceRevocationDeliveryMessage,
  ResourceRevocationMessage,
  ResourceRevocationResetMessage,
} from "../../shared/resource-revocation-stream";

interface RecipientSender {
  readonly id: number;
  isDestroyed(): boolean;
  isLoadingMainFrame?(): boolean;
  send(channel: string, ...args: unknown[]): void;
}

interface PendingAdmission {
  readonly deliveryId: string;
  readonly floor: ProjectionCursor;
  readonly reset: boolean;
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface RecipientState {
  readonly sender: RecipientSender;
  readonly scope: ProjectionScope;
  readonly lane: RecipientDeliveryLane;
  readonly pending: Map<string, PendingAdmission>;
  requiredFloor: ProjectionCursor | null;
  released: boolean;
}

export interface FanoutReport {
  readonly recipients: number;
  readonly sent: number;
  readonly fenced: number;
  readonly released: number;
}

export interface RecipientDeliveryRouterInput {
  readonly send: (
    sender: RecipientSender,
    channel: string,
    envelope: RecipientDeliveryEnvelope,
  ) => boolean;
  readonly ackTimeoutMs?: number;
  readonly maxPendingPerRecipient?: number;
}

const cursorMax = (left: ProjectionCursor | null, right: ProjectionCursor): ProjectionCursor => {
  if (!left || left.storeEpoch !== right.storeEpoch) return right;
  return left.commitSeq >= right.commitSeq ? left : right;
};

const digest = (parts: readonly string[]): string => createHash("sha256")
  .update(JSON.stringify(parts))
  .digest("hex");

const projectionDeliveryId = (message: ProjectionStreamMessage): string => {
  if (message.kind === "effect") {
    return digest([
      message.delivery.storeEpoch,
      message.delivery.manifestHash,
      "projection",
      projectionScopeKey(message.scope),
      message.delivery.effect.scope.canonical_key,
      String(message.delivery.effect.resultRevision),
    ]);
  }
  return digest([
    message.stream.storeEpoch,
    message.kind,
    projectionScopeKey(message.scope),
    String(message.stream.commitSeq),
    message.kind === "reset" ? message.reason : "checkpoint",
  ]);
};

const revocationDeliveryId = (message: ResourceRevocationDeliveryMessage): string => {
  const revocation = message.delivery.revocation;
  return digest([
    message.delivery.storeEpoch,
    message.delivery.manifestHash,
    "revocation",
    projectionScopeKey(message.scope),
    revocation.resource_kind,
    revocation.resource_id,
  ]);
};

const stateKey = (
  senderId: number,
  scope: ProjectionScope,
  lane: RecipientDeliveryLane,
): string => `${senderId}:${lane}:${projectionScopeKey(scope)}`;

/** Volatile recipient admission proof; business recovery remains snapshot/reset based. */
export class RecipientDeliveryRouter {
  readonly #send: RecipientDeliveryRouterInput["send"];
  readonly #ackTimeoutMs: number;
  readonly #maxPendingPerRecipient: number;
  readonly #states = new Map<string, RecipientState>();
  readonly #requiredFloors = new Map<string, ProjectionCursor>();
  readonly #deliveryOwners = new Map<string, RecipientState>();

  constructor(input: RecipientDeliveryRouterInput) {
    this.#send = input.send;
    this.#ackTimeoutMs = Math.max(50, Math.floor(input.ackTimeoutMs ?? 1_000));
    this.#maxPendingPerRecipient = Math.max(
      1,
      Math.floor(input.maxPendingPerRecipient ?? 128),
    );
  }

  register(
    sender: RecipientSender,
    scope: ProjectionScope,
    lane: RecipientDeliveryLane,
  ): {
    readonly publishProjection: (message: ProjectionStreamMessage) => FanoutReport;
    readonly publishRevocation: (message: ResourceRevocationMessage) => FanoutReport;
    readonly release: () => void;
  } {
    const key = stateKey(sender.id, scope, lane);
    this.#release(this.#states.get(key), true);
    const state: RecipientState = {
      sender,
      scope,
      lane,
      pending: new Map(),
      requiredFloor: this.#requiredFloors.get(key) ?? null,
      released: false,
    };
    this.#states.set(key, state);
    if (state.requiredFloor) this.#sendReset(state);
    return {
      publishProjection: (message) => this.#publishProjection(state, message),
      publishRevocation: (message) => this.#publishRevocation(state, message),
      release: () => {
        if (this.#states.get(key) === state) this.#states.delete(key);
        this.#release(state, true);
      },
    };
  }

  admit(senderId: number, value: unknown): boolean {
    if (
      typeof value !== "object"
      || value === null
      || !("version" in value)
      || value.version !== RECIPIENT_DELIVERY_VERSION
      || !("deliveryId" in value)
      || typeof value.deliveryId !== "string"
      || !/^[a-f0-9]{64}$/u.test(value.deliveryId)
      || !("outcome" in value)
      || (value.outcome !== "ack" && value.outcome !== "nack")
      || (
        value.outcome === "nack"
        && (
          !("reason" in value)
          || (
            value.reason !== "capacity"
            && value.reason !== "causal_divergence"
            && value.reason !== "invalid_message"
          )
        )
      )
    ) return false;
    const result = value as RecipientAdmissionResult;
    const ownerKey = `${senderId}:${result.deliveryId}`;
    const state = this.#deliveryOwners.get(ownerKey);
    if (!state || state.sender.id !== senderId || state.released) return false;
    const pending = state.pending.get(result.deliveryId);
    if (!pending) return false;
    this.#forgetPending(state, pending);
    if (result.outcome === "nack") {
      this.#fence(state, pending.floor);
      return true;
    }
    if (pending.reset) {
      const required = state.requiredFloor;
      if (
        required
        && required.storeEpoch === pending.floor.storeEpoch
        && required.commitSeq <= pending.floor.commitSeq
      ) {
        state.requiredFloor = null;
        this.#requiredFloors.delete(stateKey(
          state.sender.id,
          state.scope,
          state.lane,
        ));
      }
      if (state.requiredFloor) this.#sendReset(state);
    }
    return true;
  }

  releaseSender(senderId: number): void {
    for (const [key, state] of this.#states) {
      if (state.sender.id !== senderId) continue;
      this.#states.delete(key);
      this.#release(state, false);
    }
    for (const key of this.#requiredFloors.keys()) {
      if (key.startsWith(`${senderId}:`)) this.#requiredFloors.delete(key);
    }
  }

  dispose(): void {
    for (const state of this.#states.values()) this.#release(state, false);
    this.#states.clear();
    this.#requiredFloors.clear();
    this.#deliveryOwners.clear();
  }

  diagnostics(): {
    readonly recipients: number;
    readonly pendingAdmissions: number;
    readonly fencedRecipients: number;
  } {
    let pendingAdmissions = 0;
    let fencedRecipients = 0;
    for (const state of this.#states.values()) {
      pendingAdmissions += state.pending.size;
      if (state.requiredFloor) fencedRecipients += 1;
    }
    return { recipients: this.#states.size, pendingAdmissions, fencedRecipients };
  }

  #publishProjection(
    state: RecipientState,
    message: ProjectionStreamMessage,
  ): FanoutReport {
    if (state.lane !== "projection" || state.released) return this.#releasedReport();
    if (message.kind === "reset") {
      this.#fence(state, message.stream);
      const sent = this.#sendReset(state, message);
      return { recipients: 1, sent: sent ? 1 : 0, fenced: 1, released: 0 };
    }
    if (state.requiredFloor) {
      this.#fence(state, message.stream);
      this.#sendReset(state);
      return { recipients: 1, sent: 0, fenced: 1, released: 0 };
    }
    const sent = this.#sendEnvelope(state, {
      version: RECIPIENT_DELIVERY_VERSION,
      deliveryId: projectionDeliveryId(message),
      scope: state.scope,
      payload: { lane: "projection", message },
    }, message.stream, false);
    return { recipients: 1, sent: sent ? 1 : 0, fenced: sent ? 0 : 1, released: 0 };
  }

  #publishRevocation(
    state: RecipientState,
    message: ResourceRevocationMessage,
  ): FanoutReport {
    if (state.lane !== "revocation" || state.released) return this.#releasedReport();
    if (message.kind === "reset") {
      this.#fence(state, message.stream);
      const sent = this.#sendReset(state, undefined, message);
      return { recipients: 1, sent: sent ? 1 : 0, fenced: 1, released: 0 };
    }
    const floor = {
      storeEpoch: message.delivery.storeEpoch,
      commitSeq: message.delivery.commitSeq,
    };
    if (state.requiredFloor) {
      this.#fence(state, floor);
      this.#sendReset(state);
      return { recipients: 1, sent: 0, fenced: 1, released: 0 };
    }
    const sent = this.#sendEnvelope(state, {
      version: RECIPIENT_DELIVERY_VERSION,
      deliveryId: revocationDeliveryId(message),
      scope: state.scope,
      payload: { lane: "revocation", message },
    }, floor, false);
    return { recipients: 1, sent: sent ? 1 : 0, fenced: sent ? 0 : 1, released: 0 };
  }

  #sendReset(
    state: RecipientState,
    suppliedProjection?: ProjectionStreamMessage,
    suppliedRevocation?: ResourceRevocationResetMessage,
  ): boolean {
    const floor = state.requiredFloor;
    if (!floor || state.released) return false;
    if ([...state.pending.values()].some((pending) => pending.reset)) return true;
    const projectionReset: ProjectionStreamMessage = suppliedProjection?.kind === "reset"
      ? { ...suppliedProjection, stream: floor }
      : {
          version: 2,
          kind: "reset",
          scope: state.scope,
          stream: floor,
          reason: "event_gap",
        };
    const revocationReset: ResourceRevocationResetMessage = suppliedRevocation
      ? { ...suppliedRevocation, stream: floor }
      : {
          version: 1,
          kind: "reset",
          scope: state.scope,
          stream: floor,
          reason: "recipient_delivery_failed",
        };
    const payload = state.lane === "projection"
      ? { lane: "projection" as const, message: projectionReset }
      : { lane: "revocation" as const, message: revocationReset };
    return this.#sendEnvelope(state, {
      version: RECIPIENT_DELIVERY_VERSION,
      deliveryId: state.lane === "projection"
        ? projectionDeliveryId(projectionReset)
        : digest([
            floor.storeEpoch,
            "revocation_reset",
            projectionScopeKey(state.scope),
            String(floor.commitSeq),
            revocationReset.reason,
          ]),
      scope: state.scope,
      payload,
    }, floor, true);
  }

  #sendEnvelope(
    state: RecipientState,
    envelope: RecipientDeliveryEnvelope,
    floor: ProjectionCursor,
    reset: boolean,
  ): boolean {
    if (state.pending.has(envelope.deliveryId)) return true;
    if (
      state.released
      || state.sender.isDestroyed()
      || state.sender.isLoadingMainFrame?.()
    ) {
      this.#fence(state, floor);
      return false;
    }
    if (state.pending.size >= this.#maxPendingPerRecipient) {
      for (const pending of state.pending.values()) {
        this.#fence(state, pending.floor);
      }
      this.#clearPending(state);
      this.#fence(state, floor);
      return false;
    }
    let sent = false;
    try {
      sent = this.#send(state.sender, "recipient-delivery:message", envelope);
    } catch {
      sent = false;
    }
    if (!sent) {
      this.#fence(state, floor);
      return false;
    }
    const timeout = setTimeout(() => {
      const pending = state.pending.get(envelope.deliveryId);
      if (!pending) return;
      this.#forgetPending(state, pending);
      this.#fence(state, pending.floor);
    }, this.#ackTimeoutMs);
    timeout.unref?.();
    const pending = { deliveryId: envelope.deliveryId, floor, reset, timeout };
    state.pending.set(envelope.deliveryId, pending);
    this.#deliveryOwners.set(`${state.sender.id}:${envelope.deliveryId}`, state);
    return true;
  }

  #fence(state: RecipientState, floor: ProjectionCursor): void {
    state.requiredFloor = cursorMax(state.requiredFloor, floor);
    this.#requiredFloors.set(
      stateKey(state.sender.id, state.scope, state.lane),
      state.requiredFloor,
    );
  }

  #forgetPending(state: RecipientState, pending: PendingAdmission): void {
    clearTimeout(pending.timeout);
    state.pending.delete(pending.deliveryId);
    const ownerKey = `${state.sender.id}:${pending.deliveryId}`;
    if (this.#deliveryOwners.get(ownerKey) === state) {
      this.#deliveryOwners.delete(ownerKey);
    }
  }

  #clearPending(state: RecipientState): void {
    for (const pending of state.pending.values()) this.#forgetPending(state, pending);
  }

  #release(
    state: RecipientState | undefined,
    preserveRecovery: boolean,
  ): void {
    if (!state || state.released) return;
    state.released = true;
    if (preserveRecovery) {
      for (const pending of state.pending.values()) {
        this.#fence(state, pending.floor);
      }
    }
    this.#clearPending(state);
  }

  #releasedReport(): FanoutReport {
    return { recipients: 1, sent: 0, fenced: 0, released: 1 };
  }
}
