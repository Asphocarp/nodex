import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { Project } from "@/lib/types";
import { SettingsOverlay } from "./workbench-settings-overlay";
import { buildSettingsPath } from "./workbench-settings-routes";

const PROJECTS: Project[] = [
  {
    id: "default",
    name: "Nodex",
    description: "",
    workspacePath: "/Users/asc/repo/nodex",
    created: new Date("2026-03-01T00:00:00.000Z"),
  },
];

function ensureStorybookElectronBridge() {
  if (typeof window === "undefined") return;

  window.api = {
    invoke: async (channel: string) => {
      switch (channel) {
        case "settings:thread-notifications:get":
          return { threadCompletionEnabled: true };
        case "settings:app-updates:get":
          return { automaticChecksEnabled: true };
        case "app:update:status":
          return {
            status: "idle",
            supported: true,
            currentVersion: "0.1.0",
            availableVersion: null,
            releaseName: null,
            releaseDate: null,
            releaseNotes: null,
            progressPercent: null,
            transferredBytes: null,
            totalBytes: null,
            checkedAt: null,
            message: null,
          };
        case "worktrees:managed:list":
          return [];
        case "backups:list":
          return [];
        case "backups:settings:get":
          return {
            scheduleEnabled: false,
            scheduleHours: 24,
            retentionLimit: 25,
            maxManualSnapshots: 10,
            lastRunAt: null,
          };
        case "history:settings:get":
          return {
            retentionCount: 1000,
            envOverrides: {},
          };
        default:
          return null;
      }
    },
    on: () => () => {},
  } as typeof window.api;
}

function SettingsOverlayStory({
  initialPath,
}: {
  initialPath: string;
}) {
  const [open, setOpen] = useState(true);
  const [path, setPath] = useState(initialPath);
  ensureStorybookElectronBridge();

  return (
    <div className="min-h-screen bg-(--background)">
      <SettingsOverlay
        open={open}
        onOpenChange={setOpen}
        path={path}
        onPathChange={setPath}
        projects={PROJECTS}
        activeProjectId="default"
        initialLocalEnvironmentProjectId="default"
        initialLocalEnvironmentConfigPath=".codex/environments/environment.toml"
        sidebarTopLevelSectionOrder={["files", "threads", "recents", "cards"]}
        sidebarTopLevelSections={{
          files: { visible: true, itemLimit: 10 },
          threads: { visible: true, itemLimit: 10 },
          recents: { visible: true, itemLimit: 10 },
          cards: { visible: true, itemLimit: 10 },
        }}
        onSidebarTopLevelSectionVisibleChange={() => {}}
        stageRailLayoutMode="full-rail"
        onStageRailLayoutModeChange={() => {}}
        nextPanelPeekPx={28}
        onNextPanelPeekPxChange={() => {}}
        threadQueueFollowUpsEnabled={true}
        onThreadQueueFollowUpsEnabledChange={() => {}}
        composerEnterBehavior="cmdIfMultiline"
        onComposerEnterBehaviorChange={() => {}}
        worktreeStartMode="autoBranch"
        onWorktreeStartModeChange={() => {}}
        worktreeAutoBranchPrefix="nodex/"
        onWorktreeAutoBranchPrefixChange={() => {}}
        smartPrefixParsingEnabled={true}
        onSmartPrefixParsingEnabledChange={() => {}}
        stripSmartPrefixFromTitleEnabled={true}
        onStripSmartPrefixFromTitleEnabledChange={() => {}}
      />
    </div>
  );
}

const meta = {
  title: "Workbench/Settings/Overlay",
  component: SettingsOverlayStory,
  args: {
    initialPath: buildSettingsPath("general-settings"),
  },
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Codex-style tab-based settings shell for Nodex. The left rail selects a single section page instead of scrolling within one monolithic settings document.",
      },
    },
  },
} satisfies Meta<typeof SettingsOverlayStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const General: Story = {
  render: () => <SettingsOverlayStory initialPath={buildSettingsPath("general-settings")} />,
};

export const LocalEnvironments: Story = {
  render: () => <SettingsOverlayStory initialPath={buildSettingsPath("local-environments")} />,
};

export const InvalidSectionRedirect: Story = {
  render: () => <SettingsOverlayStory initialPath="/settings/not-real" />,
};
