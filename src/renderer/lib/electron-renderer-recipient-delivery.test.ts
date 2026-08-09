import { describe, expect, test, vi } from "vitest";

import type { RecipientDeliveryEnvelope } from "../../shared/recipient-delivery";
import type { ProjectionScope, ProjectionStreamMessage } from "../../shared/projection-stream";
import {
  createElectronRendererTransport,
  initializeElectronRendererLocalCommitIngress,
  type ElectronRendererBridge,
} from "./electron-renderer-transport";

const scope: ProjectionScope = {
  kind: "project",
  libraryId: "library-1",
  projectId: "project-1",
};

const checkpoint = (): ProjectionStreamMessage => ({
  version: 2,
  kind: "checkpoint",
  scope,
  stream: { storeEpoch: "epoch-1", commitSeq: 7 },
});

const envelope = (
  message: ProjectionStreamMessage = checkpoint(),
): RecipientDeliveryEnvelope => ({
  version: 1,
  deliveryId: "a".repeat(64),
  scope,
  payload: { lane: "projection", message },
});

const harness = () => {
  let recipientListener: ((...args: unknown[]) => void) | null = null;
  const invoke = vi.fn(async () => true);
  const bridge = {
    invoke,
    on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      if (channel === "recipient-delivery:message") recipientListener = listener;
      return () => undefined;
    }),
  } as unknown as ElectronRendererBridge;
  initializeElectronRendererLocalCommitIngress(bridge);
  const transport = createElectronRendererTransport(bridge);
  return {
    invoke,
    transport,
    deliver(value: unknown) {
      if (!recipientListener) throw new Error("Recipient listener was not installed");
      recipientListener(value);
    },
  };
};

describe("Electron renderer recipient delivery", () => {
  test("ACKs only after a valid message entered the process-wide ingress", async () => {
    const test = harness();
    const observed: ProjectionStreamMessage[] = [];
    const release = test.transport.subscribeProjectionStream(
      scope,
      (message) => observed.push(message),
    );

    test.deliver(envelope());

    await vi.waitFor(() => {
      expect(observed).toEqual([checkpoint()]);
      expect(test.invoke).toHaveBeenCalledWith("recipient-delivery:admit", {
        version: 1,
        deliveryId: "a".repeat(64),
        outcome: "ack",
      });
    });
    release();
  });

  test("NACKs a scope-divergent envelope without publishing it", async () => {
    const test = harness();
    const observed: ProjectionStreamMessage[] = [];
    const release = test.transport.subscribeProjectionStream(
      scope,
      (message) => observed.push(message),
    );
    const divergent: ProjectionStreamMessage = {
      ...checkpoint(),
      scope: { ...scope, projectId: "project-2" },
    };

    test.deliver(envelope(divergent));

    await vi.waitFor(() => {
      expect(test.invoke).toHaveBeenCalledWith("recipient-delivery:admit", {
        version: 1,
        deliveryId: "a".repeat(64),
        outcome: "nack",
        reason: "invalid_message",
      });
    });
    expect(observed).toEqual([]);
    release();
  });
});
