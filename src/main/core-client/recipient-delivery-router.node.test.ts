import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  AuthorizedRecipientLease,
  RecipientDeliveryEnvelope,
} from "../../shared/recipient-delivery";
import { createCoreLocalCommitFixture } from "./testing/local-commit-fixture";
import { RecipientDeliveryRouter } from "./recipient-delivery-router";

const address = {
  kind: "project" as const,
  library_id: "library-1",
  project_id: "project-1",
};

const lease: AuthorizedRecipientLease = {
  lease_id: "a".repeat(64),
  delivery_address: address,
  authorization_scope: address,
};

const packet = (commitSeq: number) =>
  createCoreLocalCommitFixture({
    commitSeq,
    authorizationScope: address,
  });

const sender = (id = 1) => ({
  id,
  destroyed: false,
  loading: false,
  isDestroyed() {
    return this.destroyed;
  },
  isLoadingMainFrame() {
    return this.loading;
  },
  send: vi.fn(),
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RecipientDeliveryRouter", () => {
  test("tracks a complete packet until the exact renderer ACK", () => {
    const target = sender();
    const sent: RecipientDeliveryEnvelope[] = [];
    const router = new RecipientDeliveryRouter({
      send: (_sender, _channel, envelope) => {
        sent.push(envelope);
        return true;
      },
    });
    const recipient = router.register(target, lease);

    expect(recipient.publish(packet(3))).toEqual({
      recipients: 1,
      sent: 1,
      fenced: 0,
      released: 0,
    });
    expect(sent[0]?.payload).toMatchObject({
      kind: "packet",
      packet: { manifest: { identity: { commit_seq: 3 } } },
    });
    expect(
      router.admit(target.id, {
        version: 2,
        deliveryId: sent[0]!.deliveryId,
        outcome: "ack",
      }),
    ).toBe(true);
    expect(router.diagnostics()).toMatchObject({
      pendingAdmissions: 0,
      fencedRecipients: 0,
    });
  });

  test("actively retries a lease-bound reset after send failure", async () => {
    vi.useFakeTimers();
    const target = sender();
    const sent: RecipientDeliveryEnvelope[] = [];
    let available = false;
    const router = new RecipientDeliveryRouter({
      retryBaseMs: 10,
      retryMaxMs: 10,
      random: () => 1,
      send: (_sender, _channel, envelope) => {
        if (!available) return false;
        sent.push(envelope);
        return true;
      },
    });
    const recipient = router.register(target, lease);

    expect(recipient.publish(packet(4)).fenced).toBe(1);
    expect(router.diagnostics()).toMatchObject({
      fencedRecipients: 1,
      scheduledResetRetries: 1,
    });
    available = true;
    await vi.advanceTimersByTimeAsync(10);

    expect(sent.at(-1)?.payload).toMatchObject({
      kind: "reset",
      reset: {
        recipient_lease_id: lease.lease_id,
        required_commit_seq: 4,
        reason: "stream_gap",
      },
    });
  });

  test("turns NACK and ACK timeout into an address reset", async () => {
    vi.useFakeTimers();
    const target = sender();
    const sent: RecipientDeliveryEnvelope[] = [];
    const router = new RecipientDeliveryRouter({
      ackTimeoutMs: 50,
      send: (_sender, _channel, envelope) => {
        sent.push(envelope);
        return true;
      },
    });
    const recipient = router.register(target, lease);
    recipient.publish(packet(5));
    const deliveryId = sent[0]!.deliveryId;

    expect(
      router.admit(target.id, {
        version: 2,
        deliveryId,
        outcome: "nack",
        reason: "capacity",
      }),
    ).toBe(true);
    expect(sent.at(-1)?.payload).toMatchObject({
      kind: "reset",
      reset: { reason: "recipient_nack", required_commit_seq: 5 },
    });

    const resetId = sent.at(-1)!.deliveryId;
    expect(
      router.admit(target.id, {
        version: 2,
        deliveryId: resetId,
        outcome: "ack",
      }),
    ).toBe(true);
    recipient.publish(packet(6));
    await vi.advanceTimersByTimeAsync(50);
    expect(sent.at(-1)?.payload).toMatchObject({
      kind: "reset",
      reset: { reason: "ack_timeout", required_commit_seq: 6 },
    });
  });

  test("bounds pending packets and repairs queue overflow with one reset", () => {
    const target = sender();
    const sent: RecipientDeliveryEnvelope[] = [];
    const router = new RecipientDeliveryRouter({
      maxPendingPerRecipient: 1,
      send: (_sender, _channel, envelope) => {
        sent.push(envelope);
        return true;
      },
    });
    const recipient = router.register(target, lease);
    recipient.publish(packet(7));
    expect(recipient.publish(packet(8)).fenced).toBe(1);

    expect(router.diagnostics().pendingAdmissions).toBeLessThanOrEqual(1);
    expect(sent.at(-1)?.payload).toMatchObject({
      kind: "reset",
      reset: { reason: "queue_overflow", required_commit_seq: 8 },
    });
  });

  test("releases timers and rejects a destroyed renderer's late ACK", () => {
    const target = sender();
    const sent: RecipientDeliveryEnvelope[] = [];
    const router = new RecipientDeliveryRouter({
      send: (_sender, _channel, envelope) => {
        sent.push(envelope);
        return true;
      },
    });
    const recipient = router.register(target, lease);
    recipient.publish(packet(9));
    router.releaseSender(target.id);

    expect(
      router.admit(target.id, {
        version: 2,
        deliveryId: sent[0]!.deliveryId,
        outcome: "ack",
      }),
    ).toBe(false);
    expect(router.diagnostics()).toEqual({
      recipients: 0,
      pendingAdmissions: 0,
      fencedRecipients: 0,
      scheduledResetRetries: 0,
    });
  });

  test("bounds quiet reset retries over ten minutes and disposes the timer", async () => {
    vi.useFakeTimers();
    const target = sender();
    let resetAttempts = 0;
    const router = new RecipientDeliveryRouter({
      random: () => 0,
      send: (_sender, _channel, envelope) => {
        if (envelope.payload.kind === "reset") resetAttempts += 1;
        return false;
      },
    });
    const recipient = router.register(target, lease);

    recipient.publish(packet(10));
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(resetAttempts).toBeLessThanOrEqual(20);
    expect(router.diagnostics().scheduledResetRetries).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(resetAttempts).toBe(21);
    router.dispose();
    expect(router.diagnostics()).toEqual({
      recipients: 0,
      pendingAdmissions: 0,
      fencedRecipients: 0,
      scheduledResetRetries: 0,
    });
    const attemptsAtDispose = resetAttempts;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(resetAttempts).toBe(attemptsAtDispose);
  });
});
