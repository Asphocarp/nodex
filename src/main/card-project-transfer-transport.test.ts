import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type {
  CardProjectTransferCommandResult,
  CardProjectTransferIntent,
} from "../shared/card-project-transfer";
import type { PublicCardProjectTransferIntent } from "../shared/card-project-transfer-transport";
import { registerCardProjectTransferHttpRoute } from "./card-project-transfer-http";
import {
  CARD_PROJECT_TRANSFER_IPC_CHANNEL,
  registerCardProjectTransferIpcHandler,
  type CardProjectTransferIpcHandler,
} from "./card-project-transfer-ipc";

const intent: PublicCardProjectTransferIntent = {
  version: 2,
  operationId: "transfer-public-1",
  sourceProjectId: "project-a",
  targetProjectId: "project-b",
  cardId: "card-1",
  target: {
    databaseBlockId: "database-b",
    viewId: "view-b",
    status: "in_progress",
  },
};

const committed = (
  bound: CardProjectTransferIntent,
): CardProjectTransferCommandResult => ({
  ok: true,
  value: {
    version: 2,
    operationId: bound.operationId,
    storeEpoch: "epoch-1",
    sourceProjectId: bound.sourceProjectId,
    targetProjectId: bound.targetProjectId,
    cardId: bound.cardId,
    duplicate: false,
    movedBlockIds: [bound.cardId],
    movedDocumentIds: ["document-card-1"],
    sourceMembershipIds: ["membership-source"],
    targetMembershipIds: { [bound.cardId]: "membership-target" },
    blockMetadataRevisions: { [bound.cardId]: 2 },
    rootLocationRevision: 2,
    documentHeads: { "document-card-1": { generation: 1, headSeq: 4 } },
    targetDatabaseBlockId: bound.target.databaseBlockId,
    targetDatabaseSchemaRevision: 2,
    targetViewId: bound.target.viewId,
    targetStatus: bound.target.status,
    targetViewRankKey: "2000",
    changeLogSeq: 9,
    committedAt: "2026-07-12T00:00:00.000Z",
  },
});

describe("Card Project transfer public transports", () => {
  test("Electron binds trusted main-frame audit identity", async () => {
    let handler: CardProjectTransferIpcHandler = async () => {
      throw new Error("handler missing");
    };
    const captured: CardProjectTransferIntent[] = [];
    registerCardProjectTransferIpcHandler({
      registerHandle: (channel, listener) => {
        expect(channel).toBe(CARD_PROJECT_TRANSFER_IPC_CHANNEL);
        handler = listener;
      },
      resolveTrustedIdentity: () => ({
        clientSessionId: "electron-window-1",
        actor: { kind: "electron_renderer", clientId: "renderer-1" },
      }),
      transfer: async (bound) => {
        captured.push(bound);
        return committed(bound);
      },
    });
    const result = await handler({}, "project-a", intent);
    expect(result.ok).toBe(true);
    expect(captured[0]?.clientSessionId).toBe("electron-window-1");
    expect(captured[0]?.actor.kind).toBe("electron_renderer");
  });

  test("rejects untrusted, route-mismatched, and spoofed IPC input", async () => {
    let handler: CardProjectTransferIpcHandler = async () => {
      throw new Error("handler missing");
    };
    registerCardProjectTransferIpcHandler({
      registerHandle: (_channel, listener) => {
        handler = listener;
      },
      resolveTrustedIdentity: () => null,
      transfer: async (bound) => committed(bound),
    });
    expect((await handler({}, "project-a", intent)).ok).toBe(false);

    let calls = 0;
    registerCardProjectTransferIpcHandler({
      registerHandle: (_channel, listener) => {
        handler = listener;
      },
      resolveTrustedIdentity: () => ({
        clientSessionId: "trusted",
        actor: { kind: "electron_renderer" },
      }),
      transfer: async (bound) => {
        calls += 1;
        return committed(bound);
      },
    });
    expect((await handler({}, "project-other", intent)).ok).toBe(false);
    expect(
      (
        await handler({}, "project-a", {
          ...intent,
          actor: { kind: "spoofed" },
        } as unknown as PublicCardProjectTransferIntent)
      ).ok,
    ).toBe(false);
    expect(calls).toBe(0);
  });

  test("HTTP binds loopback identity and preserves typed statuses", async () => {
    const app = new Hono();
    const captured: CardProjectTransferIntent[] = [];
    registerCardProjectTransferHttpRoute(app, {
      transfer: async (bound) => {
        captured.push(bound);
        return committed(bound);
      },
    });
    const response = await app.request(
      "/api/projects/project-a/card-transfers",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intent),
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(captured[0]?.actor.kind).toBe("http_loopback");

    const conflict = new Hono();
    registerCardProjectTransferHttpRoute(conflict, {
      transfer: async (bound) => ({
        ok: false,
        error: {
          code: "document_head_conflict",
          message: "head advanced",
          retryable: true,
          operationId: bound.operationId,
          cardId: bound.cardId,
        },
      }),
    });
    const conflictResponse = await conflict.request(
      "/api/projects/project-a/card-transfers",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intent),
      },
    );
    expect(conflictResponse.status).toBe(409);
  });
});
