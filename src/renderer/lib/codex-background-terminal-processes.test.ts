import { describe, expect, test } from "vitest";
import type { ThreadBackgroundTerminal } from "@nodex/codex-app-server-protocol/v2";
import type { CodexBackgroundProcessRow, TerminalSessionSnapshot } from "../../shared/types";
import {
  buildCodexBackgroundTerminalProcessRows,
  formatBackgroundTerminalCpuPercent,
  formatBackgroundTerminalMemoryKb,
  formatBackgroundTerminalPid,
  readBackgroundTerminalCpuPercent,
  readBackgroundTerminalMemoryKb,
} from "./codex-background-terminal-processes";

function terminal(overrides: Partial<ThreadBackgroundTerminal>): ThreadBackgroundTerminal {
  return {
    itemId: "item",
    processId: "process",
    command: "bun run dev",
    cwd: "/tmp",
    osPid: null,
    cpuPercent: null,
    rssKb: null,
    ...overrides,
  };
}

function processRow(
  threadId: string,
  threadTitle: string,
  terminalRow: ThreadBackgroundTerminal | null,
  overrides: Partial<CodexBackgroundProcessRow> = {},
): CodexBackgroundProcessRow {
  const itemId = terminalRow?.itemId ?? "item";
  const processId = terminalRow?.processId ?? "process";
  return {
    id: `${threadId}:${itemId}`,
    threadId,
    threadTitle,
    itemId,
    turnId: null,
    command: terminalRow?.command ?? "bun run preview",
    cwd: terminalRow?.cwd ?? "/tmp",
    processId,
    osPid: terminalRow?.osPid ?? null,
    terminalSessionId: null,
    source: "app-server",
    startedAtMs: 1,
    updatedAtMs: 2,
    status: terminalRow ? "running" : "not-found",
    terminal: terminalRow,
    terminalSession: null,
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
    cwd: "/tmp",
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

describe("codex background terminal process rows", () => {
  test("sorts registered process rows by live CPU, then memory, then chat title", () => {
    const low = terminal({ itemId: "low", processId: "low", cpuPercent: 1, rssKb: 1024n });
    const tieAlpha = terminal({ itemId: "tie-alpha", processId: "tie-alpha", cpuPercent: 10, rssKb: 4096n });
    const top = terminal({ itemId: "top", processId: "top", cpuPercent: 20, rssKb: 1024n });
    const tieBeta = terminal({ itemId: "tie-beta", processId: "tie-beta", cpuPercent: 10, rssKb: 2048n });

    const rows = buildCodexBackgroundTerminalProcessRows(
      [
        { threadId: "thread-a", title: "Alpha" },
        { threadId: "thread-b", title: "Beta" },
      ],
      new Map([
        ["thread-a", [
          processRow("thread-a", "Alpha", low),
          processRow("thread-a", "Alpha", tieAlpha),
          processRow("thread-a", "Alpha", null, {
            id: "thread-a:offline",
            itemId: "offline",
            processId: "offline",
            command: "bun run preview",
          }),
        ]],
        ["thread-b", [
          processRow("thread-b", "Beta", top),
          processRow("thread-b", "Beta", tieBeta),
        ]],
      ]),
    );

    expect(rows.map((row) => row.processId).join(",")).toBe("top,tie-alpha,tie-beta,low,offline");
  });

  test("sorts and reads terminal-action process rows by terminal session metrics", () => {
    const rows = buildCodexBackgroundTerminalProcessRows(
      [
        { threadId: "thread-a", title: "Alpha" },
        { threadId: "thread-b", title: "Beta" },
      ],
      new Map([
        ["thread-a", [
          processRow("thread-a", "Alpha", null, {
            id: "thread-a:local-low",
            itemId: "local-low",
            processId: null,
            terminalSessionId: "terminal-low",
            terminalSession: terminalSession({
              sessionId: "terminal-low",
              cpuPercent: 2,
              rssKb: 4096n,
            }),
          }),
        ]],
        ["thread-b", [
          processRow("thread-b", "Beta", null, {
            id: "thread-b:local-high",
            itemId: "local-high",
            processId: null,
            terminalSessionId: "terminal-high",
            terminalSession: terminalSession({
              sessionId: "terminal-high",
              cpuPercent: 11,
              rssKb: 1024n,
            }),
          }),
        ]],
      ]),
    );

    expect(rows.map((row) => row.terminalSessionId).join(",")).toBe("terminal-high,terminal-low");
    expect(readBackgroundTerminalCpuPercent(rows[0]!)).toBe(11);
    expect(readBackgroundTerminalMemoryKb(rows[1]!)).toBe(4096n);
  });

  test("formats CPU, memory, and PID values from protocol rows", () => {
    expect(formatBackgroundTerminalCpuPercent(12.345)).toBe("12.3%");
    expect(formatBackgroundTerminalCpuPercent(null)).toBe("n/a");
    expect(formatBackgroundTerminalMemoryKb(512n)).toBe("512 KB");
    expect(formatBackgroundTerminalMemoryKb(1536n)).toBe("1.5 MB");
    expect(formatBackgroundTerminalMemoryKb(2_097_152n)).toBe("2.00 GB");
    expect(formatBackgroundTerminalMemoryKb(null)).toBe("n/a");
    expect(formatBackgroundTerminalPid(processRow("thread", "Thread", terminal({ processId: "app-proc", osPid: 4312 })))).toBe("4312");
    expect(formatBackgroundTerminalPid(processRow("thread", "Thread", terminal({ processId: "app-proc", osPid: null })))).toBe("app-proc");
    expect(formatBackgroundTerminalPid(processRow("thread", "Thread", null, { processId: null }))).toBe("n/a");
  });
});
