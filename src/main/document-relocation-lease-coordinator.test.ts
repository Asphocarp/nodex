import { describe, expect, test } from "vitest";
import {
  DocumentRelocationLeaseCoordinator,
  MAX_DOCUMENT_RELOCATION_LEASE_DEADLINE_MS,
  type DocumentRelocationLeaseEvent,
} from "./document-relocation-lease-coordinator";

interface FakeTimer {
  readonly id: number;
  readonly dueAt: number;
  readonly callback: () => void;
}

class FakeTime {
  nowMs = 1_000;

  private nextTimerId = 1;

  private readonly timers = new Map<number, FakeTimer>();

  readonly clock = {
    now: (): number => this.nowMs,
  };

  readonly timerApi = {
    setTimeout: (callback: () => void, delayMs: number): unknown => {
      const id = this.nextTimerId;
      this.nextTimerId += 1;
      this.timers.set(id, { id, dueAt: this.nowMs + delayMs, callback });
      return id;
    },
    clearTimeout: (timer: unknown): void => {
      if (typeof timer !== "number") return;
      this.timers.delete(timer);
    },
  };

  advanceBy(delayMs: number): void {
    const target = this.nowMs + delayMs;
    while (true) {
      const due = [...this.timers.values()]
        .filter((timer) => timer.dueAt <= target)
        .sort((left, right) =>
          left.dueAt === right.dueAt
            ? left.id - right.id
            : left.dueAt - right.dueAt,
        )[0];
      if (due === undefined) break;
      this.timers.delete(due.id);
      this.nowMs = due.dueAt;
      due.callback();
    }
    this.nowMs = target;
  }
}

const makeHarness = (
  publish?: (event: DocumentRelocationLeaseEvent) => void,
) => {
  const time = new FakeTime();
  const events: DocumentRelocationLeaseEvent[] = [];
  const coordinator = new DocumentRelocationLeaseCoordinator({
    clock: time.clock,
    timers: time.timerApi,
    publishEvent: (event) => {
      events.push(event);
      publish?.(event);
    },
  });
  return { coordinator, events, time };
};

const documentHead = (
  documentId: string,
  expectedHeadSeq: number,
  generation = 1,
) => ({ documentId, generation, expectedHeadSeq });

describe("Document relocation lease coordinator", () => {
  test("fences Documents in sorted order and resolves all snapshotted participant heads", async () => {
    const harness = makeHarness();
    harness.coordinator.subscribe("participant-shared", "document-b");
    harness.coordinator.subscribe("participant-shared", "document-a");
    harness.coordinator.subscribe("participant-a", "document-a");
    expect(
      harness.coordinator
        .snapshotParticipantSessionKeys("document-a")
        .join(","),
    ).toBe("participant-a,participant-shared");

    const preparation = harness.coordinator.prepare({
      leaseId: "lease-1",
      documents: [documentHead("document-b", 2), documentHead("document-a", 5)],
      deadlineMs: 500,
    });
    expect(harness.coordinator.getFencedDocumentIds().join(",")).toBe(
      "document-a,document-b",
    );
    const prepareEvents = harness.events.filter(
      (event) => event.kind === "prepare",
    );
    expect(prepareEvents.length).toBe(2);
    expect(prepareEvents[0]?.participantSessionKey).toBe("participant-a");
    expect(prepareEvents[1]?.participantSessionKey).toBe("participant-shared");
    expect(
      prepareEvents[1]?.kind === "prepare"
        ? prepareEvents[1].documents
            .map((document) => document.documentId)
            .join(",")
        : "",
    ).toBe("document-a,document-b");

    const concurrent = await harness.coordinator.prepare({
      leaseId: "lease-concurrent",
      documents: [documentHead("document-b", 2)],
    });
    expect(concurrent.ok).toBe(false);
    if (!concurrent.ok) expect(concurrent.error.code).toBe("document_busy");
    const lateSubscription = harness.coordinator.subscribe(
      "participant-late",
      "document-a",
    );
    expect(lateSubscription.ok).toBe(false);
    if (!lateSubscription.ok) {
      expect(lateSubscription.error.code).toBe("document_busy");
    }

    harness.time.advanceBy(10);
    const firstAck = harness.coordinator.acknowledge({
      leaseId: "lease-1",
      participantSessionKey: "participant-a",
      documentId: "document-a",
      generation: 1,
      headSeq: 6,
    });
    expect(firstAck.ok).toBe(true);
    if (firstAck.ok) expect(firstAck.value.acknowledgedAt).toBe(1_010);
    const duplicateAck = harness.coordinator.acknowledge({
      leaseId: "lease-1",
      participantSessionKey: "participant-a",
      documentId: "document-a",
      generation: 1,
      headSeq: 6,
    });
    expect(duplicateAck.ok).toBe(false);
    if (!duplicateAck.ok) expect(duplicateAck.error.code).toBe("duplicate_ack");

    harness.time.advanceBy(10);
    harness.coordinator.acknowledge({
      leaseId: "lease-1",
      participantSessionKey: "participant-shared",
      documentId: "document-a",
      generation: 1,
      headSeq: 7,
    });
    const finalAck = harness.coordinator.acknowledge({
      leaseId: "lease-1",
      participantSessionKey: "participant-shared",
      documentId: "document-b",
      generation: 1,
      headSeq: 3,
    });
    expect(finalAck.ok).toBe(true);
    if (finalAck.ok) expect(finalAck.value.prepared).toBe(true);

    const prepared = await preparation;
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(
      prepared.value.documents.map((document) => document.documentId).join(","),
    ).toBe("document-a,document-b");
    expect(
      prepared.value.resolvedHeads
        .map((document) => `${document.documentId}:${document.headSeq}`)
        .join(","),
    ).toBe("document-a:7,document-b:3");
    expect(prepared.value.acknowledgements.length).toBe(3);
    expect(harness.coordinator.getFencedDocumentIds().length).toBe(2);

    const released = harness.coordinator.release("lease-1");
    expect(released.ok).toBe(true);
    if (released.ok) expect(released.value.duplicate).toBe(false);
    expect(harness.coordinator.getFencedDocumentIds().length).toBe(0);
    expect(
      harness.events.filter((event) => event.kind === "release").length,
    ).toBe(2);
    const duplicateRelease = harness.coordinator.release("lease-1");
    expect(duplicateRelease.ok).toBe(true);
    if (duplicateRelease.ok)
      expect(duplicateRelease.value.duplicate).toBe(true);
  });

  test("prepares immediately without active surfaces but retains fences until release", async () => {
    const harness = makeHarness();
    const prepared = await harness.coordinator.prepare({
      leaseId: "lease-empty",
      documents: [documentHead("document-a", 4)],
    });
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      expect(prepared.value.acknowledgements.length).toBe(0);
      expect(prepared.value.resolvedHeads[0]?.headSeq).toBe(4);
    }
    expect(harness.coordinator.getFencedDocumentIds().join(",")).toBe(
      "document-a",
    );
    harness.coordinator.release("lease-empty");
    expect(harness.coordinator.getFencedDocumentIds().length).toBe(0);
  });

  test("uses a bounded fake deadline and rejects foreign, regressed, and late ACKs", async () => {
    const harness = makeHarness();
    harness.coordinator.subscribe("participant-a", "document-a");
    const preparation = harness.coordinator.prepare({
      leaseId: "lease-timeout",
      documents: [documentHead("document-a", 8, 2)],
      deadlineMs: Number.MAX_SAFE_INTEGER,
    });
    const prepare = harness.events[0];
    expect(prepare?.kind).toBe("prepare");
    if (prepare?.kind === "prepare") {
      expect(prepare.deadlineAt).toBe(
        1_000 + MAX_DOCUMENT_RELOCATION_LEASE_DEADLINE_MS,
      );
    }

    const foreign = harness.coordinator.acknowledge({
      leaseId: "lease-timeout",
      participantSessionKey: "foreign",
      documentId: "document-a",
      generation: 2,
      headSeq: 8,
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok)
      expect(foreign.error.code).toBe("participant_not_expected");
    const regressed = harness.coordinator.acknowledge({
      leaseId: "lease-timeout",
      participantSessionKey: "participant-a",
      documentId: "document-a",
      generation: 2,
      headSeq: 7,
    });
    expect(regressed.ok).toBe(false);
    if (!regressed.ok) {
      expect(regressed.error.code).toBe("document_head_regressed");
    }

    harness.time.advanceBy(MAX_DOCUMENT_RELOCATION_LEASE_DEADLINE_MS);
    const timedOut = await preparation;
    expect(timedOut.ok).toBe(false);
    if (!timedOut.ok) expect(timedOut.error.code).toBe("lease_timeout");
    expect(harness.coordinator.getFencedDocumentIds().length).toBe(0);
    const late = harness.coordinator.acknowledge({
      leaseId: "lease-timeout",
      participantSessionKey: "participant-a",
      documentId: "document-a",
      generation: 2,
      headSeq: 8,
    });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error.code).toBe("lease_closed");
    const duplicateCancel = harness.coordinator.cancel("lease-timeout");
    expect(duplicateCancel.ok).toBe(true);
    if (duplicateCancel.ok) {
      expect(duplicateCancel.value.duplicate).toBe(true);
    }
  });

  test("disconnect cancels every pending lease for a multi-Document participant", async () => {
    const harness = makeHarness();
    harness.coordinator.subscribe("participant-shared", "document-a");
    harness.coordinator.subscribe("participant-shared", "document-c");
    harness.coordinator.subscribe("participant-b", "document-a");
    const first = harness.coordinator.prepare({
      leaseId: "lease-a",
      documents: [documentHead("document-a", 1)],
    });
    const second = harness.coordinator.prepare({
      leaseId: "lease-c",
      documents: [documentHead("document-c", 2)],
    });
    expect(harness.coordinator.disconnect("participant-shared")).toBe(2);

    const firstFailure = await first;
    const secondFailure = await second;
    expect(firstFailure.ok).toBe(false);
    expect(secondFailure.ok).toBe(false);
    if (!firstFailure.ok) {
      expect(firstFailure.error.code).toBe("participant_disconnected");
    }
    if (!secondFailure.ok) {
      expect(secondFailure.error.code).toBe("participant_disconnected");
    }
    expect(harness.coordinator.getFencedDocumentIds().length).toBe(0);
    expect(
      harness.coordinator
        .snapshotParticipantSessionKeys("document-a")
        .join(","),
    ).toBe("participant-b");
  });

  test("an acknowledged participant may detach while the remaining lease quorum prepares", async () => {
    const harness = makeHarness();
    harness.coordinator.subscribe("participant-nested", "document-a");
    harness.coordinator.subscribe("participant-outer", "document-a");
    const preparation = harness.coordinator.prepare({
      leaseId: "lease-view-detach",
      documents: [documentHead("document-a", 4)],
    });

    const nestedAck = harness.coordinator.acknowledge({
      leaseId: "lease-view-detach",
      participantSessionKey: "participant-nested",
      documentId: "document-a",
      generation: 1,
      headSeq: 4,
    });
    expect(nestedAck.ok).toBe(true);
    const detached = harness.coordinator.unsubscribe(
      "participant-nested",
      "document-a",
    );
    expect(detached.ok).toBe(true);
    expect(harness.coordinator.getFencedDocumentIds()).toEqual([
      "document-a",
    ]);

    harness.coordinator.acknowledge({
      leaseId: "lease-view-detach",
      participantSessionKey: "participant-outer",
      documentId: "document-a",
      generation: 1,
      headSeq: 5,
    });
    const prepared = await preparation;
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      expect(prepared.value.resolvedHeads[0]?.headSeq).toBe(5);
      expect(prepared.value.acknowledgements).toHaveLength(2);
    }
    harness.coordinator.release("lease-view-detach");
  });

  test("only an expected participant can NACK and caller cancellation is idempotent", async () => {
    const harness = makeHarness();
    harness.coordinator.subscribe("participant-a", "document-a");
    const preparation = harness.coordinator.prepare({
      leaseId: "lease-nack",
      documents: [documentHead("document-a", 1)],
    });
    const foreign = harness.coordinator.nack({
      leaseId: "lease-nack",
      participantSessionKey: "foreign",
      documentId: "document-a",
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok)
      expect(foreign.error.code).toBe("participant_not_expected");
    const releaseBeforeAck = harness.coordinator.release("lease-nack");
    expect(releaseBeforeAck.ok).toBe(false);
    if (!releaseBeforeAck.ok) {
      expect(releaseBeforeAck.error.code).toBe("lease_not_prepared");
    }
    const nack = harness.coordinator.nack({
      leaseId: "lease-nack",
      participantSessionKey: "participant-a",
      documentId: "document-a",
      message: "IME could not flush",
    });
    expect(nack.ok).toBe(true);
    const failed = await preparation;
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe("participant_nack");
    const duplicateCancel = harness.coordinator.cancel("lease-nack");
    expect(duplicateCancel.ok).toBe(true);
    if (duplicateCancel.ok) {
      expect(duplicateCancel.value.duplicate).toBe(true);
    }
  });

  test("generation errors do not consume the participant's one valid ACK", async () => {
    const harness = makeHarness();
    harness.coordinator.subscribe("participant-a", "document-a");
    const preparation = harness.coordinator.prepare({
      leaseId: "lease-generation",
      documents: [documentHead("document-a", 3, 4)],
    });
    const wrongGeneration = harness.coordinator.acknowledge({
      leaseId: "lease-generation",
      participantSessionKey: "participant-a",
      documentId: "document-a",
      generation: 3,
      headSeq: 3,
    });
    expect(wrongGeneration.ok).toBe(false);
    if (!wrongGeneration.ok) {
      expect(wrongGeneration.error.code).toBe("document_generation_mismatch");
    }
    harness.coordinator.acknowledge({
      leaseId: "lease-generation",
      participantSessionKey: "participant-a",
      documentId: "document-a",
      generation: 4,
      headSeq: 3,
    });
    expect((await preparation).ok).toBe(true);
    harness.coordinator.release("lease-generation");
  });

  test("prepare publication failure cleans every acquired fence", async () => {
    const harness = makeHarness((event) => {
      if (event.kind === "prepare") throw new Error("transport closed");
    });
    harness.coordinator.subscribe("participant-a", "document-a");
    const result = await harness.coordinator.prepare({
      leaseId: "lease-publish-failure",
      documents: [documentHead("document-a", 1)],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("prepare_publish_failed");
    expect(harness.coordinator.getFencedDocumentIds().length).toBe(0);
  });
});
