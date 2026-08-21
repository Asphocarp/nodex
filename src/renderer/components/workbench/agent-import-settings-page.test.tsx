import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { AgentImportScan } from "../../../shared/agent-import";
import {
  AgentImportSettingsPage,
  type AgentImportSettingsRuntime,
} from "./agent-import-settings-page";

const scan: AgentImportScan = {
  expiresAt: Date.now() + 600_000,
  items: [
    {
      count: 2,
      defaultSelected: true,
      description: "Import recent conversations.",
      id: "sessions",
      kind: "sessions",
      label: "Recent conversations",
    },
    {
      count: 1,
      defaultSelected: false,
      description: "Import a missing MCP server.",
      id: "mcp",
      kind: "mcpServers",
      label: "MCP servers",
    },
  ],
  scanId: "scan-1",
  skippedAlreadyImportedSessions: 1,
  sourceHome: "/tmp/source-codex",
  sourceKind: "codex",
  sourceLabel: "Codex",
};

describe("AgentImportSettingsPage", () => {
  test("previews an explicit scan and applies only selected categories", async () => {
    const apply = vi.fn<AgentImportSettingsRuntime["apply"]>().mockResolvedValue({
      completedAt: 2,
      importId: "import-1",
      importedThreadIds: ["thread-1", "thread-2"],
      outcomes: [
        {
          failureCount: 0,
          itemId: "sessions",
          kind: "sessions",
          label: "Recent conversations",
          messages: [],
          skippedCount: 0,
          successCount: 2,
        },
      ],
      sourceKind: "codex",
      sourceLabel: "Codex",
      startedAt: 1,
    });
    const runtime: AgentImportSettingsRuntime = {
      apply,
      scan: vi.fn().mockResolvedValue(scan),
      scanPickedHome: vi.fn().mockResolvedValue(scan),
      subscribeProgress: () => () => undefined,
    };
    render(<AgentImportSettingsPage open runtime={runtime} />);

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Scan" })[1]!);
      await Promise.resolve();
    });

    expect(await screen.findByText("/tmp/source-codex")).toBeTruthy();
    expect(
      screen
        .getByRole("checkbox", { name: "Import Recent conversations" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByRole("checkbox", { name: "Import MCP servers" }).getAttribute("aria-checked"),
    ).toBe("false");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Import" }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(apply).toHaveBeenCalledWith("scan-1", ["sessions"]);
    });
    expect(await screen.findByText("Codex · 2 imported")).toBeTruthy();
  });
});
