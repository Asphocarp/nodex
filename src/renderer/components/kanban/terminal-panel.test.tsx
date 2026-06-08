import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render } from "../../test/dom";

let useTerminalCalls: unknown[] = [];

mock.module("@/lib/use-terminal", () => ({
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
      <TerminalPanel
        terminalId="terminal-test"
        panelHeight={240}
      />,
    );

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
        panelHeight={240}
      />,
    );

    expect(JSON.stringify(useTerminalCalls[0])).toBe(JSON.stringify({
      terminalId: "terminal-test",
      visible: true,
      cwd: "/Users/asc/repo/nodex",
    }));
  });

  test("omits blank cwd so the PTY uses its process default", async () => {
    const { TerminalPanel } = await import("./terminal-panel");
    render(
      <TerminalPanel
        terminalId="terminal-test"
        cwd="   "
        panelHeight={240}
      />,
    );

    expect(JSON.stringify(useTerminalCalls[0])).toBe(JSON.stringify({
      terminalId: "terminal-test",
      visible: true,
    }));
  });
});
