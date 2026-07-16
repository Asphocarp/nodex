import { describe, expect, test, vi } from "vitest";
import type { RendererClientRouter } from "../codex/renderer-client-router";
import {
  NodexAgentAuthorizationBroker,
  type AuthorizeNodexAgentWriteInput,
} from "./authorization-broker";

function authorizationInput(
  overrides: Partial<AuthorizeNodexAgentWriteInput> = {},
): AuthorizeNodexAgentWriteInput {
  return {
    threadId: "thread-child",
    callId: "call-1",
    projectId: "project-1",
    tool: "update_page",
    effect: "write",
    preview: {
      title: "Update Page",
      summary: "Append two Blocks.",
      details: [{ label: "Page", value: "page-1" }],
    },
    rootThreadId: "thread-root",
    ownerClientId: "renderer-1",
    presentationThreadId: "thread-root",
    presentationTurnId: "turn-root",
    ...overrides,
  };
}

function createRouter(decisions: Array<"allow_once" | "allow_task" | "deny">) {
  const sendRequest = vi.fn(async () => ({
    decision: decisions.shift() ?? "deny",
  }));
  return {
    router: { sendRequest } as Pick<RendererClientRouter, "sendRequest">,
    sendRequest,
  };
}

describe("NodexAgentAuthorizationBroker", () => {
  test("grants ordinary writes to the root task and reuses the grant for descendants", async () => {
    const { router, sendRequest } = createRouter(["allow_task"]);
    const broker = new NodexAgentAuthorizationBroker({
      rendererClientRouter: router,
      sessionEpoch: "session-1",
      readStoreEpoch: () => "store-1",
      now: () => 42,
    });

    await expect(broker.authorize(authorizationInput())).resolves.toBe("allow_task");
    await expect(broker.authorize(authorizationInput({
      threadId: "thread-grandchild",
      callId: "call-2",
    }))).resolves.toBe("allow_task");

    expect(sendRequest).toHaveBeenCalledTimes(1);
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
    expect(broker.hasGrant({
      rootThreadId: "thread-root",
      projectId: "project-1",
    })).toBe(true);
  });

  test("always re-prompts destructive edits and never broadens them into task grants", async () => {
    const { router, sendRequest } = createRouter(["allow_task", "allow_task"]);
    const broker = new NodexAgentAuthorizationBroker({
      rendererClientRouter: router,
      readStoreEpoch: () => "store-1",
    });

    await broker.authorize(authorizationInput());
    await expect(broker.authorize(authorizationInput({
      callId: "call-destructive",
      effect: "destructive",
    }))).resolves.toBe("allow_once");

    expect(sendRequest).toHaveBeenCalledTimes(2);
  });

  test("fails closed without a visible owner or stable store identity", async () => {
    const { router, sendRequest } = createRouter(["allow_once"]);
    const broker = new NodexAgentAuthorizationBroker({
      rendererClientRouter: router,
      readStoreEpoch: () => null,
    });

    await expect(broker.authorize(authorizationInput())).resolves.toBe("unavailable");
    await expect(broker.authorize(authorizationInput({
      ownerClientId: null,
    }))).resolves.toBe("unavailable");
    expect(sendRequest).not.toHaveBeenCalled();
  });

  test("revokes grants by owner, root task, and store epoch", async () => {
    let storeEpoch = "store-1";
    const { router } = createRouter(["allow_task", "allow_task", "allow_task"]);
    const broker = new NodexAgentAuthorizationBroker({
      rendererClientRouter: router,
      readStoreEpoch: () => storeEpoch,
    });

    await broker.authorize(authorizationInput());
    broker.revokeOwner("renderer-1");
    expect(broker.hasGrant({ rootThreadId: "thread-root", projectId: "project-1" })).toBe(false);

    await broker.authorize(authorizationInput());
    broker.revokeRoot("thread-root");
    expect(broker.hasGrant({ rootThreadId: "thread-root", projectId: "project-1" })).toBe(false);

    await broker.authorize(authorizationInput());
    storeEpoch = "store-2";
    expect(broker.hasGrant({ rootThreadId: "thread-root", projectId: "project-1" })).toBe(false);
  });

  test("revokes the former Project grant when a root task is rebound", async () => {
    const { router } = createRouter(["allow_task"]);
    const broker = new NodexAgentAuthorizationBroker({
      rendererClientRouter: router,
      readStoreEpoch: () => "store-1",
    });

    await broker.authorize(authorizationInput());
    expect(broker.hasGrant({
      rootThreadId: "thread-root",
      projectId: "project-2",
    })).toBe(false);
    expect(broker.hasGrant({
      rootThreadId: "thread-root",
      projectId: "project-1",
    })).toBe(false);
  });

  test("uses independent opaque occurrences for concurrent prompts and fails closed on routing errors", async () => {
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
    await expect(first).resolves.toBe("allow_once");
    await expect(second).resolves.toBe("deny");

    const unavailable = new NodexAgentAuthorizationBroker({
      rendererClientRouter: {
        sendRequest: async () => {
          throw new Error("renderer request timed out");
        },
      },
      readStoreEpoch: () => "store-1",
    });
    await expect(unavailable.authorize(authorizationInput())).resolves.toBe("unavailable");
  });
});
