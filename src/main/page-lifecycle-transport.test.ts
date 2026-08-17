import { describe, expect, test } from "vitest";
import type {
  PageLifecycleMutationCommandResultV2,
  PageLifecycleMutationRequestV2,
} from "../shared/page-lifecycle-v2";
import {
  PAGE_LIFECYCLE_MUTATION_IPC_CHANNEL,
  PAGE_LIFECYCLE_PREFLIGHT_IPC_CHANNEL,
  registerPageLifecycleIpcHandler,
  registerPageLifecyclePreflightIpcHandler,
} from "./page-lifecycle-ipc";
import type { PageLifecyclePreflightResultV2 } from "../shared/page-lifecycle-v2-runtime";

const request = (session: string, actorKind: string) => ({
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

describe("Page lifecycle IPC transport", () => {
  test("replaces spoofed audit identity at the trusted renderer boundary", async () => {
    const received: PageLifecycleMutationRequestV2[] = [];
    const apply = async (
      input: PageLifecycleMutationRequestV2,
    ): Promise<PageLifecycleMutationCommandResultV2> => {
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
      ) => Promise<PageLifecycleMutationCommandResultV2>
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

    expect(received.length).toBe(1);
    expect(received[0]?.actor.kind).toBe("electron");
    expect(received[0]?.actor.webContentsId).toBe(7);
    expect(received[0]?.clientSessionId).toBe("trusted-window-7");
  });

  test("rejects untrusted IPC before enqueue", async () => {
    let calls = 0;
    const handlers = new Map<
      string,
      (
        event: unknown,
        projectId: string,
        rawRequest: unknown,
      ) => Promise<PageLifecycleMutationCommandResultV2>
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

    expect(calls).toBe(0);
  });

  test("serves the typed preflight contract over IPC", async () => {
    const result: PageLifecyclePreflightResultV2 = {
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
    ): Promise<PageLifecyclePreflightResultV2> => {
      reads.push(`${projectId}:${pageId}`);
      return result;
    };
    const handlers = new Map<
      string,
      (
        event: unknown,
        projectId: string,
        pageId: string,
      ) => Promise<PageLifecyclePreflightResultV2>
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

    expect(reads.join(",")).toBe("project-1:card-1");
  });
});
