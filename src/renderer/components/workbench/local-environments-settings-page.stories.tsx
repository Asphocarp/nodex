import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fireEvent, getAllByRole, getByRole, waitFor } from "@testing-library/dom";
import { NodexSettingsPageSurface } from "@/components/ui/settings";
import { queryKeys } from "@/lib/query-keys";
import type {
  Project,
  WorktreeEnvironmentDefinition,
  WorktreeEnvironmentSettingsSnapshot,
} from "@/lib/types";
import { createTestQueryClient, TestQueryProvider } from "@/test/query";
import { LocalEnvironmentEditor } from "./local-environment-editor";
import { LocalEnvironmentsSettingsPage } from "./local-environments-settings-page";

const PROJECTS: Project[] = [
  {
    id: "project-alpha",
    libraryId: "library:test",
    databaseId: "database:test:primary",
    defaultDatabaseViewId: "view:test:primary",
    lifecycle: "active",
    bindingRevision: 1,
    name: "Alpha",
    description: "",
    appearance: { color: "blue", marker: { kind: "icon", icon: "terminal" } },
    sources: [{ root: "/Users/asc/repo/alpha", order: 0 }],
    primaryWorkspaceRoot: "/Users/asc/repo/alpha",
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-03-01T00:00:00.000Z"),
    updated: new Date("2026-03-01T00:00:00.000Z"),
  },
  {
    id: "project-beta",
    libraryId: "library:test",
    databaseId: "database:test:primary",
    defaultDatabaseViewId: "view:test:primary",
    lifecycle: "active",
    bindingRevision: 1,
    name: "Beta",
    description: "",
    appearance: { color: "orange", marker: { kind: "icon", icon: "flask" } },
    sources: [{ root: "/Users/asc/repo/beta", order: 0 }],
    primaryWorkspaceRoot: "/Users/asc/repo/beta",
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-03-02T00:00:00.000Z"),
    updated: new Date("2026-03-02T00:00:00.000Z"),
  },
];

const ENVIRONMENT: WorktreeEnvironmentDefinition = {
  version: 1,
  name: "Alpha environment",
  setup: {
    script:
      'cd "$CODEX_WORKTREE_PATH"\npip install -r requirements.txt\nnpm install\n./run/setup.sh',
    platformScripts: {
      linux: "pnpm install --frozen-lockfile",
      win32: "python -m pip install -r requirements.txt\npnpm install",
    },
  },
  cleanup: { script: null, platformScripts: {} },
  actions: [
    { name: "Run tests", icon: "test", command: "bun test\n--watch", platform: null },
    { name: "Debug app", icon: "debug", command: "bun run dev", platform: "darwin" },
  ],
};

function buildSnapshot(
  project = PROJECTS[0],
  overrides: Partial<WorktreeEnvironmentSettingsSnapshot> = {},
): WorktreeEnvironmentSettingsSnapshot {
  const environment = overrides.environment === undefined ? ENVIRONMENT : overrides.environment;
  const config = {
    configPath: ".codex/environments/environment.toml",
    fileName: "environment.toml",
    state: environment ? ("success" as const) : ("parseError" as const),
    exists: true,
    name: environment?.name ?? "environment.toml",
    hasSetupScript: Boolean(environment?.setup.script),
    hasCleanupScript: Boolean(environment?.cleanup.script),
    actionCount: environment?.actions.length ?? 0,
    parseErrorMessage: environment ? null : "Expected a TOML value",
    readErrorMessage: null,
    environment,
  };
  return {
    projectId: project.id,
    projectName: project.name,
    workspacePath: project.primaryWorkspaceRoot ?? "",
    configPath: config.configPath,
    nextConfigPath: ".codex/environments/environment-2.toml",
    configExists: true,
    revision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    configs: [config],
    environment,
    parseErrorMessage: config.parseErrorMessage,
    readErrorMessage: null,
    ...overrides,
  };
}

function PageStory({
  workspace = false,
  snapshot = buildSnapshot(),
  narrow = false,
}: {
  workspace?: boolean;
  snapshot?: WorktreeEnvironmentSettingsSnapshot;
  narrow?: boolean;
}) {
  const [client] = useState(() => {
    const nextClient = createTestQueryClient();
    for (const project of PROJECTS) {
      const projectSnapshot =
        project.id === snapshot.projectId
          ? snapshot
          : buildSnapshot(project, {
              environment: { ...ENVIRONMENT, name: `${project.name} environment` },
            });
      nextClient.setQueryData(
        queryKeys.localEnvironments.configs(project.id),
        projectSnapshot.configs,
      );
      nextClient.setQueryData(
        queryKeys.localEnvironments.config(project.id, projectSnapshot.configPath),
        projectSnapshot,
      );
    }
    return nextClient;
  });

  return (
    <div className={narrow ? "h-[800px] w-[1100px]" : "h-[1232px] w-full"}>
      <TestQueryProvider client={client}>
        <LocalEnvironmentsSettingsPage
          open
          active
          projects={PROJECTS}
          activeProjectId={snapshot.projectId}
          initialProjectId={workspace ? null : snapshot.projectId}
          initialConfigPath={workspace ? null : snapshot.configPath}
          onAddProject={() => {}}
          renderShell={({ title, subtitle, backSlot, action, children }) => (
            <NodexSettingsPageSurface
              title={title}
              subtitle={subtitle}
              backSlot={backSlot}
              action={action}
            >
              {children}
            </NodexSettingsPageSurface>
          )}
        />
      </TestQueryProvider>
    </div>
  );
}

function EditorStory({
  conflict = false,
  environment = ENVIRONMENT,
  narrow = false,
  saveError = false,
  saving = false,
}: {
  conflict?: boolean;
  environment?: WorktreeEnvironmentDefinition;
  narrow?: boolean;
  saveError?: boolean;
  saving?: boolean;
}) {
  return (
    <div className={narrow ? "h-[800px] w-[1100px]" : "h-[1232px] w-full"}>
      <NodexSettingsPageSurface
        title="Edit local environment"
        backSlot={
          <span className="text-sm text-token-text-secondary">Environments › Alpha › edit</span>
        }
      >
        <LocalEnvironmentEditor
          environment={environment}
          onSave={async () => {
            if (saveError) throw new Error("Story save failure");
            if (saving) await new Promise<never>(() => {});
            return { type: conflict ? "conflict" : "success" };
          }}
          onSaved={() => {}}
          onDiscard={() => {}}
        />
      </NodexSettingsPageSurface>
    </div>
  );
}

const meta = {
  title: "Workbench/Settings/Local Environments",
  component: LocalEnvironmentsSettingsPage,
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    active: true,
    projects: PROJECTS,
    activeProjectId: PROJECTS[0].id,
  },
} satisfies Meta<typeof LocalEnvironmentsSettingsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WorkspaceList: Story = { render: () => <PageStory workspace /> };
export const SummaryDefault: Story = { render: () => <PageStory /> };
export const SummaryPlatformFallback: Story = {
  render: () => <PageStory />,
  play: async ({ canvasElement }) => {
    await waitFor(() => getByRole(canvasElement, "button", { name: "macOS" }));
    fireEvent.click(getByRole(canvasElement, "button", { name: "macOS" }));
  },
};
export const SummaryActionExpanded: Story = {
  render: () => <PageStory />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      getByRole(canvasElement, "button", { name: "Show full command for Run tests" }),
    );
    fireEvent.click(
      getByRole(canvasElement, "button", { name: "Show full command for Run tests" }),
    );
  },
};
export const ParseError: Story = {
  render: () => <PageStory snapshot={buildSnapshot(PROJECTS[0], { environment: null })} />,
};
export const ReadError: Story = {
  render: () => (
    <PageStory
      snapshot={buildSnapshot(PROJECTS[0], {
        environment: null,
        revision: null,
        parseErrorMessage: null,
        readErrorMessage: "The environment file could not be read.",
      })}
    />
  ),
};
export const TooLarge: Story = {
  render: () => (
    <PageStory
      snapshot={buildSnapshot(PROJECTS[0], {
        environment: null,
        revision: null,
        parseErrorMessage: null,
        tooLargeMessage: "Environment file is too large",
      })}
    />
  ),
};
export const EditorDefault: Story = { render: () => <EditorStory /> };
export const EditorBottom: Story = {
  render: () => <EditorStory />,
  play: async ({ canvasElement }) => {
    getByRole(canvasElement, "button", { name: "Save" }).scrollIntoView({ block: "end" });
  },
};
export const VariablesOpen: Story = {
  render: () => <EditorStory />,
  play: async ({ canvasElement }) => {
    fireEvent.click(getByRole(canvasElement, "button", { name: "Variables" }));
  },
};
export const MacOSEmptyOverride: Story = {
  render: () => <EditorStory />,
  play: async ({ canvasElement }) => {
    fireEvent.click(getAllByRole(canvasElement, "button", { name: "macOS" })[0]!);
  },
};
export const NameFocused: Story = {
  render: () => <EditorStory />,
  play: async ({ canvasElement }) => {
    getAllByRole(canvasElement, "textbox", { name: "Name" })[0]!.focus();
  },
};
export const NameMissing: Story = {
  render: () => <EditorStory />,
  play: async ({ canvasElement }) => {
    fireEvent.change(getAllByRole(canvasElement, "textbox", { name: "Name" })[0]!, {
      target: { value: "" },
    });
  },
};
export const ActionIncompleteName: Story = {
  render: () => (
    <EditorStory
      environment={{
        ...ENVIRONMENT,
        actions: [{ name: "", icon: null, command: "", platform: null }],
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    fireEvent.change(getByRole(canvasElement, "textbox", { name: "Action script" }), {
      target: { value: "pnpm test" },
    });
  },
};
export const ActionIncompleteCommand: Story = {
  render: () => (
    <EditorStory
      environment={{
        ...ENVIRONMENT,
        actions: [{ name: "", icon: null, command: "", platform: null }],
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    fireEvent.change(getAllByRole(canvasElement, "textbox", { name: "Name" })[1]!, {
      target: { value: "Run checks" },
    });
  },
};
export const BlankActionAdded: Story = {
  render: () => <EditorStory />,
  play: async ({ canvasElement }) => {
    fireEvent.click(getByRole(canvasElement, "button", { name: "Add action" }));
  },
};
export const IconMenuOpen: Story = {
  render: () => <EditorStory />,
  play: async ({ canvasElement }) => {
    fireEvent.pointerDown(getAllByRole(canvasElement, "button", { name: "Test" })[0]!, {
      button: 0,
    });
  },
};
export const Conflict: Story = {
  render: () => <EditorStory conflict />,
  play: async ({ canvasElement }) => {
    const name = getAllByRole(canvasElement, "textbox", { name: "Name" })[0]!;
    fireEvent.change(name, { target: { value: "Conflicting draft" } });
    fireEvent.click(getByRole(canvasElement, "button", { name: "Save" }));
    await waitFor(() => getByRole(canvasElement, "button", { name: "Discard edits" }));
  },
};
export const SaveError: Story = {
  render: () => <EditorStory saveError />,
  play: async ({ canvasElement }) => {
    fireEvent.change(getAllByRole(canvasElement, "textbox", { name: "Name" })[0]!, {
      target: { value: "Unsaved environment" },
    });
    fireEvent.click(getByRole(canvasElement, "button", { name: "Save" }));
    await waitFor(() => getByRole(canvasElement, "button", { name: "Retry save" }));
  },
};
export const Saving: Story = {
  render: () => <EditorStory saving />,
  play: async ({ canvasElement }) => {
    fireEvent.change(getAllByRole(canvasElement, "textbox", { name: "Name" })[0]!, {
      target: { value: "Saving environment" },
    });
    fireEvent.click(getByRole(canvasElement, "button", { name: "Save" }));
    await waitFor(() => {
      if (canvasElement.querySelector("form")?.getAttribute("aria-busy") !== "true") {
        throw new Error("Editor is not saving yet");
      }
    });
  },
};
export const Narrow: Story = { render: () => <EditorStory narrow /> };
