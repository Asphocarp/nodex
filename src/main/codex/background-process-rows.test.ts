import { describe, expect, test } from "bun:test";
import type { ThreadBackgroundTerminal } from "@nodex/codex-app-server-protocol/v2/ThreadBackgroundTerminal";
import type {
  CodexBackgroundProcessRecord,
  TerminalSessionSnapshot,
} from "../../shared/types";
import { buildCodexBackgroundProcessRow } from "./background-process-rows";

function record(overrides: Partial<CodexBackgroundProcessRecord> = {}): CodexBackgroundProcessRecord {
  return {
    id: "thread:item",
    threadId: "thread",
    threadTitle: "Thread",
    itemId: "item",
    turnId: "turn",
    command: "bun run dev",
    cwd: "/repo",
    processId: null,
    osPid: null,
    terminalSessionId: null,
    source: "terminal-action",
    startedAtMs: 10,
    updatedAtMs: 10,
    ...overrides,
  };
}

function terminal(overrides: Partial<ThreadBackgroundTerminal> = {}): ThreadBackgroundTerminal {
  return {
    itemId: "item",
    processId: "app-process",
    command: "bun run dev",
    cwd: "/repo",
    osPid: 4200,
    cpuPercent: 4.5,
    rssKb: 1024n,
    ...overrides,
  };
}

function terminalSession(overrides: Partial<TerminalSessionSnapshot> = {}): TerminalSessionSnapshot {
  return {
    sessionId: "terminal-session",
    conversationId: "thread",
    projectSessionId: null,
    osPid: 7301,
    cpuPercent: null,
    rssKb: null,
    childProcessCount: null,
    processMetricsSampledAtMs: null,
    cwd: "/repo",
    shell: "/bin/zsh",
    title: "bun run dev",
    backendKind: "local",
    buffer: "",
    truncated: false,
    exited: false,
    exitCode: null,
    ...overrides,
  };
}

describe("buildCodexBackgroundProcessRow", () => {
  test("uses a live terminal session pid for local terminal-action rows", () => {
    const row = buildCodexBackgroundProcessRow({
      record: record({ terminalSessionId: "terminal-session" }),
      terminal: null,
      terminalSession: terminalSession({ osPid: 7301 }),
    });

    expect(row.status).toBe("running");
    expect(row.osPid).toBe(7301);
    expect(row.terminal === null).toBeTrue();
    expect(row.terminalSession?.sessionId).toBe("terminal-session");
  });

  test("preserves terminal-action metrics from a live terminal session", () => {
    const row = buildCodexBackgroundProcessRow({
      record: record({ terminalSessionId: "terminal-session" }),
      terminal: null,
      terminalSession: terminalSession({
        cpuPercent: 12.5,
        rssKb: 8192n,
        childProcessCount: 2,
        processMetricsSampledAtMs: 123,
      }),
    });

    expect(row.status).toBe("running");
    expect(row.terminalSession?.cpuPercent).toBe(12.5);
    expect(row.terminalSession?.rssKb).toBe(8192n);
    expect(row.terminalSession?.childProcessCount).toBe(2);
  });

  test("marks sampled terminal-action rows without child processes as not found", () => {
    const row = buildCodexBackgroundProcessRow({
      record: record({ osPid: 7301, terminalSessionId: "terminal-session" }),
      terminal: null,
      terminalSession: terminalSession({
        childProcessCount: 0,
        processMetricsSampledAtMs: 123,
      }),
    });

    expect(row.status).toBe("not-found");
    expect(row.osPid).toBe(7301);
    expect(row.terminalSession?.sessionId).toBe("terminal-session");
  });

  test("prefers the live app-server terminal pid and does not reuse stale record pid when unknown", () => {
    const withLivePid = buildCodexBackgroundProcessRow({
      record: record({ source: "app-server", processId: "app-process", osPid: 1111 }),
      terminal: terminal({ osPid: 4200 }),
      terminalSession: null,
    });
    const withUnknownLivePid = buildCodexBackgroundProcessRow({
      record: record({ source: "app-server", processId: "app-process", osPid: 1111 }),
      terminal: terminal({ osPid: null }),
      terminalSession: null,
    });

    expect(withLivePid.osPid).toBe(4200);
    expect(withUnknownLivePid.osPid).toBe(null);
  });

  test("treats exited terminal sessions as not found without inventing metrics", () => {
    const row = buildCodexBackgroundProcessRow({
      record: record({ osPid: 7301, terminalSessionId: "terminal-session" }),
      terminal: null,
      terminalSession: terminalSession({ exited: true, exitCode: 0 }),
    });

    expect(row.status).toBe("not-found");
    expect(row.osPid).toBe(7301);
    expect(row.terminalSession === null).toBeTrue();
  });
});
