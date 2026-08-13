import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";
import type { CodexConnectionState } from "../../shared/types";
import type { CodexAppServerClientPort, CodexServerRequest } from "./codex-app-server-client";
import { CodexAppServerClientRouter } from "./codex-app-server-client-router";

function fakeClient(label: string): CodexAppServerClientPort & {
  request: ReturnType<typeof vi.fn>;
} {
  const emitter = new EventEmitter() as CodexAppServerClientPort & {
    request: ReturnType<typeof vi.fn>;
  };
  emitter.dispose = vi.fn(async () => undefined);
  emitter.getInitializeResponse = vi.fn(() => null);
  emitter.getState = vi.fn((): CodexConnectionState => ({ status: "connected", retries: 0 }));
  emitter.notify = vi.fn(async () => undefined);
  emitter.request = vi.fn(async (method: string) => `${label}:${method}`);
  emitter.setServerRequestHandler = vi.fn((handler: (request: CodexServerRequest) => Promise<unknown>) => {
    void handler;
  });
  emitter.start = vi.fn(async () => undefined);
  emitter.stop = vi.fn(async () => undefined);
  return emitter;
}

describe("CodexAppServerClientRouter", () => {
  test("routes thread requests by canonical execution host and keeps global requests local", async () => {
    const local = fakeClient("local");
    const remote = fakeClient("remote");
    const router = new CodexAppServerClientRouter({
      localHostId: "local",
      localClient: local,
      resolveThreadHostId: (threadId) => threadId === "remote-thread" ? "ssh:build" : "local",
    });
    router.register("ssh:build", remote);

    await expect(router.request("thread/read", { threadId: "remote-thread", includeTurns: false }))
      .resolves.toBe("remote:thread/read");
    await expect(router.request("config/read", { cwd: "/remote-looking/path" }))
      .resolves.toBe("local:config/read");
    expect(remote.request).toHaveBeenCalledTimes(1);
    expect(local.request).toHaveBeenCalledTimes(1);
  });

  test("supports an explicit destination before Core commits the new host", async () => {
    const local = fakeClient("local");
    const remote = fakeClient("remote");
    const router = new CodexAppServerClientRouter({
      localHostId: "local",
      localClient: local,
      resolveThreadHostId: () => "local",
    });
    router.register("ssh:build", remote);

    await expect(router.requestOnHost("ssh:build", "thread/resume", { threadId: "task" }))
      .resolves.toBe("remote:thread/resume");
    expect(local.request).not.toHaveBeenCalled();
  });

  test("forwards remote notifications without replacing local connection state", () => {
    const local = fakeClient("local");
    const remote = fakeClient("remote");
    const router = new CodexAppServerClientRouter({
      localHostId: "local",
      localClient: local,
      resolveThreadHostId: () => null,
    });
    router.register("ssh:build", remote);
    const notification = vi.fn();
    const connection = vi.fn();
    const hostConnection = vi.fn();
    router.on("notification", notification);
    router.on("connection", connection);
    router.on("hostConnection", hostConnection);

    remote.emit("notification", { method: "thread/started" });
    remote.emit("connection", { status: "connected", retries: 0 });
    local.emit("connection", { status: "connected", retries: 0 });

    expect(notification).toHaveBeenCalledOnce();
    expect(connection).toHaveBeenCalledOnce();
    expect(hostConnection).toHaveBeenCalledWith({
      hostId: "ssh:build",
      connection: { status: "connected", retries: 0 },
    });
  });
});
