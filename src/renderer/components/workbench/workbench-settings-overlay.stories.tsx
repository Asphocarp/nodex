import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { CODEX_DEFAULT_SERVICE_TIER_STORAGE_KEY } from "@/lib/codex-service-tier-settings";
import type {
  BackupRecord,
  Project,
  UpdateWorktreeEnvironmentConfigInput,
  WorktreeEnvironmentSettingsSnapshot,
} from "@/lib/types";
import { SettingsRouteShell } from "./workbench-settings-overlay";
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
  backups,
  onDeleteBackup,
  onCreateBackup,
}: {
  snapshots: Record<string, WorktreeEnvironmentSettingsSnapshot>;
  onSaveSnapshot: (input: UpdateWorktreeEnvironmentConfigInput) => WorktreeEnvironmentSettingsSnapshot;
  backups: BackupRecord[];
  onDeleteBackup: (backupId: string) => void;
  onCreateBackup: (label: string | null) => BackupRecord;
}) {
  if (typeof window === "undefined") return;

  window.api = {
    invoke: async (channel: string, ...args: unknown[]) => {
      switch (channel) {
        case "settings:thread-notifications:get":
          return {
            turnMode: "unfocused",
            permissionsEnabled: true,
            questionsEnabled: true,
          };
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
        case "backup:list":
          return backups;
        case "backup:delete": {
          const backupId = typeof args[0] === "string" ? args[0] : "";
          onDeleteBackup(backupId);
          return {
            success: true,
            deletedBackupId: backupId,
          };
        }
        case "backup:create":
          return onCreateBackup(typeof args[0] === "object" && args[0] && "label" in (args[0] as Record<string, unknown>)
            ? typeof (args[0] as { label?: unknown }).label === "string"
              ? (args[0] as { label?: string }).label ?? null
              : null
            : null);
        case "settings:backup:get":
          return {
            autoEnabled: false,
            intervalHours: 24,
            retentionCount: 25,
            envOverrides: {
              autoEnabled: false,
              intervalHours: false,
              retentionCount: false,
            },
          };
        case "settings:history:get":
          return {
            retentionCount: 1000,
            envOverrides: { retentionCount: false },
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

function SettingsRouteShellStory({
  initialPath,
  initialServiceTier = "standard",
}: {
  initialPath: string;
  initialServiceTier?: "standard" | "fast";
}) {
  const [path, setPath] = useState(initialPath);
  const [environmentSnapshots, setEnvironmentSnapshots] = useState<Record<string, WorktreeEnvironmentSettingsSnapshot>>({
    default: buildEnvironmentSnapshot("default"),
  });
  const [backups, setBackups] = useState<BackupRecord[]>([
    {
      version: 1,
      id: "2026-04-15T09-00-00-000Z-story-a",
      createdAt: "2026-04-15T09:00:00.000Z",
      trigger: "manual",
      label: "Before schema cleanup",
      includesAssets: true,
      dbBytes: 2_400_000,
      assetsBytes: 320_000,
      totalBytes: 2_720_000,
    },
    {
      version: 1,
      id: "2026-04-14T18-15-00-000Z-story-b",
      createdAt: "2026-04-14T18:15:00.000Z",
      trigger: "pre-restore",
      label: null,
      includesAssets: true,
      dbBytes: 2_100_000,
      assetsBytes: 300_000,
      totalBytes: 2_400_000,
    },
  ]);
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
    backups,
    onDeleteBackup: (backupId) => {
      setBackups((current) => current.filter((backup) => backup.id !== backupId));
    },
    onCreateBackup: (label) => {
      const backup = {
        version: 1,
        id: `storybook-${backups.length + 1}`,
        createdAt: "2026-04-15T10:30:00.000Z",
        trigger: "manual" as const,
        label,
        includesAssets: true,
        dbBytes: 1024 * 1024,
        assetsBytes: 256 * 1024,
        totalBytes: 1280 * 1024,
      };
      setBackups((current) => [backup, ...current]);
      return backup;
    },
  });

  if (typeof localStorage !== "undefined") {
    if (initialServiceTier === "fast") {
      localStorage.setItem(CODEX_DEFAULT_SERVICE_TIER_STORAGE_KEY, "fast");
    } else {
      localStorage.removeItem(CODEX_DEFAULT_SERVICE_TIER_STORAGE_KEY);
    }
  }

  return (
    <div className="h-screen bg-(--background)">
      <SettingsRouteShell
        path={path}
        onPathChange={setPath}
        onBackToApp={() => {}}
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
  title: "Workbench/Settings/Route Shell",
  component: SettingsRouteShellStory,
  args: {
    initialPath: buildSettingsPath("general-settings"),
  },
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Codex-style route-based settings shell for Nodex. The left rail selects a single section page while the main pane keeps the shared settings surface.",
      },
    },
  },
} satisfies Meta<typeof SettingsRouteShellStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const General: Story = {
  render: () => <SettingsRouteShellStory initialPath={buildSettingsPath("general-settings")} />,
};

export const GeneralFastTier: Story = {
  render: () => (
    <SettingsRouteShellStory
      initialPath={buildSettingsPath("general-settings")}
      initialServiceTier="fast"
    />
  ),
};

export const LocalEnvironments: Story = {
  render: () => <SettingsRouteShellStory initialPath={buildSettingsPath("local-environments")} />,
};

export const Backups: Story = {
  render: () => <SettingsRouteShellStory initialPath={buildSettingsPath("backups")} />,
};

export const InvalidSectionRedirect: Story = {
  render: () => <SettingsRouteShellStory initialPath="/settings/not-real" />,
};

export const NarrowViewport: Story = {
  render: () => (
    <div className="h-screen w-[390px] overflow-hidden border-r border-token-border">
      <SettingsRouteShellStory initialPath={buildSettingsPath("appearance")} />
    </div>
  ),
};
