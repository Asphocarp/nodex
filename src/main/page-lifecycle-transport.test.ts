import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import type {
  PageLifecycleMutationCommandResult,
  PageLifecycleMutationRequest,
} from "../shared/page-lifecycle";
import {
  registerPageLifecycleHttpRoute,
  registerPageLifecyclePreflightHttpRoute,
} from "./page-lifecycle-http";
import {
  PAGE_LIFECYCLE_MUTATION_IPC_CHANNEL,
  PAGE_LIFECYCLE_PREFLIGHT_IPC_CHANNEL,
  registerPageLifecycleIpcHandler,
  registerPageLifecyclePreflightIpcHandler,
} from "./page-lifecycle-ipc";
import type { PageLifecyclePreflightResult } from "../shared/page-lifecycle-runtime";

const request = (session: string, actorKind: string) => ({
  version: 1,
  operationId: "page-lifecycle-transport-retry",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  clientSessionId: session,
  actor: { kind: actorKind, isAdmin: true },
  operation: {
    kind: "archive_page",
    pageId: "card-1",
    expectedMetadataRevision: 2,
  },
});

describe("Page lifecycle IPC/HTTP transport", () => {
  test("replaces spoofed audit identity at both trusted host boundaries", async () => {
    const received: PageLifecycleMutationRequest[] = [];
    const apply = async (
      input: PageLifecycleMutationRequest,
    ): Promise<PageLifecycleMutationCommandResult> => {
      received.push(input);
      return {
        ok: false,
        error: {
          code: "page_lifecycle_conflict",
          message: "test boundary",
          retryable: false,
          operationId: input.operationId,
          pageId: input.operation.pageId,
        },
      };
    };
    const handlers = new Map<
      string,
      (
        event: unknown,
        projectId: string,
        rawRequest: unknown,
      ) => Promise<PageLifecycleMutationCommandResult>
    >();
    registerPageLifecycleIpcHandler({
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
    await handlers.get(PAGE_LIFECYCLE_MUTATION_IPC_CHANNEL)?.(
      "trusted",
      "project-1",
      request("spoofed-ipc", "admin"),
    );

    const app = new Hono();
    registerPageLifecycleHttpRoute(app, { applyMutation: apply });
    const response = await app.request(
      "/api/projects/project-1/page-lifecycle-mutations",
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
    expect(received[1]?.clientSessionId === undefined).toBe(true);
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
      ) => Promise<PageLifecycleMutationCommandResult>
    >();
    registerPageLifecycleIpcHandler({
      registerHandle: (channel, listener) => handlers.set(channel, listener),
      getTrustedIdentity: () => null,
      applyMutation: async () => {
        calls += 1;
        throw new Error("not reached");
      },
    });
    const ipc = await handlers.get(PAGE_LIFECYCLE_MUTATION_IPC_CHANNEL)?.(
      "untrusted",
      "project-1",
      request("spoofed", "admin"),
    );
    expect(ipc?.ok).toBe(false);

    const app = new Hono();
    registerPageLifecycleHttpRoute(app, {
      applyMutation: async () => {
        calls += 1;
        throw new Error("not reached");
      },
    });
    const response = await app.request(
      "/api/projects/project-2/page-lifecycle-mutations",
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
    const result: PageLifecyclePreflightResult = {
      ok: false,
      error: {
        code: "page_not_found",
        message: "Page does not exist",
        retryable: false,
      },
    };
    const reads: string[] = [];
    const readPreflight = async (
      projectId: string,
      pageId: string,
    ): Promise<PageLifecyclePreflightResult> => {
      reads.push(`${projectId}:${pageId}`);
      return result;
    };
    const handlers = new Map<
      string,
      (
        event: unknown,
        projectId: string,
        pageId: string,
      ) => Promise<PageLifecyclePreflightResult>
    >();
    registerPageLifecyclePreflightIpcHandler({
      registerHandle: (channel, listener) => handlers.set(channel, listener),
      readPreflight,
    });
    const ipc = await handlers.get(PAGE_LIFECYCLE_PREFLIGHT_IPC_CHANNEL)?.(
      {},
      "project-1",
      "card-1",
    );
    expect(ipc?.ok).toBe(false);

    const app = new Hono();
    registerPageLifecyclePreflightHttpRoute(app, { readPreflight });
    const response = await app.request(
      "/api/projects/project-1/page-lifecycle-preflight?pageId=card-1",
    );
    expect(response.status).toBe(404);
    const http = (await response.json()) as PageLifecyclePreflightResult;
    expect(http.ok).toBe(false);
    expect(reads.join(",")).toBe("project-1:card-1,project-1:card-1");
  });
});
