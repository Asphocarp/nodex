import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { NodexButton } from "@/components/ui/button";
import type { CodexPendingWorktreeEntry } from "../../../shared/codex-pending-worktree";
import { StableWorktreeCreateDialog } from "./stable-worktree-create-dialog";
import {
  StableWorktreeStatusDialog,
  type StableWorktreeStatusDialogTransport,
} from "./stable-worktree-status-dialog";
import { StableWorktreeSidebarRows } from "./stable-worktree-sidebar-row";

type StableWorktreeEntry = Extract<
  CodexPendingWorktreeEntry,
  { readonly launchMode: "create-stable-worktree" }
>;

function makeEntry(
  overrides: Partial<StableWorktreeEntry> = {},
): StableWorktreeEntry {
  return {
    id: "local:stable-story",
    hostId: "local",
    label: "Nodex persistent project",
    sourceWorkspaceRoot: "/Users/asc/repo/nodex",
    startingState: { type: "branch", branchName: "HEAD" },
    localEnvironmentConfigPath: null,
    prompt:
      "Create a new git worktree from HEAD, add it as a project, and keep it until you remove it",
    launchMode: "create-stable-worktree",
    startConversationParamsInput: null,
    sourceConversationId: null,
    sourceCollaborationMode: null,
    createdAt: Date.now(),
    attempt: 1,
    phase: "creating",
    labelEdited: false,
    worktreeOutputText:
      "[info] Starting worktree creation\nPreparing worktree (detached HEAD 7e3ad91)\n",
    setupOutputText: "",
    errorMessage: null,
    worktreeWorkspaceRoot: null,
    worktreeGitRoot: null,
    needsAttention: false,
    isPinned: false,
    pinnedBeforeThreadId: null,
    ...overrides,
  };
}

function makeTransport(
  entry: StableWorktreeEntry,
): StableWorktreeStatusDialogTransport {
  return {
    list: async () => [entry],
    subscribe: () => () => undefined,
    clearAttention: async () => undefined,
    cancel: async () => undefined,
    autoFix: async () => ({
      pendingWorktreeId: "local:stable-story-repair",
      clientThreadId: "client-new-thread:stable-story-repair",
    }),
    retry: async () => undefined,
  };
}

const creatingEntry = makeEntry();
const creatingTransport = makeTransport(creatingEntry);
const failedEntry = makeEntry({
  phase: "failed",
  localEnvironmentConfigPath: "/Users/asc/repo/nodex/.codex/environments/default.toml",
  worktreeWorkspaceRoot: "/Users/asc/.codex/worktrees/7e3a/nodex",
  worktreeGitRoot: "/Users/asc/.codex/worktrees/7e3a/nodex",
  worktreeOutputText: "[info] Worktree created\n",
  setupOutputText:
    "bun install v1.2.18\nerror: postinstall script failed with exit code 1\n",
  errorMessage: "Local environment setup exited with status 1",
  needsAttention: true,
});
const failedTransport = makeTransport(failedEntry);
const failedWithoutAutoFixEntry = makeEntry({
  ...failedEntry,
  id: "local:stable-story-no-config",
  localEnvironmentConfigPath: null,
});
const failedWithoutAutoFixTransport = makeTransport(failedWithoutAutoFixEntry);

function CreateDialogStory() {
  const [open, setOpen] = useState(true);
  const [createdName, setCreatedName] = useState("");

  return (
    <StorySurface
      open={open}
      onOpen={() => setOpen(true)}
      status={createdName ? `Created ${createdName}` : "No project created"}
    >
      <StableWorktreeCreateDialog
        open={open}
        initialProjectName="Nodex worktree"
        onOpenChange={setOpen}
        onCreate={(projectName) => {
          setCreatedName(projectName);
        }}
      />
    </StorySurface>
  );
}

function StorySurface({
  open,
  onOpen,
  status,
  children,
}: {
  open: boolean;
  onOpen: () => void;
  status: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-token-main-surface-primary p-8 text-token-foreground">
      <div className="flex items-center gap-3">
        <NodexButton size="sm" disabled={open} onClick={onOpen}>
          Open dialog
        </NodexButton>
        <span className="text-sm text-token-description-foreground">{status}</span>
      </div>
      {children}
    </div>
  );
}

function StatusDialogStory({
  entry,
  transport,
}: {
  entry: StableWorktreeEntry;
  transport: StableWorktreeStatusDialogTransport;
}) {
  const [open, setOpen] = useState(true);

  return (
    <StorySurface
      open={open}
      onOpen={() => setOpen(true)}
      status={open ? "Dialog open" : "Dialog closed"}
    >
      {open ? (
        <StableWorktreeStatusDialog
          pendingWorktreeId={entry.id}
          transport={transport}
          onClose={() => setOpen(false)}
          onEditEnvironment={() => setOpen(false)}
          onOpenPendingWorktree={() => setOpen(false)}
        />
      ) : null}
    </StorySurface>
  );
}

function ProjectsSidebarStory() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-token-main-surface-primary p-8 text-token-foreground">
      <aside className="w-72 rounded-xl bg-token-sidebar-surface-primary p-2">
        <div className="mb-1 px-2 text-xs font-medium text-token-description-foreground">
          Projects
        </div>
        <StableWorktreeSidebarRows
          entries={[creatingEntry]}
          onOpen={setSelectedId}
        />
        <div className="flex h-token-nav-row items-center px-2 text-sm">
          Nodex
        </div>
      </aside>
      {selectedId ? (
        <StableWorktreeStatusDialog
          pendingWorktreeId={selectedId}
          transport={creatingTransport}
          onClose={() => setSelectedId(null)}
          onEditEnvironment={() => setSelectedId(null)}
          onOpenPendingWorktree={() => setSelectedId(null)}
        />
      ) : null}
    </div>
  );
}

const meta = {
  title: "Workbench/Stable Worktree Dialogs",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Create: Story = {
  render: () => <CreateDialogStory />,
};

export const Creating: Story = {
  render: () => (
    <StatusDialogStory entry={creatingEntry} transport={creatingTransport} />
  ),
};

export const SetupFailed: Story = {
  render: () => (
    <StatusDialogStory entry={failedEntry} transport={failedTransport} />
  ),
};

export const SetupFailedWithoutAutoFix: Story = {
  render: () => (
    <StatusDialogStory
      entry={failedWithoutAutoFixEntry}
      transport={failedWithoutAutoFixTransport}
    />
  ),
};

export const ProjectsSidebarPendingStableWorktree: Story = {
  render: () => <ProjectsSidebarStory />,
};
