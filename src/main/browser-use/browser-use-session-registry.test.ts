import { describe, expect, test } from "vitest";
import { BrowserSidebarService } from "../browser-sidebar-service";
import type { BrowserUseCdpEvent } from "./browser-use-iab-api";
import {
  BrowserUseSessionRegistry,
  type BrowserUseRouteCapture,
} from "./browser-use-session-registry";

class FakeApi {
  activeControl = false;
  disposed = false;
  readonly endedTurns: string[] = [];

  addCdpEventListener(listener: (event: BrowserUseCdpEvent) => void) {
    void listener;
    return () => undefined;
  }

  async dispatch(method: string): Promise<unknown> {
    return method;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }

  hasActiveControl(): boolean {
    return this.activeControl;
  }

  notifyCursorArrived(moveSequence: number): void {
    void moveSequence;
  }

  async turnEnded(params: unknown): Promise<void> {
    const turnId = (params as { turn_id: string }).turn_id;
    this.endedTurns.push(turnId);
  }
}

class FakeServer {
  readonly broadcasts: Array<[string, unknown]> = [];
  closed = false;
  started = false;

  constructor(readonly pipePath: string) {}

  broadcast(method: string, params?: unknown): void {
    this.broadcasts.push([method, params]);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async start(): Promise<void> {
    this.started = true;
  }
}

function capture(
  overrides: Partial<BrowserUseRouteCapture> = {},
): BrowserUseRouteCapture {
  return {
    browserConversationId: "session-1",
    browserViewScopeId: "window-session-1",
    codexSessionId: "thread-1",
    ownerWebContentsId: 101,
    projectId: "project-1",
    ...overrides,
  };
}

function makeRegistry() {
  const apis: FakeApi[] = [];
  const servers: FakeServer[] = [];
  const registry = new BrowserUseSessionRegistry({
    appVersion: "1.0.0",
    browserService: new BrowserSidebarService(),
    buildFlavor: "dev",
    createApi: () => {
      const api = new FakeApi();
      apis.push(api);
      return api;
    },
    createServer: () => {
      const server = new FakeServer(`/tmp/fake-${servers.length}.sock`);
      servers.push(server);
      return server;
    },
    enabled: true,
    socketPeerAuthorizer: () => ({ authorized: true }),
  });
  return { apis, registry, servers };
}

describe("BrowserUseSessionRegistry", () => {
  test("starts one backend for an exact route and reuses it", async () => {
    const { apis, registry, servers } = makeRegistry();
    const first = await registry.captureRoute(capture());
    const second = await registry.captureRoute(capture());

    expect(first.pipePath).toBe("/tmp/fake-0.sock");
    expect(second.pipePath).toBe(first.pipePath);
    expect(apis).toHaveLength(1);
    expect(servers).toHaveLength(1);
    expect(servers[0]?.started).toBe(true);
    expect(registry.availableBackends()).toEqual(["iab"]);
    await registry.dispose();
  });

  test("rejects route theft while controlled pages are live", async () => {
    const { apis, registry } = makeRegistry();
    await registry.captureRoute(capture());
    apis[0]!.activeControl = true;

    await expect(registry.captureRoute(capture({
      browserViewScopeId: "window-session-2",
      ownerWebContentsId: 202,
    }))).rejects.toThrow("live controlled pages");
    expect(registry.getDebugSnapshot().sessions[0]?.ownerWebContentsId).toBe(101);
    await registry.dispose();
  });

  test("replaces the provisional project-session backend when the Codex session arrives", async () => {
    const { apis, registry, servers } = makeRegistry();
    const provisionalCapture = registry.captureRoute(
      capture({ codexSessionId: "session-1" }),
    );
    const canonicalCapture = registry.captureRoute(
      capture({ codexSessionId: "thread-1" }),
    );
    await Promise.all([provisionalCapture, canonicalCapture]);

    expect(registry.getDebugSnapshot().sessions).toEqual([
      expect.objectContaining({
        browserConversationId: "session-1",
        sessionId: "thread-1",
      }),
    ]);
    expect(apis).toHaveLength(2);
    expect(apis[0]?.disposed).toBe(true);
    expect(servers[0]?.closed).toBe(true);
    expect(servers[1]?.started).toBe(true);
    expect(
      registry.getDebugSnapshot().events.some(
        (event) => event.kind === "provisional-route-rebound",
      ),
    ).toBe(true);
    await registry.dispose();
  });

  test("serializes exact turn completion and ignores stale completion", async () => {
    const { apis, registry } = makeRegistry();
    await registry.captureRoute(capture());
    registry.turnStarted({ sessionId: "thread-1", turnId: "turn-2" });
    await registry.turnEnded({ sessionId: "thread-1", turnId: "turn-1" });
    await registry.turnEnded({ sessionId: "thread-1", turnId: "turn-2" });

    expect(apis[0]?.endedTurns).toEqual(["turn-2"]);
    expect(
      registry.getDebugSnapshot().events.some(
        (event) => event.kind === "stale-turn-end-ignored",
      ),
    ).toBe(true);
    await registry.dispose();
  });

  test("releases all sessions owned by a renderer", async () => {
    const { apis, registry, servers } = makeRegistry();
    await registry.captureRoute(capture());
    await registry.releaseOwner(101);

    expect(registry.getDebugSnapshot().sessions).toEqual([]);
    expect(apis[0]?.disposed).toBe(true);
    expect(servers[0]?.closed).toBe(true);
  });
});
