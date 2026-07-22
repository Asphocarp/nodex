import { beforeEach, describe, expect, vi, test } from "vitest";
import { render } from "../../test/dom";

let useTerminalCalls: unknown[] = [];

vi.mock("@/lib/use-terminal", () => ({
  useTerminal: (options: unknown) => {
    useTerminalCalls.push(options);
    return {
      containerRef: { current: null },
      isUnavailable: true,
    };
  },
}));

describe("TerminalPanel", () => {
  beforeEach(() => {
    useTerminalCalls = [];
  });

  test("renders the terminal surface without the redundant session header row", async () => {
    const { TerminalPanel } = await import("./terminal-panel");
    const { queryByText, getByText } = render(
      <TerminalPanel terminalId="terminal-test" cwd="/Users/asc/repo/nodex" />,
    );

    const terminalRoot = document.querySelector("[data-codex-terminal='true']");
    expect(terminalRoot instanceof HTMLElement).toBe(true);
    expect(terminalRoot?.getAttribute("data-codex-xterm")).toBe("true");
    expect(queryByText("Session Terminal")).toBe(null);
    expect(getByText("Terminal requires the Electron desktop app").textContent)
      .toBe("Terminal requires the Electron desktop app");
  });

  test("passes a normalized cwd into the terminal hook", async () => {
    const { TerminalPanel } = await import("./terminal-panel");
    render(
      <TerminalPanel
        terminalId="terminal-test"
        cwd="  /Users/asc/repo/nodex  "
        conversationId="thread-1"
        projectSessionId="session-1"
      />,
    );

    expect(JSON.stringify(useTerminalCalls[0])).toBe(JSON.stringify({
      terminalId: "terminal-test",
      visible: true,
      cwd: "/Users/asc/repo/nodex",
      conversationId: "thread-1",
      projectSessionId: "session-1",
    }));
  });

  test("blocks blank cwd instead of attaching a PTY with its process default", async () => {
    const { TerminalPanel } = await import("./terminal-panel");
    render(
      <TerminalPanel
        terminalId="terminal-test"
        cwd="   "
      />,
    );

    expect(useTerminalCalls).toHaveLength(0);
    expect(document.body.textContent).toContain("Terminal workspace is unavailable");
  });
});
