import { useRef, useState } from "react";
import {
  NodexPopover,
  NodexPopoverContent,
  NodexPopoverTrigger,
} from "@/components/ui/popover";
import { invoke } from "@/lib/api";
import type { WorkspaceRecord } from "@/lib/types";
import { normalizeProjectIcon } from "@/lib/project-icon";
import { cn } from "@/lib/utils";
import { Pencil, Plus, Settings, Smile, Trash2 } from "lucide-react";

const WORKSPACE_ACTIVE_DOT_COLORS = [
  "var(--color-accent-blue)",
  "var(--color-accent-green)",
  "var(--color-accent-orange)",
  "var(--color-accent-purple)",
  "var(--color-accent-yellow)",
  "var(--color-accent-red)",
];
const WORKSPACE_INACTIVE_DOT_COLOR = "var(--foreground-disabled)";

function hashText(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function workspaceColor(workspaceId: string): string {
  return WORKSPACE_ACTIVE_DOT_COLORS[hashText(workspaceId) % WORKSPACE_ACTIVE_DOT_COLORS.length] ?? WORKSPACE_ACTIVE_DOT_COLORS[0];
}

function resolveWorkspaceIconValue(value: string): string | undefined {
  return normalizeProjectIcon(value) || undefined;
}

function WorkspaceMark({
  workspace,
  active,
  className,
  dotClassName,
}: {
  workspace: WorkspaceRecord;
  active: boolean;
  className?: string;
  dotClassName?: string;
}) {
  const icon = normalizeProjectIcon(workspace.icon);
  if (icon) {
    return <span className={cn(className, !active && "grayscale opacity-45")}>{icon}</span>;
  }

  return (
    <span
      aria-hidden
      className={cn("inline-block rounded-full", active && "opacity-70", dotClassName)}
      style={{ backgroundColor: active ? workspaceColor(workspace.id) : WORKSPACE_INACTIVE_DOT_COLOR }}
    />
  );
}

function workspaceInputClassName() {
  return cn(
    "h-7 w-full rounded-md px-2 text-xs",
    "bg-(--background-secondary) text-(--foreground)",
    "border border-(--border) outline-none",
    "placeholder:text-(--foreground-tertiary)",
    "focus:border-(--accent-blue)",
  );
}

interface WorkspaceManagerPopoverProps {
  workspaces: WorkspaceRecord[];
  activeWorkspaceId: string;
  onSelectWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: (name: string, icon?: string | null) => Promise<void>;
  onRenameWorkspace: (workspaceId: string, name: string, icon?: string | null) => Promise<void>;
  onDeleteWorkspace: (workspaceId: string) => Promise<void>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactElement;
}

function WorkspaceManagerPopover({
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onCreateWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  open,
  onOpenChange,
  trigger,
}: WorkspaceManagerPopoverProps) {
  const [creating, setCreating] = useState(false);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [confirmDeleteWorkspaceId, setConfirmDeleteWorkspaceId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftIcon, setDraftIcon] = useState("");
  const createIconInputRef = useRef<HTMLInputElement>(null);
  const editIconInputRef = useRef<HTMLInputElement>(null);
  const inputClassName = workspaceInputClassName();
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0];

  const openCreate = () => {
    setCreating(true);
    setEditingWorkspaceId(null);
    setConfirmDeleteWorkspaceId(null);
    setDraftName(`${activeWorkspace?.name ?? "Workspace"} copy`);
    setDraftIcon(activeWorkspace?.icon ?? "");
  };

  const openRename = (workspace: WorkspaceRecord) => {
    setCreating(false);
    setConfirmDeleteWorkspaceId(null);
    setEditingWorkspaceId(workspace.id);
    setDraftName(workspace.name);
    setDraftIcon(workspace.icon ?? "");
  };

  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = draftName.trim();
    if (!name) return;
    await onCreateWorkspace(name, resolveWorkspaceIconValue(draftIcon));
    setCreating(false);
    setDraftName("");
    setDraftIcon("");
    onOpenChange(false);
  };

  const submitRename = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingWorkspaceId) return;
    const name = draftName.trim();
    if (!name) return;
    await onRenameWorkspace(editingWorkspaceId, name, resolveWorkspaceIconValue(draftIcon) ?? null);
    setEditingWorkspaceId(null);
    setDraftName("");
    setDraftIcon("");
  };

  const handleOpenCreateEmojiPanel = async () => {
    createIconInputRef.current?.focus();
    try {
      await invoke("window:show-emoji-panel");
    } catch {
      // Keep manual emoji entry available when the native panel is unavailable.
    }
  };

  const handleOpenEditEmojiPanel = async () => {
    editIconInputRef.current?.focus();
    try {
      await invoke("window:show-emoji-panel");
    } catch {
      // Keep manual emoji entry available when the native panel is unavailable.
    }
  };

  return (
    <NodexPopover open={open} onOpenChange={onOpenChange}>
      <NodexPopoverTrigger asChild>
        {trigger}
      </NodexPopoverTrigger>
      <NodexPopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-72 p-2"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <div className="px-1 py-1.5 text-xs text-(--foreground-tertiary)">Workspaces</div>
        <div className="max-h-60 space-y-1 overflow-auto">
          {workspaces.map((workspace) => {
            const isEditing = editingWorkspaceId === workspace.id;
            const isConfirmingDelete = confirmDeleteWorkspaceId === workspace.id;
            const canDelete = workspaces.length > 1;

            if (isEditing) {
              return (
                <form
                  key={workspace.id}
                  className="space-y-1.5 rounded-md border border-(--border) p-2"
                  onSubmit={(event) => void submitRename(event)}
                >
                  <input
                    type="text"
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    className={inputClassName}
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key !== "Escape") return;
                      setEditingWorkspaceId(null);
                    }}
                  />
                  <div className="flex items-center gap-1.5">
                    <input
                      ref={editIconInputRef}
                      type="text"
                      value={draftIcon}
                      onChange={(event) => setDraftIcon(event.target.value)}
                      className={cn(inputClassName, "flex-1")}
                      placeholder="Emoji icon (optional)"
                      onKeyDown={(event) => {
                        if (event.key !== "Escape") return;
                        setEditingWorkspaceId(null);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void handleOpenEditEmojiPanel()}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-(--border) text-(--foreground-secondary) hover:bg-(--background-secondary) hover:text-(--foreground)"
                      title="Open emoji picker"
                    >
                      <Smile className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraftIcon("")}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-(--border) text-(--foreground-secondary) hover:bg-(--background-secondary) hover:text-(--destructive)"
                      title="Clear icon"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <div className="text-xs text-(--foreground-tertiary)">
                    Click the smile button to open the native emoji picker.
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="submit"
                      className="h-6 rounded-md bg-(--accent-blue) px-2 text-xs text-white transition-filter hover:brightness-95"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingWorkspaceId(null)}
                      className="h-6 rounded-md px-2 text-xs text-(--foreground-secondary) hover:bg-(--background-secondary)"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              );
            }

            return (
              <div
                key={workspace.id}
                className={cn(
                  "flex items-center gap-1 rounded-md px-1 py-1 hover:bg-(--background-secondary)",
                  workspace.id === activeWorkspaceId && "bg-(--background-secondary)",
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelectWorkspace(workspace.id);
                    onOpenChange(false);
                  }}
                  className="min-w-0 flex-1 truncate text-left text-sm text-(--foreground)"
                >
                  <span className="mr-1.5 inline-flex size-4 items-center justify-center rounded-md text-[11px] leading-none">
                    <WorkspaceMark
                      workspace={workspace}
                      active={workspace.id === activeWorkspaceId}
                      className="leading-none"
                      dotClassName="h-2.5 w-2.5"
                    />
                  </span>
                  {workspace.name}
                </button>
                {isConfirmingDelete ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void onDeleteWorkspace(workspace.id)}
                      className="h-6 rounded-sm bg-(--destructive) px-1.5 text-xs text-white transition-filter hover:brightness-95"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteWorkspaceId(null)}
                      className="h-6 rounded-sm px-1.5 text-xs text-(--foreground-secondary) hover:bg-(--background-tertiary)"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => openRename(workspace)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-(--foreground-tertiary) hover:bg-(--background-tertiary) hover:text-(--foreground)"
                      title="Rename workspace"
                    >
                      <Pencil className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingWorkspaceId(null);
                        setConfirmDeleteWorkspaceId(workspace.id);
                      }}
                      disabled={!canDelete}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-(--foreground-tertiary) hover:bg-(--background-tertiary) hover:text-(--destructive) disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-(--foreground-tertiary)"
                      title={canDelete ? "Delete workspace" : "The last workspace cannot be deleted"}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
        {creating ? (
          <form className="mt-2 space-y-1.5 rounded-md border border-(--border) p-2" onSubmit={(event) => void submitCreate(event)}>
            <input
              type="text"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              className={inputClassName}
              autoFocus
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                setCreating(false);
              }}
            />
            <div className="flex items-center gap-1.5">
              <input
                ref={createIconInputRef}
                type="text"
                value={draftIcon}
                onChange={(event) => setDraftIcon(event.target.value)}
                className={cn(inputClassName, "flex-1")}
                placeholder="Emoji icon (optional)"
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  setCreating(false);
                }}
              />
              <button
                type="button"
                onClick={() => void handleOpenCreateEmojiPanel()}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-(--border) text-(--foreground-secondary) hover:bg-(--background-secondary) hover:text-(--foreground)"
                title="Open emoji picker"
              >
                <Smile className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setDraftIcon("")}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-(--border) text-(--foreground-secondary) hover:bg-(--background-secondary) hover:text-(--destructive)"
                title="Clear icon"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
            <div className="text-xs text-(--foreground-tertiary)">
              Click the smile button to open the native emoji picker.
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="submit"
                className="h-7 rounded-md bg-(--accent-blue) px-2.5 text-xs text-white transition-filter hover:brightness-95"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="h-7 rounded-md px-2.5 text-xs text-(--foreground-secondary) hover:bg-(--background-secondary)"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={openCreate}
            className="mt-2 inline-flex h-8 w-full items-center justify-center gap-2 rounded-md border border-(--border) text-sm text-(--foreground-secondary) hover:bg-(--background-secondary) hover:text-(--foreground)"
          >
            <Plus className="size-3.5" />
            New Workspace
          </button>
        )}
      </NodexPopoverContent>
    </NodexPopover>
  );
}

export function LeftSidebarWorkspaceManager({
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onCreateWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  onOpenSettings,
}: {
  workspaces: WorkspaceRecord[];
  activeWorkspaceId: string;
  onSelectWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: (name: string, icon?: string | null) => Promise<void>;
  onRenameWorkspace: (workspaceId: string, name: string, icon?: string | null) => Promise<void>;
  onDeleteWorkspace: (workspaceId: string) => Promise<void>;
  onOpenSettings: () => void;
}) {
  const [manageOpen, setManageOpen] = useState(false);

  return (
    <div className="border-t border-(--sidebar-border) px-(--sidebar-shell-padding-x) py-(--sidebar-row-padding-y)">
      <div className="grid grid-cols-[28px_1fr_28px] items-center gap-1.5">
        <button
          type="button"
          onClick={onOpenSettings}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-(--sidebar-foreground-secondary) hover:bg-(--sidebar-accent) hover:text-(--sidebar-foreground)"
          title="Settings"
        >
          <Settings className="size-3.5" />
        </button>

        <div className="hide-scrollbar flex min-w-0 items-center justify-center gap-1 overflow-x-auto">
          {workspaces.map((workspace) => (
            <button
              type="button"
              key={workspace.id}
              onClick={() => onSelectWorkspace(workspace.id)}
              className={cn(
                "inline-flex h-7 min-w-7 items-center justify-center rounded-lg px-1.5 text-xs font-medium",
                workspace.id === activeWorkspaceId
                  ? "bg-(--sidebar-accent) text-(--sidebar-foreground)"
                  : "text-(--sidebar-foreground-secondary) opacity-55 hover:bg-(--sidebar-accent) hover:text-(--sidebar-foreground) hover:opacity-100",
              )}
              title={workspace.name}
            >
              <span className="inline-flex size-4 items-center justify-center rounded-md text-[11px] leading-none">
                <WorkspaceMark
                  workspace={workspace}
                  active={workspace.id === activeWorkspaceId}
                  className="leading-none"
                  dotClassName="h-2.5 w-2.5"
                />
              </span>
            </button>
          ))}
        </div>

        <WorkspaceManagerPopover
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSelectWorkspace={onSelectWorkspace}
          onCreateWorkspace={onCreateWorkspace}
          onRenameWorkspace={onRenameWorkspace}
          onDeleteWorkspace={onDeleteWorkspace}
          open={manageOpen}
          onOpenChange={setManageOpen}
          trigger={(
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-(--sidebar-foreground-secondary) hover:bg-(--sidebar-accent) hover:text-(--sidebar-foreground)"
              title="Manage workspaces"
              aria-label="Manage workspaces"
            >
              <Plus className="size-3.5" />
            </button>
          )}
        />
      </div>
    </div>
  );
}
