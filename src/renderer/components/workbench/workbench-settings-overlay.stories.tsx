import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type {
  Project,
  UpdateWorktreeEnvironmentConfigInput,
  WorktreeEnvironmentSettingsSnapshot,
} from "@/lib/types";
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

function buildEnvironmentSnapshot(
  projectId: string,
  overrides?: Partial<WorktreeEnvironmentSettingsSnapshot>,
): WorktreeEnvironmentSettingsSnapshot {
  const project = PROJECTS.find((candidate) => candidate.id === projectId) ?? PROJECTS[0];

  return {
    projectId: project.id,
    projectName: project.name,
    workspacePath: project.workspacePath ?? "",
    configPath: ".codex/environments/environment.toml",
    nextConfigPath: ".codex/environments/environment-2.toml",
    configExists: true,
    configs: [
      {
        configPath: ".codex/environments/environment.toml",
        fileName: "environment.toml",
        state: "success",
        exists: true,
        name: `${project.name} env`,
        hasSetupScript: true,
        hasCleanupScript: true,
        actionCount: 1,
        parseErrorMessage: null,
        readErrorMessage: null,
        environment: {
          version: 1,
          name: `${project.name} env`,
          setup: {
            script: "bun install\nbun run build",
            platformScripts: {},
          },
          cleanup: {
            script: "git clean -fd",
            platformScripts: {},
          },
          actions: [
            {
              id: "action-1",
              name: "Run tests",
              icon: "test",
              command: "bun test",
              platform: null,
            },
          ],
        },
      },
    ],
    environment: {
      version: 1,
      name: `${project.name} env`,
      setup: {
        script: "bun install\nbun run build",
        platformScripts: {},
      },
      cleanup: {
        script: "git clean -fd",
        platformScripts: {},
      },
      actions: [
        {
          id: "action-1",
          name: "Run tests",
          icon: "test",
          command: "bun test",
          platform: null,
        },
      ],
    },
    parseErrorMessage: null,
    readErrorMessage: null,
    ...overrides,
  };
}

function ensureStorybookElectronBridge({
  snapshots,
  onSaveSnapshot,
}: {
  snapshots: Record<string, WorktreeEnvironmentSettingsSnapshot>;
  onSaveSnapshot: (input: UpdateWorktreeEnvironmentConfigInput) => WorktreeEnvironmentSettingsSnapshot;
}) {
  if (typeof window === "undefined") return;

  window.api = {
    invoke: async (channel: string, ...args: unknown[]) => {
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
        case "worktrees:environments:config:read": {
          const projectId = typeof args[0] === "string" ? args[0] : PROJECTS[0].id;
          const configPath = typeof args[1] === "string" ? args[1] : null;
          const baseSnapshot = snapshots[projectId] ?? buildEnvironmentSnapshot(projectId);
          if (configPath && configPath !== baseSnapshot.configPath) {
            return {
              ...baseSnapshot,
              configPath,
              configExists: false,
              environment: null,
            };
          }
          return baseSnapshot;
        }
        case "worktrees:environments:configs:list": {
          const projectId = typeof args[0] === "string" ? args[0] : PROJECTS[0].id;
          return (snapshots[projectId] ?? buildEnvironmentSnapshot(projectId)).configs;
        }
        case "worktrees:environments:config:save":
          return onSaveSnapshot(args[0] as UpdateWorktreeEnvironmentConfigInput);
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
  const [environmentSnapshots, setEnvironmentSnapshots] = useState<Record<string, WorktreeEnvironmentSettingsSnapshot>>({
    default: buildEnvironmentSnapshot("default"),
  });
  ensureStorybookElectronBridge({
    snapshots: environmentSnapshots,
    onSaveSnapshot: (input) => {
      const nextSnapshot = buildEnvironmentSnapshot(input.projectId, {
        configPath: input.configPath,
        configExists: true,
        environment: input.environment,
        configs: [
          {
            configPath: input.configPath,
            fileName: input.configPath.split("/").at(-1) ?? "environment.toml",
            state: "success",
            exists: true,
            name: input.environment.name,
            hasSetupScript: Boolean(input.environment.setup.script),
            hasCleanupScript: Boolean(input.environment.cleanup.script),
            actionCount: input.environment.actions.length,
            parseErrorMessage: null,
            readErrorMessage: null,
            environment: input.environment,
          },
        ],
      });
      setEnvironmentSnapshots((current) => ({
        ...current,
        [input.projectId]: nextSnapshot,
      }));
      return nextSnapshot;
    },
  });

  return (
    <div className="min-h-screen bg-(--background)">
      <SettingsOverlay
        open={open}
        onOpenChange={setOpen}
        path={path}
        onPathChange={setPath}
        onRequestProjectPickerOpen={() => {}}
        projects={PROJECTS}
        activeProjectId="default"
        initialLocalEnvironmentProjectId={null}
        initialLocalEnvironmentConfigPath={null}
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

export const Backups: Story = {
  render: () => <SettingsOverlayStory initialPath={buildSettingsPath("backups")} />,
};

export const InvalidSectionRedirect: Story = {
  render: () => <SettingsOverlayStory initialPath="/settings/not-real" />,
};
