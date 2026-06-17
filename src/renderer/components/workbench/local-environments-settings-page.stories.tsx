import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import type {
  Project,
  UpdateWorktreeEnvironmentConfigInput,
  WorktreeEnvironmentSettingsSnapshot,
} from "@/lib/types";
import { LocalEnvironmentsSettingsPage } from "./local-environments-settings-page";
import { NodexSettingsPageSurface as SettingsPageSurface } from "../ui/settings";

const PROJECTS: Project[] = [
  {
    id: "project-alpha",
    name: "Alpha",
    description: "",
    sources: [{ root: "/Users/asc/repo/alpha", order: 0 }],
    primaryWorkspaceRoot: "/Users/asc/repo/alpha",
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-03-01T00:00:00.000Z"),
    updated: new Date("2026-03-01T00:00:00.000Z"),
  },
  {
    id: "project-beta",
    name: "Beta",
    description: "",
    sources: [{ root: "/Users/asc/repo/beta", order: 0 }],
    primaryWorkspaceRoot: "/Users/asc/repo/beta",
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-03-02T00:00:00.000Z"),
    updated: new Date("2026-03-02T00:00:00.000Z"),
  },
];

function buildSnapshot(projectId: string, overrides?: Partial<WorktreeEnvironmentSettingsSnapshot>): WorktreeEnvironmentSettingsSnapshot {
  const project = PROJECTS.find((candidate) => candidate.id === projectId) ?? PROJECTS[0];

  return {
    projectId: project.id,
    projectName: project.name,
    workspacePath: project.primaryWorkspaceRoot ?? "",
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
        actionCount: 2,
        parseErrorMessage: null,
        readErrorMessage: null,
        environment: {
          version: 1,
          name: `${project.name} env`,
          setup: {
            script: "bun install\nbun run build",
            platformScripts: {
              darwin: "brew bundle",
            },
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
            {
              id: "action-2",
              name: "Debug app",
              icon: "debug",
              command: "bun run dev",
              platform: "darwin",
            },
          ],
        },
      },
      {
        configPath: ".codex/environments/release.toml",
        fileName: "release.toml",
        state: "success",
        exists: true,
        name: `${project.name} release`,
        hasSetupScript: true,
        hasCleanupScript: false,
        actionCount: 1,
        parseErrorMessage: null,
        readErrorMessage: null,
        environment: {
          version: 1,
          name: `${project.name} release`,
          setup: {
            script: "bun install --frozen-lockfile\nbun run build",
            platformScripts: {},
          },
          cleanup: {
            script: "",
            platformScripts: {},
          },
          actions: [
            {
              id: "action-release",
              name: "Build release",
              icon: "run",
              command: "bun run build",
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
        platformScripts: {
          darwin: "brew bundle",
        },
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
        {
          id: "action-2",
          name: "Debug app",
          icon: "debug",
          command: "bun run dev",
          platform: "darwin",
        },
      ],
    },
    parseErrorMessage: null,
    readErrorMessage: null,
    ...overrides,
  };
}

function LocalEnvironmentsStory({
  initialProjectId,
  initialConfigPath,
  snapshots,
  autoAction,
}: {
  initialProjectId?: string | null;
  initialConfigPath?: string | null;
  snapshots: Record<string, WorktreeEnvironmentSettingsSnapshot>;
  autoAction?: "edit" | "env-vars";
}) {
  const [snapshotMap, setSnapshotMap] = useState(snapshots);

  useEffect(() => {
    if (!autoAction) {
      return;
    }

    let cancelled = false;

    const clickButtonByText = (text: string): boolean => {
      const targetButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === text,
      );
      if (!targetButton) {
        return false;
      }
      targetButton.click();
      return true;
    };

    const runAutoAction = () => {
      if (cancelled) {
        return;
      }

      if (autoAction === "edit") {
        clickButtonByText("Edit local environment");
        return;
      }

      if (clickButtonByText("Available environment variables")) {
        return;
      }

      if (clickButtonByText("Edit local environment")) {
        window.setTimeout(runAutoAction, 50);
      }
    };

    const timeoutId = window.setTimeout(runAutoAction, 50);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [autoAction]);

  return (
    <div className="min-h-[720px] rounded-[24px] border border-(--border) bg-token-side-bar-background p-5 shadow-[0_18px_48px_rgba(0,0,0,0.16)]">
      <LocalEnvironmentsSettingsPage
        open={true}
        active={true}
        projects={PROJECTS}
        activeProjectId={initialProjectId ?? PROJECTS[0].id}
        initialProjectId={initialProjectId}
        initialConfigPath={initialConfigPath}
        onAddProject={() => { }}
        renderShell={({ title, subtitle, backSlot, children }) => (
          <div className="h-[760px] overflow-hidden rounded-[20px]">
            <SettingsPageSurface title={title} subtitle={subtitle} backSlot={backSlot}>
              {children}
            </SettingsPageSurface>
          </div>
        )}
        service={{
          listConfigs: async (projectId) => (snapshotMap[projectId] ?? buildSnapshot(projectId)).configs,
          readConfig: async (projectId, configPath) => {
            const baseSnapshot = snapshotMap[projectId] ?? buildSnapshot(projectId);
            if (configPath && configPath !== baseSnapshot.configPath) {
              return {
                ...baseSnapshot,
                configPath,
                configExists: false,
                environment: null,
              };
            }
            return baseSnapshot;
          },
          saveConfig: async (input: UpdateWorktreeEnvironmentConfigInput) => {
            const nextSnapshot = buildSnapshot(input.projectId, {
              environment: input.environment,
              configs: [
                {
                  configPath: input.configPath,
                  fileName: "environment.toml",
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
            setSnapshotMap((current) => ({
              ...current,
              [input.projectId]: nextSnapshot,
            }));
            return nextSnapshot;
          },
        }}
      />
    </div>
  );
}

const meta = {
  title: "Workbench/Settings/Local Environments",
  component: LocalEnvironmentsStory,
  args: {
    initialProjectId: "project-alpha",
    initialConfigPath: null,
    snapshots: {
      "project-alpha": buildSnapshot("project-alpha"),
      "project-beta": buildSnapshot("project-beta"),
    },
  },
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Local-environments settings flow reconstructed from Codex Electron: project workspace selection, config summary, and structured editing for setup/cleanup/actions.",
      },
    },
  },
} satisfies Meta<typeof LocalEnvironmentsStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Summary: Story = {
  args: {
    initialProjectId: "project-alpha",
    initialConfigPath: null,
    snapshots: {
      "project-alpha": buildSnapshot("project-alpha"),
      "project-beta": buildSnapshot("project-beta"),
    },
  },
  render: () => (
    <LocalEnvironmentsStory
      initialProjectId="project-alpha"
      snapshots={{
        "project-alpha": buildSnapshot("project-alpha"),
        "project-beta": buildSnapshot("project-beta"),
      }}
    />
  ),
};

export const Workspace: Story = {
  render: () => (
    <LocalEnvironmentsStory
      initialProjectId={null}
      snapshots={{
        "project-alpha": buildSnapshot("project-alpha"),
        "project-beta": buildSnapshot("project-beta"),
      }}
    />
  ),
};

export const WorkspaceMultiConfigList: Story = {
  render: () => (
    <LocalEnvironmentsStory
      initialProjectId={null}
      snapshots={{
        "project-alpha": buildSnapshot("project-alpha"),
        "project-beta": buildSnapshot("project-beta", {
          configs: [
            {
              configPath: ".codex/environments/environment.toml",
              fileName: "environment.toml",
              state: "success",
              exists: true,
              name: "Beta base",
              hasSetupScript: true,
              hasCleanupScript: false,
              actionCount: 1,
              parseErrorMessage: null,
              readErrorMessage: null,
              environment: null,
            },
            {
              configPath: ".codex/environments/staging.toml",
              fileName: "staging.toml",
              state: "success",
              exists: true,
              name: "Beta staging",
              hasSetupScript: true,
              hasCleanupScript: true,
              actionCount: 2,
              parseErrorMessage: null,
              readErrorMessage: null,
              environment: null,
            },
            {
              configPath: ".codex/environments/mobile.toml",
              fileName: "mobile.toml",
              state: "parseError",
              exists: true,
              name: "mobile",
              hasSetupScript: false,
              hasCleanupScript: false,
              actionCount: 0,
              parseErrorMessage: "Unexpected token at line 4",
              readErrorMessage: null,
              environment: null,
            },
          ],
        }),
      }}
    />
  ),
};

export const ParseError: Story = {
  args: {
    initialProjectId: "project-beta",
    initialConfigPath: null,
    snapshots: {
      "project-alpha": buildSnapshot("project-alpha"),
      "project-beta": buildSnapshot("project-beta", {
        configExists: true,
        parseErrorMessage: "Unexpected token at line 8",
        environment: null,
        configs: [
          {
            configPath: ".codex/environments/environment.toml",
            fileName: "environment.toml",
            state: "parseError",
            exists: true,
            name: "environment",
            hasSetupScript: false,
            hasCleanupScript: false,
            actionCount: 0,
            parseErrorMessage: "Unexpected token at line 8",
            readErrorMessage: null,
            environment: null,
          },
        ],
      }),
    },
  },
  render: () => (
    <LocalEnvironmentsStory
      initialProjectId="project-beta"
      snapshots={{
        "project-alpha": buildSnapshot("project-alpha"),
        "project-beta": buildSnapshot("project-beta", {
          configExists: true,
          parseErrorMessage: "Unexpected token at line 8",
          environment: null,
          configs: [
            {
              configPath: ".codex/environments/environment.toml",
              fileName: "environment.toml",
              state: "parseError",
              exists: true,
              name: "environment",
              hasSetupScript: false,
              hasCleanupScript: false,
              actionCount: 0,
              parseErrorMessage: "Unexpected token at line 8",
              readErrorMessage: null,
              environment: null,
            },
          ],
        }),
      }}
    />
  ),
};

export const CreateNewConfig: Story = {
  args: {
    initialProjectId: "project-alpha",
    initialConfigPath: ".codex/environments/environment-2.toml",
    snapshots: {
      "project-alpha": buildSnapshot("project-alpha", {
        configPath: ".codex/environments/environment-2.toml",
        configExists: false,
        environment: null,
        nextConfigPath: ".codex/environments/environment-2.toml",
      }),
      "project-beta": buildSnapshot("project-beta"),
    },
  },
  render: () => (
    <LocalEnvironmentsStory
      initialProjectId="project-alpha"
      initialConfigPath=".codex/environments/environment-2.toml"
      snapshots={{
        "project-alpha": buildSnapshot("project-alpha", {
          configPath: ".codex/environments/environment-2.toml",
          configExists: false,
          environment: null,
          nextConfigPath: ".codex/environments/environment-2.toml",
        }),
        "project-beta": buildSnapshot("project-beta"),
      }}
    />
  ),
};

export const Edit: Story = {
  render: () => (
    <LocalEnvironmentsStory
      initialProjectId="project-alpha"
      snapshots={{
        "project-alpha": buildSnapshot("project-alpha"),
        "project-beta": buildSnapshot("project-beta"),
      }}
      autoAction="edit"
    />
  ),
};

export const EnvironmentVariablesPopover: Story = {
  render: () => (
    <LocalEnvironmentsStory
      initialProjectId="project-alpha"
      snapshots={{
        "project-alpha": buildSnapshot("project-alpha"),
        "project-beta": buildSnapshot("project-beta"),
      }}
      autoAction="env-vars"
    />
  ),
};
