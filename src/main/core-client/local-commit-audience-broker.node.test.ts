import { describe, expect, test, vi } from "vitest";

import type { RecipientDeliveryEnvelope } from "../../shared/recipient-delivery";
import { createCoreLocalCommitFixture } from "./testing/local-commit-fixture";
import { LocalCommitAudienceBroker } from "./local-commit-audience-broker";
import { RecipientDeliveryRouter } from "./recipient-delivery-router";

const address = (projectId: string) => ({
  kind: "project" as const,
  library_id: "library-1",
  project_id: projectId,
});

const lease = (projectId: string, fill: string) => ({
  lease_id: fill.repeat(64),
  delivery_address: address(projectId),
  authorization_scope: address(projectId),
});

const sender = (id = 1) => ({
  id,
  isDestroyed: () => false,
  isLoadingMainFrame: () => false,
  send: vi.fn(),
});

describe("LocalCommitAudienceBroker", () => {
  test("rejects foreign and 201st addresses without losing prior subscriptions", () => {
    const router = new RecipientDeliveryRouter({ send: () => true });
    const broker = new LocalCommitAudienceBroker({
      router,
      onScopesChanged: () => undefined,
      resolveLibraryId: () => "library-1",
    });
    const target = sender();
    expect(() =>
      broker.subscribe(target, {
        ...address("foreign"),
        library_id: "library-other",
      }),
    ).toThrow("address is invalid");
    for (let index = 0; index < 200; index += 1) {
      broker.subscribe(target, address(`project-${index}`));
    }

    expect(() => broker.subscribe(target, address("project-200"))).toThrow("at most 200 addresses");
    expect(broker.diagnostics()).toMatchObject({
      subscriptions: 200,
      addresses: 200,
    });
  });

  test("routes only through the exact Core-issued address lease", () => {
    const sent: RecipientDeliveryEnvelope[] = [];
    const scopes = vi.fn();
    const router = new RecipientDeliveryRouter({
      send: (_sender, _channel, envelope) => {
        sent.push(envelope);
        return true;
      },
    });
    const broker = new LocalCommitAudienceBroker({
      router,
      onScopesChanged: scopes,
      resolveLibraryId: () => "library-1",
    });
    const target = sender();
    const release = broker.subscribe(target, address("project-1"));
    const projectOne = createCoreLocalCommitFixture({
      authorizationScope: address("project-1"),
      commitSeq: 1,
    });
    const projectTwo = createCoreLocalCommitFixture({
      authorizationScope: address("project-2"),
      commitSeq: 2,
    });

    expect(broker.publish(projectOne).recipients).toBe(0);
    broker.installLeases(
      [lease("project-1", "a")],
      { storeEpoch: "epoch-1", commitSeq: 0 },
      [],
      "stream_gap",
    );
    expect(broker.publish(projectTwo).recipients).toBe(0);
    expect(broker.publish(projectOne).sent).toBe(1);
    expect(sent.at(-1)?.payload).toMatchObject({
      kind: "packet",
      packet: { delivery_address: address("project-1") },
    });
    expect(scopes).toHaveBeenCalledWith([
      {
        kind: "project",
        libraryId: "library-1",
        projectId: "project-1",
      },
    ]);

    release();
    expect(broker.diagnostics().subscriptions).toBe(0);
  });

  test("uses a replacement lease to author an address reset", () => {
    const sent: RecipientDeliveryEnvelope[] = [];
    const router = new RecipientDeliveryRouter({
      send: (_sender, _channel, envelope) => {
        sent.push(envelope);
        return true;
      },
    });
    const broker = new LocalCommitAudienceBroker({
      router,
      onScopesChanged: () => undefined,
      resolveLibraryId: () => "library-1",
    });
    broker.subscribe(sender(), address("project-1"));

    broker.installLeases(
      [lease("project-1", "b")],
      { storeEpoch: "epoch-2", commitSeq: 7 },
      [address("project-1")],
      "store_epoch_replacement",
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      recipientLeaseId: "b".repeat(64),
      payload: {
        kind: "reset",
        reset: {
          required_commit_seq: 7,
          reason: "store_epoch_replacement",
        },
      },
    });
  });

  test("binds a later recipient when its address is already leased", () => {
    const sent: Array<{
      readonly senderId: number;
      readonly envelope: RecipientDeliveryEnvelope;
    }> = [];
    const router = new RecipientDeliveryRouter({
      send: (target, _channel, envelope) => {
        sent.push({ senderId: target.id, envelope });
        return true;
      },
    });
    const broker = new LocalCommitAudienceBroker({
      router,
      onScopesChanged: () => undefined,
      resolveLibraryId: () => "library-1",
    });
    broker.subscribe(sender(1), address("project-1"));
    broker.installLeases(
      [lease("project-1", "c")],
      { storeEpoch: "epoch-1", commitSeq: 4 },
      [address("project-1")],
      "stream_gap",
    );
    const firstReset = sent.at(-1)?.envelope;
    if (!firstReset) throw new Error("First recipient received no reset");
    expect(
      router.admit(1, {
        version: 2,
        deliveryId: firstReset.deliveryId,
        outcome: "ack",
      }),
    ).toBe(true);
    sent.length = 0;

    broker.subscribe(sender(2), address("project-1"));

    expect(sent).toEqual([
      expect.objectContaining({
        senderId: 2,
        envelope: expect.objectContaining({
          recipientLeaseId: "c".repeat(64),
          payload: {
            kind: "reset",
            reset: expect.objectContaining({
              required_commit_seq: 4,
              reason: "stream_gap",
            }),
          },
        }),
      }),
    ]);
    const secondReset = sent.at(-1)?.envelope;
    if (!secondReset) throw new Error("Second recipient received no reset");
    expect(
      router.admit(2, {
        version: 2,
        deliveryId: secondReset.deliveryId,
        outcome: "ack",
      }),
    ).toBe(true);

    sent.length = 0;
    const packet = createCoreLocalCommitFixture({
      authorizationScope: address("project-1"),
      commitSeq: 5,
    });
    expect(broker.publish(packet)).toMatchObject({ recipients: 2, sent: 2 });
    expect(sent.map((entry) => entry.senderId)).toEqual([1, 2]);
  });
});
