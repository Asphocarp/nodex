import { useEffect, useState, type DragEvent } from "react";
import { FolderOpen, Plus, Sparkles } from "lucide-react";
import {
  NodexDialog,
  NodexDialogContent,
  NodexDialogDescription,
  NodexDialogFooter,
  NodexDialogHeader,
  NodexDialogTitle,
} from "@/components/ui/dialog";
import { NodexButton } from "@/components/ui/button";
import {
  NodexDropdownItem,
  NodexDropdownMenu,
} from "@/components/ui/dropdown";
import { invoke } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Project, ProjectCreateInput } from "@/lib/types";
import {
  CodexSidebarActionButton,
} from "./codex-sidebar";

export type SidebarCreateProjectHandler = (input: ProjectCreateInput) => Promise<Project | null>;

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
}

function firstDroppedFilePath(event: DragEvent<HTMLElement>): string | null {
  const files = Array.from(event.dataTransfer.files);
  const file = files[0] as (File & { path?: string }) | undefined;
  return file?.path?.trim() || null;
}

export function LocalProjectSetupDialog({
  open,
  onOpenChange,
  onCreateProject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateProject: SidebarCreateProjectHandler;
}) {
  const [name, setName] = useState("");
  const [sourceRoot, setSourceRoot] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setSourceRoot("");
    setDragActive(false);
    setSubmitting(false);
    setError(null);
  };

  const pickSourceRoot = async () => {
    const picked = (await invoke("projects:pick-source-root")) as string | null;
    if (!picked) return;
    setSourceRoot(picked);
    if (!name.trim()) {
      setName(basename(picked));
    }
  };

  const submit = async () => {
    const normalizedSourceRoot = sourceRoot.trim();
    const normalizedName = name.trim() || (normalizedSourceRoot ? basename(normalizedSourceRoot) : "Untitled project");
    setSubmitting(true);
    setError(null);
    try {
      const project = await onCreateProject({
        name: normalizedName,
        sources: normalizedSourceRoot ? [normalizedSourceRoot] : [],
      });
      if (!project) {
        setError("Could not create project.");
        setSubmitting(false);
        return;
      }
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project.");
      setSubmitting(false);
    }
  };

  return (
    <NodexDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) reset();
        onOpenChange(nextOpen);
      }}
    >
      <NodexDialogContent className="max-w-md">
        <NodexDialogHeader>
          <NodexDialogTitle>Start from scratch</NodexDialogTitle>
          <NodexDialogDescription>
            Create a local project with an optional source folder.
          </NodexDialogDescription>
        </NodexDialogHeader>

        <div className="grid gap-3">
          <label className="grid gap-1.5 text-sm">
            <span className="text-token-description-foreground">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={sourceRoot ? basename(sourceRoot) : "Untitled project"}
              className="h-9 rounded-lg border border-token-border bg-token-main-surface-secondary px-3 text-sm outline-none focus:border-token-focus"
            />
          </label>

          <div
            className={cn(
              "rounded-xl border border-dashed border-token-border bg-token-main-surface-secondary/65 p-3 transition",
              dragActive && "border-token-focus bg-token-list-hover-background",
            )}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              const droppedPath = firstDroppedFilePath(event);
              if (!droppedPath) return;
              setSourceRoot(droppedPath);
              if (!name.trim()) {
                setName(basename(droppedPath));
              }
            }}
          >
            <div className="flex items-start gap-2">
              <FolderOpen className="mt-0.5 size-4 shrink-0 text-token-description-foreground" />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-token-foreground">Source folder</div>
                <div className="mt-1 truncate text-xs text-token-description-foreground">
                  {sourceRoot.trim() || "Drop a folder here or choose one from Finder."}
                </div>
              </div>
              <NodexButton
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void pickSourceRoot();
                }}
              >
                Browse
              </NodexButton>
            </div>
          </div>

          {error ? <div className="text-sm text-(--red-text)">{error}</div> : null}
        </div>

        <NodexDialogFooter>
          <NodexButton
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </NodexButton>
          <NodexButton
            type="button"
            disabled={submitting}
            onClick={() => {
              void submit();
            }}
          >
            Create
          </NodexButton>
        </NodexDialogFooter>
      </NodexDialogContent>
    </NodexDialog>
  );
}

export function SidebarProjectAddMenu({
  onCreateProject,
  openSetupTick,
}: {
  onCreateProject: SidebarCreateProjectHandler;
  openSetupTick?: number;
}) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [lastOpenSetupTick, setLastOpenSetupTick] = useState(openSetupTick ?? 0);

  useEffect(() => {
    if (openSetupTick === undefined || openSetupTick === lastOpenSetupTick) return;
    setLastOpenSetupTick(openSetupTick);
    setSetupOpen(true);
  }, [lastOpenSetupTick, openSetupTick]);

  const createFromExistingFolder = async () => {
    const sourceRoot = (await invoke("projects:pick-source-root")) as string | null;
    if (!sourceRoot) return;
    await onCreateProject({
      name: basename(sourceRoot),
      sources: [sourceRoot],
    });
  };

  return (
    <>
      <NodexDropdownMenu
        align="end"
        side="bottom"
        contentWidth="menu"
        triggerButton={(
          <CodexSidebarActionButton label="Add project" title="Add project">
            <Plus className="size-3.5" />
          </CodexSidebarActionButton>
        )}
      >
        <NodexDropdownItem
          leftSlot={<Sparkles className="icon-sm" />}
          onSelect={() => setSetupOpen(true)}
        >
          Start from scratch
        </NodexDropdownItem>
        <NodexDropdownItem
          leftSlot={<FolderOpen className="icon-sm" />}
          onSelect={() => {
            void createFromExistingFolder();
          }}
        >
          Use an existing folder
        </NodexDropdownItem>
      </NodexDropdownMenu>
      <LocalProjectSetupDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        onCreateProject={onCreateProject}
      />
    </>
  );
}
