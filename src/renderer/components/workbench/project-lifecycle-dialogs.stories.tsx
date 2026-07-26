import type { Meta, StoryObj } from "@storybook/react-vite";
import { fireEvent, getByRole, waitFor } from "@testing-library/dom";
import type { ReactNode } from "react";
import type { Project } from "@/lib/types";
import { NodexDialog } from "@/components/ui/dialog";
import { CodexProjectActionsMenu } from "./codex-sidebar";
import { ProjectRemoveDialog } from "./project-remove-dialog";
import { RemovedProjectsDialogView } from "./removed-projects-dialog";

const ACTIVE_PROJECT: Project = {
  id: "project-alpha",
  libraryId: "library-story",
  databaseId: "database-alpha",
  defaultDatabaseViewId: "view-alpha",
  lifecycle: "active",
  bindingRevision: 2,
  name: "Nodex desktop",
  description: "",
  icon: "N",
  sources: [{ root: "/Users/asc/repo/nodex2", order: 0 }],
  primaryWorkspaceRoot: "/Users/asc/repo/nodex2",
  pinned: false,
  pinnedOrder: null,
  created: new Date("2026-01-01T00:00:00.000Z"),
  updated: new Date("2026-07-22T00:00:00.000Z"),
};

const REMOVED_PROJECTS: Project[] = [
  { ...ACTIVE_PROJECT, id: "removed-nodex", lifecycle: "archived", bindingRevision: 3 },
  {
    ...ACTIVE_PROJECT,
    id: "removed-long",
    lifecycle: "archived",
    bindingRevision: 7,
    name: "A removed project with a deliberately long name for truncation review",
    icon: "",
    primaryWorkspaceRoot: "/Users/asc/repo/archive/a/very/long/workspace/path/that/should/not/widen/the/dialog",
  },
];

function Surface({ children }: { children: ReactNode }) {
  return (
    <div className="h-screen w-screen bg-token-main-surface-primary p-10 text-token-foreground">
      {children}
    </div>
  );
}

const meta = {
  title: "Workbench/Project Lifecycle",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProjectMenu: Story = {
  render: () => (
    <Surface>
      <div className="group/folder-row flex w-72 justify-end rounded-lg bg-token-list-hover-background p-2">
        <CodexProjectActionsMenu
          project={ACTIVE_PROJECT}
          onUpdateProject={async () => ACTIVE_PROJECT}
          onArchiveProject={async () => ({ kind: "not-found" })}
        />
      </div>
    </Surface>
  ),
  play: async ({ canvasElement }) => {
    fireEvent.click(getByRole(canvasElement, "button", { name: "Project actions for Nodex desktop" }));
    await waitFor(() => getByRole(document.body, "menuitem", { name: "Remove project" }));
  },
};

export const RemoveConfirmation: Story = {
  render: () => (
    <Surface>
      <ProjectRemoveDialog
        open
        project={ACTIVE_PROJECT}
        onOpenChange={() => undefined}
        onArchiveProject={async () => ({ kind: "not-found" })}
      />
    </Surface>
  ),
};

export const RemovePending: Story = {
  render: () => (
    <Surface>
      <ProjectRemoveDialog
        open
        project={ACTIVE_PROJECT}
        onOpenChange={() => undefined}
        onArchiveProject={async () => await new Promise<never>(() => undefined)}
      />
    </Surface>
  ),
  play: async () => {
    fireEvent.click(getByRole(document.body, "button", { name: "Remove project" }));
    await waitFor(() => getByRole(document.body, "button", { name: "Removing…" }));
  },
};

export const RemoveBlocked: Story = {
  render: () => (
    <Surface>
      <ProjectRemoveDialog
        open
        project={ACTIVE_PROJECT}
        onOpenChange={() => undefined}
        onArchiveProject={async () => ({
          kind: "blocked",
          project: ACTIVE_PROJECT,
          blockers: [
            { kind: "active-turn", threadId: "thread-1", label: "Release preparation" },
            { kind: "terminal", terminalSessionId: "terminal-1", projectSessionId: "session-1" },
          ],
        })}
      />
    </Surface>
  ),
  play: async () => {
    fireEvent.click(getByRole(document.body, "button", { name: "Remove project" }));
    await waitFor(() => getByRole(document.body, "alert"));
  },
};

export const RemovedProjectsPopulated: Story = {
  render: () => (
    <Surface>
      <NodexDialog open>
        <RemovedProjectsDialogView
          projects={REMOVED_PROJECTS}
          loading={false}
          error={null}
          restoringProjectIds={new Set(["removed-long"])}
          onRetry={() => undefined}
          onRestore={() => undefined}
        />
      </NodexDialog>
    </Surface>
  ),
};

export const RemovedProjectsEmpty: Story = {
  render: () => (
    <Surface>
      <NodexDialog open>
        <RemovedProjectsDialogView
          projects={[]}
          loading={false}
          error={null}
          restoringProjectIds={new Set()}
          onRetry={() => undefined}
          onRestore={() => undefined}
        />
      </NodexDialog>
    </Surface>
  ),
};
