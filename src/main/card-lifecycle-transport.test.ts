import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type {
  CardLifecycleMutationCommandResult,
  CardLifecycleMutationRequest,
} from "../shared/card-lifecycle";
import {
  registerCardLifecycleHttpRoute,
  registerCardLifecyclePreflightHttpRoute,
} from "./card-lifecycle-http";
import {
  CARD_LIFECYCLE_MUTATION_IPC_CHANNEL,
  CARD_LIFECYCLE_PREFLIGHT_IPC_CHANNEL,
  registerCardLifecycleIpcHandler,
  registerCardLifecyclePreflightIpcHandler,
} from "./card-lifecycle-ipc";
import type { CardLifecyclePreflightResult } from "../shared/card-lifecycle-runtime";

const request = (session: string, actorKind: string) => ({
  version: 1,
  operationId: "card-lifecycle-transport-retry",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  clientSessionId: session,
  actor: { kind: actorKind, isAdmin: true },
  operation: {
    kind: "archive_card",
    cardId: "card-1",
    expectedMetadataRevision: 2,
  },
});

describe("Card lifecycle IPC/HTTP transport", () => {
  test("replaces spoofed audit identity at both trusted host boundaries", async () => {
    const received: CardLifecycleMutationRequest[] = [];
    const apply = async (
      input: CardLifecycleMutationRequest,
    ): Promise<CardLifecycleMutationCommandResult> => {
      received.push(input);
      return {
        ok: false,
        error: {
          code: "card_lifecycle_conflict",
          message: "test boundary",
          retryable: false,
          operationId: input.operationId,
          cardId: input.operation.cardId,
        },
      };
    };
    const handlers = new Map<
      string,
      (
        event: unknown,
        projectId: string,
        rawRequest: unknown,
      ) => Promise<CardLifecycleMutationCommandResult>
    >();
    registerCardLifecycleIpcHandler({
      registerHandle: (channel, listener) => handlers.set(channel, listener),
      getTrustedIdentity: (event) =>
        event === "trusted"
          ? {
              actor: { kind: "electron", webContentsId: 7 },
              clientSessionId: "trusted-window-7",
            }
          : null,
      applyMutation: apply,
    });
    await handlers.get(CARD_LIFECYCLE_MUTATION_IPC_CHANNEL)?.(
      "trusted",
      "project-1",
      request("spoofed-ipc", "admin"),
    );

    const app = new Hono();
    registerCardLifecycleHttpRoute(app, { applyMutation: apply });
    const response = await app.request(
      "/api/projects/project-1/card-lifecycle-mutations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request("spoofed-http", "root")),
      },
    );
    expect(response.status).toBe(409);
    expect(received.length).toBe(2);
    expect(received[0]?.actor.kind).toBe("electron");
    expect(received[0]?.actor.webContentsId).toBe(7);
    expect(received[0]?.clientSessionId).toBe("trusted-window-7");
    expect(received[1]?.actor.kind).toBe("http_loopback");
    expect(received[1]?.clientSessionId === undefined).toBeTrue();
    expect(received[0]?.operationId).toBe(received[1]?.operationId);
  });

  test("rejects untrusted IPC and cross-Project HTTP before enqueue", async () => {
    let calls = 0;
    const handlers = new Map<
      string,
      (
        event: unknown,
        projectId: string,
        rawRequest: unknown,
      ) => Promise<CardLifecycleMutationCommandResult>
    >();
    registerCardLifecycleIpcHandler({
      registerHandle: (channel, listener) => handlers.set(channel, listener),
      getTrustedIdentity: () => null,
      applyMutation: async () => {
        calls += 1;
        throw new Error("not reached");
      },
    });
    const ipc = await handlers.get(CARD_LIFECYCLE_MUTATION_IPC_CHANNEL)?.(
      "untrusted",
      "project-1",
      request("spoofed", "admin"),
    );
    expect(ipc?.ok).toBeFalse();

    const app = new Hono();
    registerCardLifecycleHttpRoute(app, {
      applyMutation: async () => {
        calls += 1;
        throw new Error("not reached");
      },
    });
    const response = await app.request(
      "/api/projects/project-2/card-lifecycle-mutations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request("spoofed", "admin")),
      },
    );
    expect(response.status).toBe(400);
    expect(calls).toBe(0);
  });

  test("serves the same typed preflight contract over IPC and HTTP", async () => {
    const result: CardLifecyclePreflightResult = {
      ok: true,
      value: {
        version: 1,
        projectId: "project-1",
        storeEpoch: "epoch-1",
        changeLogSeq: 8,
        value: null,
      },
    };
    const reads: string[] = [];
    const readPreflight = async (
      projectId: string,
      cardId: string,
    ): Promise<CardLifecyclePreflightResult> => {
      reads.push(`${projectId}:${cardId}`);
      return result;
    };
    const handlers = new Map<
      string,
      (
        event: unknown,
        projectId: string,
        cardId: string,
      ) => Promise<CardLifecyclePreflightResult>
    >();
    registerCardLifecyclePreflightIpcHandler({
      registerHandle: (channel, listener) => handlers.set(channel, listener),
      readPreflight,
    });
    const ipc = await handlers.get(CARD_LIFECYCLE_PREFLIGHT_IPC_CHANNEL)?.(
      {},
      "project-1",
      "card-1",
    );
    expect(ipc?.ok).toBeTrue();

    const app = new Hono();
    registerCardLifecyclePreflightHttpRoute(app, { readPreflight });
    const response = await app.request(
      "/api/projects/project-1/card-lifecycle-preflight?cardId=card-1",
    );
    expect(response.status).toBe(200);
    const http = (await response.json()) as CardLifecyclePreflightResult;
    expect(http.ok).toBeTrue();
    expect(reads.join(",")).toBe("project-1:card-1,project-1:card-1");
  });
});
