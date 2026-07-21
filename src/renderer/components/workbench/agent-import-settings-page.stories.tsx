import type { Meta, StoryObj } from "@storybook/react-vite";
import type { AgentImportScan } from "../../../shared/agent-import";
import {
  AgentImportSettingsPage,
  type AgentImportSettingsRuntime,
} from "./agent-import-settings-page";

const scan: AgentImportScan = {
  expiresAt: Date.now() + 600_000,
  items: [
    {
      count: 12,
      defaultSelected: true,
      description: "Copy 12 recent conversations into Nodex-owned history.",
      id: "sessions",
      kind: "sessions",
      label: "Recent conversations",
    },
    {
      count: 4,
      defaultSelected: true,
      description: "Import 4 missing skills without replacing existing skills.",
      id: "skills",
      kind: "skills",
      label: "Skills",
    },
    {
      count: 2,
      defaultSelected: false,
      description: "Import missing MCP server definitions. Credentials are never copied.",
      id: "mcp",
      kind: "mcpServers",
      label: "MCP servers",
    },
  ],
  scanId: "storybook-scan",
  skippedAlreadyImportedSessions: 3,
  sourceHome: "/Users/demo/.codex",
  sourceKind: "codex",
  sourceLabel: "Codex",
};

const runtime: AgentImportSettingsRuntime = {
  apply: async () => ({
    completedAt: Date.now(),
    importId: "storybook-import",
    importedThreadIds: ["thread-1", "thread-2"],
    outcomes: [
      {
        failureCount: 0,
        itemId: "sessions",
        kind: "sessions",
        label: "Recent conversations",
        messages: [],
        skippedCount: 0,
        successCount: 12,
      },
    ],
    sourceKind: "codex",
    sourceLabel: "Codex",
    startedAt: Date.now() - 1_000,
  }),
  scan: async () => scan,
  scanPickedHome: async () => scan,
  subscribeProgress: () => () => undefined,
};

const meta = {
  args: {
    open: true,
    runtime,
  },
  component: AgentImportSettingsPage,
  decorators: [
    (Story) => (
      <div className="h-[760px] w-[760px] overflow-hidden bg-token-main-surface-primary">
        <Story />
      </div>
    ),
  ],
  title: "Workbench/Settings/Agent import",
} satisfies Meta<typeof AgentImportSettingsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sources: Story = {};
