import { describe, expect, test, vi } from "vitest";
import type { FrozenNodexAgentTurnAuthority } from "../../shared/nodex-agent-authority";
import type { RendererClientRouter } from "../codex/renderer-client-router";
import {
  NodexAgentAuthorizationBroker,
  type AuthorizeNodexAgentAccessInput,
} from "./authorization-broker";

const authority: FrozenNodexAgentTurnAuthority = {
  threadId: "thread-child",
  turnId: "turn-child",
  rootThreadId: "thread-root",
  actorProjectId: "project-1",
  libraryId: "library-1",
  storeEpoch: "store-1",
  scope: "project",
  source: "project_turn",
};

function authorizationInput(
  overrides: Partial<AuthorizeNodexAgentAccessInput> = {},
): AuthorizeNodexAgentAccessInput {
  const requirement = {
    intent: {
      target: { kind: "page" as const, pageId: "page-1" },
      action: "write" as const,
    },
    grant: {
      root: { kind: "page" as const, pageId: "page-1" },
      access: "read_write" as const,
    },
    reason: "grant_missing" as const,
    persistable: true,
  };
  return {
    threadId: authority.threadId,
    callId: "call-1",
    projectId: authority.actorProjectId,
    tool: "update_page",
    effect: "write",
    preview: {
      title: "Update Page",
      summary: "Append two Blocks.",
      details: [{ label: "Page", value: "page-1" }],
    },
    requirements: [requirement],
    inspectionAccess: {
      kind: "inspection",
      scope: "call",
      threadId: authority.threadId,
      turnId: authority.turnId,
      callId: "call-1",
      rootThreadId: authority.rootThreadId,
      actorProjectId: authority.actorProjectId,
      libraryId: authority.libraryId,
      storeEpoch: authority.storeEpoch,
      grants: [requirement.grant],
    },
    rootThreadId: authority.rootThreadId,
    authority,
    presentation: {
      clientId: "renderer-1",
      threadId: "thread-root",
      turnId: "turn-root",
    },
    ...overrides,
  };
}

function createRouter(
  decisions: Array<"allow_once" | "allow_task" | "allow_project" | "deny">,
) {
  const sendRequest = vi.fn(async () => ({
    decision: decisions.shift() ?? "deny",
  }));
  return {
    router: { sendRequest } as Pick<RendererClientRouter, "sendRequest">,
    sendRequest,
  };
}

describe("NodexAgentAuthorizationBroker", () => {
  test("stores task-scoped grants for only the approved resource roots", async () => {
    const { router, sendRequest } = createRouter(["allow_task"]);
    const broker = new NodexAgentAuthorizationBroker({
      rendererClientRouter: router,
      sessionEpoch: "session-1",
      readStoreEpoch: () => "store-1",
      now: () => 42,
    });

    await expect(broker.authorize(authorizationInput())).resolves.toMatchObject({
      decision: "allow_task",
      resourceAccess: {
        kind: "consent",
        scope: "task",
        grants: [{
          root: { kind: "page", pageId: "page-1" },
          access: "read_write",
        }],
      },
    });
    expect(broker.getTaskAccess(authority)).toMatchObject({
      scope: "task",
      grants: [{ root: { kind: "page", pageId: "page-1" } }],
    });
    broker.extendTaskAccess(authority, [{
      root: { kind: "page", pageId: "page-created" },
      access: "read_write",
    }]);
    expect(broker.getTaskAccess(authority)?.grants).toEqual([
      { root: { kind: "page", pageId: "page-1" }, access: "read_write" },
      { root: { kind: "page", pageId: "page-created" }, access: "read_write" },
    ]);
    expect(sendRequest).toHaveBeenCalledWith(
      "renderer-1",
      "nodex-agent-authorization",
      expect.objectContaining({
        threadId: "thread-root",
        turnId: "turn-root",
        itemId: "call-1",
        createdAt: 42,
      }),
      { timeoutMs: 300_000 },
    );
  });

  test("keeps destructive resource grants task-scoped when the user chooses that scope", async () => {
    const { router } = createRouter(["allow_task"]);
    const broker = new NodexAgentAuthorizationBroker({
      rendererClientRouter: router,
      readStoreEpoch: () => "store-1",
    });

    await expect(broker.authorize(authorizationInput({
      effect: "destructive",
    }))).resolves.toMatchObject({
      decision: "allow_task",
      resourceAccess: { scope: "task" },
    });
  });

  test("persists Project grants only for persistable roots", async () => {
    const persistProjectGrants = vi.fn(async () => undefined);
    const { router } = createRouter(["allow_project"]);
    const broker = new NodexAgentAuthorizationBroker({
      rendererClientRouter: router,
      readStoreEpoch: () => "store-1",
      persistProjectGrants,
    });

    await expect(broker.authorize(authorizationInput())).resolves.toEqual({
      decision: "allow_project",
    });
    expect(persistProjectGrants).toHaveBeenCalledWith({
      authority,
      grants: [{
        root: { kind: "page", pageId: "page-1" },
        access: "read_write",
      }],
    });
  });

  test("keeps a Project-approved Library destination call-local until resulting Pages exist", async () => {
    const persistProjectGrants = vi.fn(async () => undefined);
    const { router } = createRouter(["allow_project"]);
    const broker = new NodexAgentAuthorizationBroker({
      rendererClientRouter: router,
      readStoreEpoch: () => "store-1",
      persistProjectGrants,
    });
    const libraryGrant = {
      root: { kind: "library" as const, libraryId: "library-1" },
      access: "read_write" as const,
      libraryActions: ["create_child" as const],
    };

    await expect(broker.authorize(authorizationInput({
      tool: "create_pages",
      requirements: [{
        intent: {
          target: { kind: "library", libraryId: "library-1" },
          action: "create_child",
        },
        grant: libraryGrant,
        reason: "library_consent_required",
        persistable: false,
      }],
      inspectionAccess: {
        ...authorizationInput().inspectionAccess,
        grants: [libraryGrant],
      },
    }))).resolves.toMatchObject({
      decision: "allow_project",
      resourceAccess: {
        scope: "call",
        persistResultingPageGrants: true,
        grants: [libraryGrant],
      },
    });
    expect(persistProjectGrants).not.toHaveBeenCalled();
  });

  test("does not persist a Project grant after exact-Turn authority changes", async () => {
    const persistProjectGrants = vi.fn(async () => undefined);
    const { router } = createRouter(["allow_project"]);
    const broker = new NodexAgentAuthorizationBroker({
      rendererClientRouter: router,
      readStoreEpoch: () => "store-1",
      persistProjectGrants,
    });

    await expect(broker.authorize(authorizationInput({
      isAuthorityCurrent: async () => false,
    }))).resolves.toBe("unavailable");
    expect(persistProjectGrants).not.toHaveBeenCalled();
  });

  test("rechecks async exact-Turn authority after Project persistence", async () => {
    const persistProjectGrants = vi.fn(async () => undefined);
    const { router } = createRouter(["allow_project"]);
    const broker = new NodexAgentAuthorizationBroker({
      rendererClientRouter: router,
      readStoreEpoch: () => "store-1",
      persistProjectGrants,
    });
    const isAuthorityCurrent = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(broker.authorize(authorizationInput({
      isAuthorityCurrent,
    }))).resolves.toBe("unavailable");
    expect(persistProjectGrants).toHaveBeenCalledTimes(1);
    expect(isAuthorityCurrent).toHaveBeenCalledTimes(2);
  });

  test("does not bind task grants to the renderer that presented the card", async () => {
    let storeEpoch = "store-1";
    const { router } = createRouter(["allow_task", "allow_task"]);
    const broker = new NodexAgentAuthorizationBroker({
      rendererClientRouter: router,
      readStoreEpoch: () => storeEpoch,
    });

    await broker.authorize(authorizationInput());
    broker.revokePresentationClient("renderer-1");
    expect(broker.getTaskAccess(authority)).toBeDefined();

    broker.revokeRoot("thread-root");
    expect(broker.getTaskAccess(authority)).toBeUndefined();

    await broker.authorize(authorizationInput());
    storeEpoch = "store-2";
    expect(broker.getTaskAccess(authority)).toBeUndefined();
  });

  test("fails closed without presentation, stable store identity, or Project persistence", async () => {
    const { router, sendRequest } = createRouter(["allow_project"]);
    const missingStore = new NodexAgentAuthorizationBroker({
      rendererClientRouter: router,
      readStoreEpoch: () => null,
    });
    await expect(missingStore.authorize(authorizationInput())).resolves.toBe(
      "unavailable",
    );
    expect(sendRequest).not.toHaveBeenCalled();

    const noPresentation = new NodexAgentAuthorizationBroker({
      rendererClientRouter: router,
      readStoreEpoch: () => "store-1",
    });
    await expect(noPresentation.authorize(authorizationInput({
      presentation: null,
    }))).resolves.toBe("unavailable");

    await expect(noPresentation.authorize(authorizationInput())).resolves.toBe(
      "unavailable",
    );
  });

  test("uses independent opaque occurrences for concurrent prompts", async () => {
    const pending: Array<(value: unknown) => void> = [];
    const sentRequests: unknown[] = [];
    const sendRequest = vi.fn(async (
      _clientId: string,
      _method: string,
      request: unknown,
    ) => await new Promise<unknown>((resolve) => {
      sentRequests.push(request);
      pending.push(resolve);
    }));
    const broker = new NodexAgentAuthorizationBroker({
      rendererClientRouter: { sendRequest } as Pick<RendererClientRouter, "sendRequest">,
      readStoreEpoch: () => "store-1",
    });

    const first = broker.authorize(authorizationInput({ callId: "call-1" }));
    const second = broker.authorize(authorizationInput({ callId: "call-2" }));
    await vi.waitFor(() => expect(sendRequest).toHaveBeenCalledTimes(2));
    const firstRequest = sentRequests[0] as { requestId?: string };
    const secondRequest = sentRequests[1] as { requestId?: string };
    expect(firstRequest.requestId).not.toBe(secondRequest.requestId);
    pending[0]?.({ decision: "allow_once" });
    pending[1]?.({ decision: "deny" });
    await expect(first).resolves.toMatchObject({ decision: "allow_once" });
    await expect(second).resolves.toBe("deny");
  });
});
