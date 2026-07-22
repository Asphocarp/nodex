import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  TERMINAL_RENDERER_BUFFER_LIMIT,
  TerminalSessionStore,
} from "./terminal-session-store";
import type {
  TerminalAttachedEvent,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSessionSnapshot,
} from "../../shared/types";

const originalApi = window.api;

function makeSnapshot(input: Partial<TerminalSessionSnapshot> & { sessionId: string }): TerminalSessionSnapshot {
  return {
    sessionId: input.sessionId,
    conversationId: input.conversationId ?? null,
    projectSessionId: input.projectSessionId ?? null,
    osPid: input.osPid ?? null,
    cpuPercent: input.cpuPercent ?? null,
    rssKb: input.rssKb ?? null,
    childProcessCount: input.childProcessCount ?? null,
    processMetricsSampledAtMs: input.processMetricsSampledAtMs ?? null,
    cwd: input.cwd ?? null,
    shell: input.shell ?? "/bin/zsh",
    title: input.title ?? null,
    backendKind: input.backendKind ?? "local",
    buffer: input.buffer ?? "",
    truncated: input.truncated ?? false,
    exited: input.exited ?? false,
    exitCode: input.exitCode ?? null,
  };
}

function installTerminalApiMock() {
  const listeners: Record<string, (payload: unknown) => void> = {};
  const calls: unknown[] = [];
  window.api = {
    invoke: async (channel: string, ...args: unknown[]) => {
      calls.push([channel, ...args]);
      return undefined;
    },
    on: (event: string, callback: (...args: unknown[]) => void) => {
      listeners[event] = (payload: unknown) => callback(payload);
      return () => {
        delete listeners[event];
      };
    },
  };
  return { calls, listeners };
}

describe("TerminalSessionStore", () => {
  beforeEach(() => {
    window.api = originalApi;
  });

  afterEach(() => {
    window.api = originalApi;
  });

  test("queues writes until the terminal is attached", async () => {
    const { calls, listeners } = installTerminalApiMock();
    const store = new TerminalSessionStore();

    await store.createOrAttach({
      sessionId: "session:one:terminal:1",
      conversationId: "thread-1",
      projectSessionId: "session-1",
      cwd: "/repo",
      size: { cols: 80, rows: 24 },
    });
    store.write("session:one:terminal:1", "pwd\r");

    listeners["terminal-attached"]?.({
      sessionId: "session:one:terminal:1",
      snapshot: makeSnapshot({
        sessionId: "session:one:terminal:1",
        conversationId: "thread-1",
        projectSessionId: "session-1",
        cwd: "/repo",
      }),
    } satisfies TerminalAttachedEvent);

    expect(JSON.stringify(calls)).toBe(JSON.stringify([
      [
        "terminal-create",
        {
          sessionId: "session:one:terminal:1",
          conversationId: "thread-1",
          projectSessionId: "session-1",
          cwd: "/repo",
          size: { cols: 80, rows: 24 },
        },
      ],
      ["terminal-write", "session:one:terminal:1", "pwd\r"],
    ]));
  });

  test("uses cwd basename before terminal fallback title", () => {
    const { listeners } = installTerminalApiMock();
    const store = new TerminalSessionStore();
    store.ensureEventSubscriptions();

    listeners["terminal-attached"]?.({
      sessionId: "session:one:terminal:2",
      snapshot: makeSnapshot({
        sessionId: "session:one:terminal:2",
        cwd: "/Users/asc/repo/nodex",
      }),
    } satisfies TerminalAttachedEvent);

    expect(store.resolveTitle("session:one:terminal:2", "Terminal", 2)).toBe("nodex");
  });

  test("keeps the latest renderer terminal buffer within the Codex limit", () => {
    const { listeners } = installTerminalApiMock();
    const store = new TerminalSessionStore();
    store.ensureEventSubscriptions();

    listeners["terminal-data"]?.({
      sessionId: "session:one:terminal:3",
      data: "a".repeat(TERMINAL_RENDERER_BUFFER_LIMIT + 12),
    } satisfies TerminalDataEvent);

    const snapshot = store.getSnapshot("session:one:terminal:3");
    expect(snapshot.buffer.length).toBe(TERMINAL_RENDERER_BUFFER_LIMIT);
    expect(snapshot.truncated).toBe(true);
  });

  test("runs terminal actions and fetches buffered snapshots", async () => {
    const { calls } = installTerminalApiMock();
    const store = new TerminalSessionStore();

    await store.runAction({
      sessionId: "process:thread:item:action",
      conversationId: "thread-action",
      cwd: "/repo",
      command: "bun run dev",
      title: "bun run dev",
    });
    const snapshot = await store.fetchSnapshot("process:thread:item:action");

    expect(JSON.stringify(calls)).toBe(JSON.stringify([
      [
        "terminal-run-action",
        {
          sessionId: "process:thread:item:action",
          conversationId: "thread-action",
          cwd: "/repo",
          command: "bun run dev",
          title: "bun run dev",
        },
      ],
      ["terminal-session:snapshot", "process:thread:item:action"],
    ]));
    expect(snapshot === null).toBe(true);
  });

  test("does not invalidate global tab-title subscribers for terminal output chunks", () => {
    const { listeners } = installTerminalApiMock();
    const store = new TerminalSessionStore();
    let versionEvents = 0;
    store.ensureEventSubscriptions();
    store.subscribeAll(() => {
      versionEvents += 1;
    });

    listeners["terminal-data"]?.({
      sessionId: "session:one:terminal:4",
      data: "prompt",
    } satisfies TerminalDataEvent);

    expect(store.getSnapshot("session:one:terminal:4").buffer).toBe("prompt");
    expect(versionEvents).toBe(0);
  });

  test("closes an explicit terminal runtime at most once", () => {
    const { calls, listeners } = installTerminalApiMock();
    const store = new TerminalSessionStore();

    store.close("session:one:terminal:close-once");
    listeners["terminal-exit"]?.({
      sessionId: "session:one:terminal:close-once",
      exitCode: 0,
    } satisfies TerminalExitEvent);
    store.close("session:one:terminal:close-once");

    expect(JSON.stringify(calls)).toBe(JSON.stringify([
      ["terminal-close", "session:one:terminal:close-once"],
    ]));
  });

  test("preserves session buffer while renderer subscribers detach and reattach", () => {
    const { calls, listeners } = installTerminalApiMock();
    const store = new TerminalSessionStore();
    store.ensureEventSubscriptions();

    listeners["terminal-attached"]?.({
      sessionId: "session:one:terminal:reattach",
      snapshot: makeSnapshot({
        sessionId: "session:one:terminal:reattach",
        buffer: "before detach\n",
      }),
    } satisfies TerminalAttachedEvent);
    const unsubscribe = store.subscribe("session:one:terminal:reattach", () => undefined);
    unsubscribe();

    listeners["terminal-data"]?.({
      sessionId: "session:one:terminal:reattach",
      data: "while detached\n",
    } satisfies TerminalDataEvent);

    expect(store.getSnapshot("session:one:terminal:reattach").buffer).toBe(
      "before detach\nwhile detached\n",
    );
    expect(calls.some((call) => (call as unknown[])[0] === "terminal-close")).toBe(false);
  });

  test("notifies exit subscribers and removes renderer session state", () => {
    const { listeners } = installTerminalApiMock();
    const store = new TerminalSessionStore();
    const exitEvents: unknown[] = [];
    store.ensureEventSubscriptions();
    store.subscribeExit((event) => {
      exitEvents.push(event);
    });

    listeners["terminal-attached"]?.({
      sessionId: "session:one:terminal:5",
      snapshot: makeSnapshot({
        sessionId: "session:one:terminal:5",
        cwd: "/Users/asc/repo/nodex",
      }),
    } satisfies TerminalAttachedEvent);

    listeners["terminal-exit"]?.({
      sessionId: "session:one:terminal:5",
      exitCode: 0,
    } satisfies TerminalExitEvent);

    expect(JSON.stringify(exitEvents)).toBe(JSON.stringify([
      { sessionId: "session:one:terminal:5", exitCode: 0 },
    ]));
    expect(store.resolveTitle("session:one:terminal:5", "Terminal", 5)).toBe("Terminal 5");
  });
});
