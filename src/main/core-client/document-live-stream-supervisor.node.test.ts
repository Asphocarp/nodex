import { describe, expect, test, vi } from "vitest";

import { superviseDocumentLiveStream } from "./document-live-stream-supervisor";
import type {
  CoreDocumentEventSubscription,
  DocumentLiveBarrier,
  DocumentLiveRepair,
} from "./types";

const barrier: DocumentLiveBarrier = {
  store_epoch: "epoch:test",
  core_generation: "generation:test",
  document_id: "document:test",
  document_generation: 1,
  head_seq: 3,
  commit_head: 7,
  engine: "yjs",
};

const repair: DocumentLiveRepair = {
  document_id: barrier.document_id,
  store_epoch: barrier.store_epoch,
  document_generation: barrier.document_generation,
  head_seq: barrier.head_seq,
  commit_head: 8,
  reason: "receiver_lagged",
};

interface Opening {
  readonly repair: (event: DocumentLiveRepair) => void;
  readonly subscription: CoreDocumentEventSubscription;
}

describe("Document live stream supervisor", () => {
  test("disconnects the closing lease before publishing its repair", async () => {
    const openings: Opening[] = [];
    const observations: string[] = [];
    const supervisor = superviseDocumentLiveStream({
      retryDelayMs: 0,
      open: async (_onEvent, onRepair) => {
        let finish = (): void => undefined;
        const done = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const subscription: CoreDocumentEventSubscription = {
          barrier,
          done,
          close: finish,
        };
        openings.push({ repair: onRepair, subscription });
        return subscription;
      },
      onEvent: () => undefined,
      onRepair: () => {
        observations.push("repair");
      },
      onRealtime: () => undefined,
      onConnectionStateChanged: (state) => observations.push(state),
    });

    await supervisor.ready;
    expect(observations).toEqual(["connected"]);

    openings[0]?.repair(repair);
    await vi.waitFor(() => expect(openings).toHaveLength(2));

    expect(observations.slice(0, 3)).toEqual([
      "connected",
      "disconnected",
      "repair",
    ]);
    await vi.waitFor(() => {
      expect(observations.at(-1)).toBe("connected");
    });

    supervisor.close();
    await supervisor.done;
  });
});
