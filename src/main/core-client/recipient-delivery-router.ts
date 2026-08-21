import { createHash } from "node:crypto";

import type { AuthorizedDeliveryPacket } from "../../shared/authorized-delivery-packet";
import {
  RECIPIENT_DELIVERY_VERSION,
  type AddressReset,
  type AddressResetReason,
  type AuthorizedRecipientLease,
  type DeliveryAddress,
  type DeliveryAuthorizationScope,
  type RecipientAdmissionResult,
  type RecipientDeliveryEnvelope,
} from "../../shared/recipient-delivery";

interface RecipientSender {
  readonly id: number;
  isDestroyed(): boolean;
  isLoadingMainFrame?(): boolean;
  send(channel: string, ...args: unknown[]): void;
}

interface DeliveryFloor {
  readonly storeEpoch: string;
  readonly commitSeq: number;
}

interface PendingAdmission {
  readonly deliveryId: string;
  readonly floor: DeliveryFloor;
  readonly reset: boolean;
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface RecipientState {
  readonly sender: RecipientSender;
  readonly lease: AuthorizedRecipientLease;
  readonly pending: Map<string, PendingAdmission>;
  requiredFloor: DeliveryFloor | null;
  resetReason: AddressResetReason;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryAttempt: number;
  retryWindowStartedAt: number;
  retryWindowAttempts: number;
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
  readonly retryBaseMs?: number;
  readonly retryMaxMs?: number;
  readonly random?: () => number;
}

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const RESET_RETRY_WINDOW_MS = 10 * 60_000;
const RESET_RETRY_WINDOW_LIMIT = 20;

const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const identityKey = (value: DeliveryAddress | DeliveryAuthorizationScope): string =>
  JSON.stringify(value);

const stateKey = (senderId: number, address: DeliveryAddress): string =>
  `${senderId}:${identityKey(address)}`;

const floorMax = (left: DeliveryFloor | null, right: DeliveryFloor): DeliveryFloor => {
  if (!left || left.storeEpoch !== right.storeEpoch) return right;
  return left.commitSeq >= right.commitSeq ? left : right;
};

const packetFloor = (packet: AuthorizedDeliveryPacket): DeliveryFloor => ({
  storeEpoch: packet.manifest.identity.store_epoch,
  commitSeq: packet.manifest.identity.commit_seq,
});

const packetDeliveryId = (
  lease: AuthorizedRecipientLease,
  packet: AuthorizedDeliveryPacket,
): string =>
  digest([
    "recipient-packet-v2",
    lease.lease_id,
    lease.delivery_address,
    lease.authorization_scope,
    packet.manifest.identity.store_epoch,
    packet.manifest.identity.manifest_hash,
    packet.packet_hash,
  ]);

const validLease = (lease: AuthorizedRecipientLease): boolean =>
  HASH_PATTERN.test(lease.lease_id) &&
  identityKey(lease.delivery_address) === identityKey(lease.authorization_scope);

const validPacketForLease = (
  lease: AuthorizedRecipientLease,
  packet: AuthorizedDeliveryPacket,
): boolean =>
  packet.packet_version === 4 &&
  identityKey(packet.delivery_address) === identityKey(lease.delivery_address) &&
  identityKey(packet.authorization_scope) === identityKey(lease.authorization_scope);

/**
 * Owns volatile renderer admission for one sender/address pair. Every failure
 * actively retries a Core-lease-bound AddressReset; no renderer is allowed to
 * infer continuity from a missing message or a best-effort reset.
 */
export class RecipientDeliveryRouter {
  readonly #send: RecipientDeliveryRouterInput["send"];
  readonly #ackTimeoutMs: number;
  readonly #maxPendingPerRecipient: number;
  readonly #retryBaseMs: number;
  readonly #retryMaxMs: number;
  readonly #random: () => number;
  readonly #states = new Map<string, RecipientState>();
  readonly #requiredFloors = new Map<string, DeliveryFloor>();
  readonly #deliveryOwners = new Map<string, RecipientState>();

  constructor(input: RecipientDeliveryRouterInput) {
    this.#send = input.send;
    this.#ackTimeoutMs = Math.max(50, Math.floor(input.ackTimeoutMs ?? 1_000));
    this.#maxPendingPerRecipient = Math.max(1, Math.floor(input.maxPendingPerRecipient ?? 128));
    this.#retryBaseMs = Math.max(1, Math.floor(input.retryBaseMs ?? 100));
    this.#retryMaxMs = Math.max(this.#retryBaseMs, Math.floor(input.retryMaxMs ?? 60_000));
    this.#random = input.random ?? Math.random;
  }

  register(
    sender: RecipientSender,
    lease: AuthorizedRecipientLease,
  ): {
    readonly publish: (packet: AuthorizedDeliveryPacket) => FanoutReport;
    readonly reset: (floor: DeliveryFloor, reason: AddressResetReason) => FanoutReport;
    readonly release: () => void;
  } {
    if (!validLease(lease)) {
      throw new TypeError("Core recipient lease is invalid");
    }
    const key = stateKey(sender.id, lease.delivery_address);
    this.#release(this.#states.get(key), true);
    const state: RecipientState = {
      sender,
      lease,
      pending: new Map(),
      requiredFloor: this.#requiredFloors.get(key) ?? null,
      resetReason: "stream_gap",
      retryTimer: null,
      retryAttempt: 0,
      retryWindowStartedAt: Date.now(),
      retryWindowAttempts: 0,
      released: false,
    };
    this.#states.set(key, state);
    if (state.requiredFloor) this.#sendReset(state);
    return {
      publish: (packet) => this.#publish(state, packet),
      reset: (floor, reason) => this.#reset(state, floor, reason),
      release: () => {
        if (this.#states.get(key) === state) this.#states.delete(key);
        this.#release(state, true);
      },
    };
  }

  admit(senderId: number, value: unknown): boolean {
    if (!this.#isAdmission(value)) return false;
    const result = value;
    const state = this.#deliveryOwners.get(`${senderId}:${result.deliveryId}`);
    if (!state || state.released || state.sender.id !== senderId) return false;
    const pending = state.pending.get(result.deliveryId);
    if (!pending) return false;
    this.#forgetPending(state, pending);
    if (result.outcome === "nack") {
      this.#fence(state, pending.floor, "recipient_nack");
      this.#sendReset(state);
      return true;
    }
    if (!pending.reset) return true;
    const required = state.requiredFloor;
    if (
      required &&
      required.storeEpoch === pending.floor.storeEpoch &&
      required.commitSeq <= pending.floor.commitSeq
    ) {
      state.requiredFloor = null;
      state.retryAttempt = 0;
      state.retryWindowStartedAt = Date.now();
      state.retryWindowAttempts = 0;
      this.#requiredFloors.delete(stateKey(state.sender.id, state.lease.delivery_address));
      this.#clearRetry(state);
    }
    if (state.requiredFloor) this.#sendReset(state);
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
    readonly scheduledResetRetries: number;
  } {
    let pendingAdmissions = 0;
    let fencedRecipients = 0;
    let scheduledResetRetries = 0;
    for (const state of this.#states.values()) {
      pendingAdmissions += state.pending.size;
      if (state.requiredFloor) fencedRecipients += 1;
      if (state.retryTimer) scheduledResetRetries += 1;
    }
    return {
      recipients: this.#states.size,
      pendingAdmissions,
      fencedRecipients,
      scheduledResetRetries,
    };
  }

  #publish(state: RecipientState, packet: AuthorizedDeliveryPacket): FanoutReport {
    if (state.released) return this.#releasedReport();
    if (!validPacketForLease(state.lease, packet)) {
      this.#fence(state, packetFloor(packet), "integrity_failure");
      this.#sendReset(state);
      return { recipients: 1, sent: 0, fenced: 1, released: 0 };
    }
    const floor = packetFloor(packet);
    if (state.requiredFloor) {
      this.#fence(state, floor, state.resetReason);
      this.#sendReset(state);
      return { recipients: 1, sent: 0, fenced: 1, released: 0 };
    }
    const envelope: RecipientDeliveryEnvelope = {
      version: RECIPIENT_DELIVERY_VERSION,
      deliveryId: packetDeliveryId(state.lease, packet),
      recipientLeaseId: state.lease.lease_id,
      deliveryAddress: state.lease.delivery_address,
      authorizationScope: state.lease.authorization_scope,
      payload: { kind: "packet", packet },
    };
    const sent = this.#sendEnvelope(state, envelope, floor, false);
    if (!sent) this.#sendReset(state);
    return {
      recipients: 1,
      sent: sent ? 1 : 0,
      fenced: sent ? 0 : 1,
      released: 0,
    };
  }

  #reset(state: RecipientState, floor: DeliveryFloor, reason: AddressResetReason): FanoutReport {
    if (state.released) return this.#releasedReport();
    this.#fence(state, floor, reason);
    const sent = this.#sendReset(state);
    return { recipients: 1, sent: sent ? 1 : 0, fenced: 1, released: 0 };
  }

  #sendReset(state: RecipientState): boolean {
    if (!state.requiredFloor || state.released) return false;
    if ([...state.pending.values()].some((pending) => pending.reset)) return true;
    const retryBudgetDelay = this.#claimResetAttempt(state);
    if (retryBudgetDelay > 0) {
      this.#scheduleReset(state, retryBudgetDelay);
      return false;
    }
    for (const pending of [...state.pending.values()]) {
      this.#fence(state, pending.floor, state.resetReason);
      this.#forgetPending(state, pending);
    }
    const floor = state.requiredFloor;
    if (!floor) return false;
    this.#clearRetry(state);
    const reset: AddressReset = {
      reset_id: digest([
        "address-reset-v1",
        state.lease.lease_id,
        state.lease.delivery_address,
        state.lease.authorization_scope,
        floor.storeEpoch,
        floor.commitSeq,
        state.resetReason,
      ]),
      store_epoch: floor.storeEpoch,
      recipient_lease_id: state.lease.lease_id,
      delivery_address: state.lease.delivery_address,
      authorization_scope: state.lease.authorization_scope,
      required_commit_seq: floor.commitSeq,
      reason: state.resetReason,
    };
    const envelope: RecipientDeliveryEnvelope = {
      version: RECIPIENT_DELIVERY_VERSION,
      deliveryId: reset.reset_id,
      recipientLeaseId: state.lease.lease_id,
      deliveryAddress: state.lease.delivery_address,
      authorizationScope: state.lease.authorization_scope,
      payload: { kind: "reset", reset },
    };
    const sent = this.#sendEnvelope(state, envelope, floor, true);
    if (!sent) this.#scheduleReset(state);
    return sent;
  }

  #sendEnvelope(
    state: RecipientState,
    envelope: RecipientDeliveryEnvelope,
    floor: DeliveryFloor,
    reset: boolean,
  ): boolean {
    if (state.pending.has(envelope.deliveryId)) return true;
    if (state.released || state.sender.isDestroyed() || state.sender.isLoadingMainFrame?.()) {
      this.#fence(state, floor, reset ? state.resetReason : "stream_gap");
      return false;
    }
    if (state.pending.size >= this.#maxPendingPerRecipient) {
      for (const pending of state.pending.values()) {
        this.#fence(state, pending.floor, "queue_overflow");
      }
      this.#clearPending(state);
      this.#fence(state, floor, "queue_overflow");
      if (!reset) this.#sendReset(state);
      return false;
    }
    let sent = false;
    try {
      sent = this.#send(state.sender, "recipient-delivery:message", envelope);
    } catch {
      sent = false;
    }
    if (!sent) {
      this.#fence(state, floor, reset ? state.resetReason : "stream_gap");
      return false;
    }
    const timeout = setTimeout(() => {
      const pending = state.pending.get(envelope.deliveryId);
      if (!pending) return;
      this.#forgetPending(state, pending);
      this.#fence(state, pending.floor, "ack_timeout");
      this.#sendReset(state);
    }, this.#ackTimeoutMs);
    timeout.unref?.();
    const pending = { deliveryId: envelope.deliveryId, floor, reset, timeout };
    state.pending.set(envelope.deliveryId, pending);
    this.#deliveryOwners.set(`${state.sender.id}:${envelope.deliveryId}`, state);
    return true;
  }

  #fence(state: RecipientState, floor: DeliveryFloor, reason: AddressResetReason): void {
    state.requiredFloor = floorMax(state.requiredFloor, floor);
    state.resetReason = reason;
    this.#requiredFloors.set(
      stateKey(state.sender.id, state.lease.delivery_address),
      state.requiredFloor,
    );
  }

  #claimResetAttempt(state: RecipientState): number {
    const now = Date.now();
    const windowEndsAt = state.retryWindowStartedAt + RESET_RETRY_WINDOW_MS;
    if (now > windowEndsAt) {
      state.retryWindowStartedAt = now;
      state.retryWindowAttempts = 0;
    }
    if (state.retryWindowAttempts < RESET_RETRY_WINDOW_LIMIT) {
      state.retryWindowAttempts += 1;
      return 0;
    }
    return Math.max(1, windowEndsAt - now + 1);
  }

  #scheduleReset(state: RecipientState, requiredDelayMs?: number): void {
    if (state.released || state.retryTimer || !state.requiredFloor) return;
    const cap = Math.min(
      this.#retryMaxMs,
      this.#retryBaseMs * 2 ** Math.min(state.retryAttempt, 16),
    );
    const delay = requiredDelayMs ?? Math.max(1, Math.floor(cap * this.#random()));
    if (requiredDelayMs === undefined) state.retryAttempt += 1;
    state.retryTimer = setTimeout(() => {
      state.retryTimer = null;
      if (state.released || !state.requiredFloor) return;
      this.#sendReset(state);
    }, delay);
    state.retryTimer.unref?.();
  }

  #clearRetry(state: RecipientState): void {
    if (!state.retryTimer) return;
    clearTimeout(state.retryTimer);
    state.retryTimer = null;
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
    for (const pending of [...state.pending.values()]) {
      this.#forgetPending(state, pending);
    }
  }

  #release(state: RecipientState | undefined, preserveRecovery: boolean): void {
    if (!state || state.released) return;
    state.released = true;
    this.#clearRetry(state);
    if (preserveRecovery) {
      for (const pending of state.pending.values()) {
        this.#fence(state, pending.floor, "stream_gap");
      }
    }
    this.#clearPending(state);
  }

  #isAdmission(value: unknown): value is RecipientAdmissionResult {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as Partial<RecipientAdmissionResult>;
    if (
      candidate.version !== RECIPIENT_DELIVERY_VERSION ||
      typeof candidate.deliveryId !== "string" ||
      !HASH_PATTERN.test(candidate.deliveryId) ||
      (candidate.outcome !== "ack" && candidate.outcome !== "nack")
    )
      return false;
    if (candidate.outcome === "ack") return true;
    const reason = "reason" in candidate ? candidate.reason : undefined;
    return reason === "capacity" || reason === "causal_divergence" || reason === "invalid_message";
  }

  #releasedReport(): FanoutReport {
    return { recipients: 1, sent: 0, fenced: 0, released: 1 };
  }
}
