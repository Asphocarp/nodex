import { afterEach, describe, expect, test, vi } from "vitest";

import type { RecipientDeliveryEnvelope } from "../../shared/recipient-delivery";
import type { ProjectionStreamMessage } from "../../shared/projection-stream";
import type { ResourceRevocationDeliveryMessage } from "../../shared/resource-revocation-stream";
import { RecipientDeliveryRouter } from "./recipient-delivery-router";

const scope = {
  kind: "project" as const,
  libraryId: "library-1",
  projectId: "project-1",
};

const checkpoint = (commitSeq: number): ProjectionStreamMessage => ({
  version: 2,
  kind: "checkpoint",
  scope,
  stream: { storeEpoch: "epoch-1", commitSeq },
});

const revocation = (commitSeq: number): ResourceRevocationDeliveryMessage => ({
  version: 1,
  kind: "revocation",
  scope,
  stream: { storeEpoch: "epoch-1", commitSeq },
  delivery: {
    storeEpoch: "epoch-1",
    commitSeq,
    manifestHash: "a".repeat(64),
    operationId: `operation-${commitSeq}`,
    committedAt: "2026-08-09T00:00:00Z",
    revocation: {
      authorization_scope: {
        kind: "project",
        library_id: "library-1",
        project_id: "project-1",
      },
      resource_kind: "page",
      resource_id: "page-1",
      reason: "access_revoked",
    },
  },
});

const sender = (id = 1) => ({
  id,
  destroyed: false,
  loading: false,
  isDestroyed() { return this.destroyed; },
  isLoadingMainFrame() { return this.loading; },
  send: vi.fn(),
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RecipientDeliveryRouter", () => {
  test("tracks an admission until the exact renderer ACK", () => {
    const target = sender();
    const sent: RecipientDeliveryEnvelope[] = [];
    const router = new RecipientDeliveryRouter({
      send: (_sender, _channel, envelope) => {
        sent.push(envelope);
        return true;
      },
    });
    const recipient = router.register(target, scope, "projection");

    expect(recipient.publishProjection(checkpoint(3))).toEqual({
      recipients: 1,
      sent: 1,
      fenced: 0,
      released: 0,
    });
    expect(router.diagnostics().pendingAdmissions).toBe(1);
    expect(router.admit(target.id, {
      version: 1,
      deliveryId: sent[0]!.deliveryId,
      outcome: "ack",
    })).toBe(true);
    expect(router.diagnostics()).toMatchObject({
      pendingAdmissions: 0,
      fencedRecipients: 0,
    });
  });

  test("turns send failure into a reset fence without blocking another recipient", () => {
    const failed = sender(1);
    const healthy = sender(2);
    const sent: Array<{ senderId: number; envelope: RecipientDeliveryEnvelope }> = [];
    let failFirst = true;
    const router = new RecipientDeliveryRouter({
      send: (target, _channel, envelope) => {
        if (target.id === failed.id && failFirst) {
          failFirst = false;
          return false;
        }
        sent.push({ senderId: target.id, envelope });
        return true;
      },
    });
    const failedRecipient = router.register(failed, scope, "projection");
    const healthyRecipient = router.register(healthy, scope, "projection");

    expect(failedRecipient.publishProjection(checkpoint(4)).fenced).toBe(1);
    expect(healthyRecipient.publishProjection(checkpoint(4)).sent).toBe(1);
    failedRecipient.publishProjection(checkpoint(5));

    const reset = sent.find(({ senderId }) => senderId === failed.id)?.envelope;
    expect(reset?.payload).toMatchObject({
      lane: "projection",
      message: { kind: "reset", stream: { commitSeq: 5 } },
    });
    expect(router.diagnostics().fencedRecipients).toBe(1);
  });

  test("ACK timeout and queue pressure require bounded reset repair", async () => {
    vi.useFakeTimers();
    const target = sender();
    const sent: RecipientDeliveryEnvelope[] = [];
    const router = new RecipientDeliveryRouter({
      ackTimeoutMs: 50,
      maxPendingPerRecipient: 1,
      send: (_sender, _channel, envelope) => {
        sent.push(envelope);
        return true;
      },
    });
    const recipient = router.register(target, scope, "projection");
    recipient.publishProjection(checkpoint(1));
    const timedOutId = sent[0]!.deliveryId;

    await vi.advanceTimersByTimeAsync(60);
    expect(router.admit(target.id, {
      version: 1,
      deliveryId: timedOutId,
      outcome: "ack",
    })).toBe(false);
    recipient.publishProjection(checkpoint(2));
    expect(sent.at(-1)?.payload.message).toMatchObject({
      kind: "reset",
      stream: { commitSeq: 2 },
    });

    // A semantic message arriving while the reset ACK is pending cannot grow
    // the queue; it advances the required recovery floor instead.
    recipient.publishProjection(checkpoint(3));
    expect(router.diagnostics().pendingAdmissions).toBeLessThanOrEqual(1);
    recipient.publishProjection(checkpoint(4));
    expect(router.diagnostics()).toMatchObject({
      pendingAdmissions: 1,
      fencedRecipients: 1,
    });
  });

  test("persists a fence across unsubscribe and clears it only after reset admission", () => {
    const target = sender();
    const sent: RecipientDeliveryEnvelope[] = [];
    let allowSend = false;
    const router = new RecipientDeliveryRouter({
      send: (_sender, _channel, envelope) => {
        if (!allowSend) return false;
        sent.push(envelope);
        return true;
      },
    });
    const first = router.register(target, scope, "projection");
    first.publishProjection(checkpoint(7));
    first.release();

    allowSend = true;
    const second = router.register(target, scope, "projection");
    const reset = sent.at(-1)!;
    expect(reset.payload.message).toMatchObject({
      kind: "reset",
      stream: { commitSeq: 7 },
    });
    expect(router.admit(target.id, {
      version: 1,
      deliveryId: reset.deliveryId,
      outcome: "ack",
    })).toBe(true);
    expect(second.publishProjection(checkpoint(8)).sent).toBe(1);
    expect(router.diagnostics().fencedRecipients).toBe(0);
  });

  test("turns unacknowledged delivery into a reset when a scope resubscribes", () => {
    const target = sender();
    const sent: RecipientDeliveryEnvelope[] = [];
    const router = new RecipientDeliveryRouter({
      send: (_sender, _channel, envelope) => {
        sent.push(envelope);
        return true;
      },
    });
    const first = router.register(target, scope, "projection");
    first.publishProjection(checkpoint(9));
    first.release();

    router.register(target, scope, "projection");

    expect(sent).toHaveLength(2);
    expect(sent[1]?.payload).toMatchObject({
      lane: "projection",
      message: { kind: "reset", stream: { commitSeq: 9 } },
    });
  });

  test("fences send exceptions and rejects malformed NACKs", () => {
    const target = sender();
    const router = new RecipientDeliveryRouter({
      send: () => {
        throw new Error("renderer disappeared");
      },
    });
    const recipient = router.register(target, scope, "projection");

    expect(() => recipient.publishProjection(checkpoint(6))).not.toThrow();
    expect(router.diagnostics().fencedRecipients).toBe(1);
    expect(router.admit(target.id, {
      version: 1,
      deliveryId: "a".repeat(64),
      outcome: "nack",
      reason: "unknown",
    })).toBe(false);
  });

  test("releases destroyed renderer state and rejects its late ACK", () => {
    const target = sender();
    const sent: RecipientDeliveryEnvelope[] = [];
    const router = new RecipientDeliveryRouter({
      send: (_sender, _channel, envelope) => {
        sent.push(envelope);
        return true;
      },
    });
    const recipient = router.register(target, scope, "projection");
    recipient.publishProjection(checkpoint(1));
    router.releaseSender(target.id);
    expect(router.admit(target.id, {
      version: 1,
      deliveryId: sent[0]!.deliveryId,
      outcome: "ack",
    })).toBe(false);
    expect(router.diagnostics()).toEqual({
      recipients: 0,
      pendingAdmissions: 0,
      fencedRecipients: 0,
    });
  });

  test("repairs a failed revocation through its own lane", () => {
    const target = sender();
    const sent: RecipientDeliveryEnvelope[] = [];
    let allowSend = false;
    const router = new RecipientDeliveryRouter({
      send: (_sender, _channel, envelope) => {
        if (!allowSend) return false;
        sent.push(envelope);
        return true;
      },
    });
    const first = router.register(target, scope, "revocation");
    expect(first.publishRevocation(revocation(11)).fenced).toBe(1);
    first.release();

    allowSend = true;
    router.register(target, scope, "revocation");
    expect(sent.at(-1)?.payload).toMatchObject({
      lane: "revocation",
      message: {
        kind: "reset",
        reason: "recipient_delivery_failed",
        stream: { commitSeq: 11 },
      },
    });
  });
});
