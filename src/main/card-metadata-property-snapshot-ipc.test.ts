import { describe, expect, test } from "vitest";

import type { CardMetadataPropertySnapshot } from "../shared/card-metadata-property-compiler";
import { CardMetadataPropertySnapshotError } from "./local-store/card-metadata-property-snapshot";
import {
  registerCardMetadataPropertySnapshotIpcHandler,
  type CardMetadataPropertySnapshotIpcHandler,
} from "./card-metadata-property-snapshot-ipc";

const snapshot: CardMetadataPropertySnapshot = {
  projectId: "project-1",
  storeEpoch: "epoch-1",
  changeLogSeq: 4,
  cardBlockId: "card-1",
  metadataRevision: 2,
  fields: [],
};

describe("Card metadata property snapshot IPC boundary", () => {
  test("binds trusted canonical scope and returns the authority snapshot", async () => {
    const handlers: CardMetadataPropertySnapshotIpcHandler[] = [];
    const reads: string[] = [];
    registerCardMetadataPropertySnapshotIpcHandler({
      registerHandle: (_channel, listener) => {
        handlers.push(listener);
      },
      isTrustedEvent: (event) => event === "trusted",
      readSnapshot: (projectId, cardBlockId) => {
        reads.push(`${projectId}:${cardBlockId}`);
        return snapshot;
      },
    });
    const handler = handlers[0];
    if (!handler) throw new Error("handler was not registered");

    const result = await handler("trusted", "project-1", "card-1");
    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.storeEpoch : "").toBe("epoch-1");
    expect(reads.join(",")).toBe("project-1:card-1");
  });

  test("rejects untrusted callers and maps typed store failures", async () => {
    const handlers: CardMetadataPropertySnapshotIpcHandler[] = [];
    registerCardMetadataPropertySnapshotIpcHandler({
      registerHandle: (_channel, listener) => {
        handlers.push(listener);
      },
      isTrustedEvent: (event) => event === "trusted",
      readSnapshot: () => {
        throw new CardMetadataPropertySnapshotError(
          "card_not_found",
          "Card missing",
        );
      },
    });
    const handler = handlers[0];
    if (!handler) throw new Error("handler was not registered");

    const untrusted = await handler("foreign", "project-1", "card-1");
    expect(untrusted.ok).toBe(false);
    expect(untrusted.ok ? "ok" : untrusted.error.code).toBe("invalid_request");

    const missing = await handler("trusted", "project-1", "card-1");
    expect(missing.ok).toBe(false);
    expect(missing.ok ? "ok" : missing.error.code).toBe("card_not_found");
  });
});
