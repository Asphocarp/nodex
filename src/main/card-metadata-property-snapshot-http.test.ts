import { describe, expect, test } from "vitest";
import { Hono } from "hono";

import type { CardMetadataPropertySnapshot } from "../shared/card-metadata-property-compiler";
import type { CardMetadataPropertySnapshotCommandResult } from "../shared/card-metadata-property-snapshot-transport";
import { CardMetadataPropertySnapshotError } from "./local-store/card-metadata-property-snapshot";
import { registerCardMetadataPropertySnapshotHttpRoute } from "./card-metadata-property-snapshot-http";

const snapshot: CardMetadataPropertySnapshot = {
  projectId: "project-1",
  storeEpoch: "epoch-1",
  changeLogSeq: 4,
  cardBlockId: "card-1",
  metadataRevision: 2,
  fields: [],
};

describe("Card metadata property snapshot HTTP boundary", () => {
  test("returns an uncached Project-scoped snapshot", async () => {
    const app = new Hono();
    const reads: string[] = [];
    registerCardMetadataPropertySnapshotHttpRoute(app, {
      readSnapshot: (projectId, cardBlockId) => {
        reads.push(`${projectId}:${cardBlockId}`);
        return snapshot;
      },
    });

    const response = await app.request(
      "/api/projects/project-1/cards/card-1/metadata-property-snapshot",
    );
    const result = (await response.json()) as CardMetadataPropertySnapshotCommandResult;
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(result.ok).toBe(true);
    expect(reads.join(",")).toBe("project-1:card-1");
  });

  test("maps missing Cards and retryable authority failures", async () => {
    const missingApp = new Hono();
    registerCardMetadataPropertySnapshotHttpRoute(missingApp, {
      readSnapshot: () => {
        throw new CardMetadataPropertySnapshotError(
          "card_not_found",
          "Card missing",
        );
      },
    });
    const missing = await missingApp.request(
      "/api/projects/project-1/cards/card-1/metadata-property-snapshot",
    );
    expect(missing.status).toBe(404);

    const unavailableApp = new Hono();
    registerCardMetadataPropertySnapshotHttpRoute(unavailableApp, {
      readSnapshot: () => {
        throw new Error("SQLite unavailable");
      },
    });
    const unavailable = await unavailableApp.request(
      "/api/projects/project-1/cards/card-1/metadata-property-snapshot",
    );
    const result = (await unavailable.json()) as CardMetadataPropertySnapshotCommandResult;
    expect(unavailable.status).toBe(503);
    expect(result.ok ? false : result.error.retryable).toBe(true);
  });
});
