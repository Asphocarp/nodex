import { useState, type FormEvent } from "react";
import type {
  Project,
  ProjectArchiveBlocker,
  ProjectLifecycleMutationResult,
} from "@/lib/types";
import { NodexButton } from "@/components/ui/button";
import {
  NodexDialog,
  NodexDialogContent,
  NodexDialogDescription,
  NodexDialogFooter,
  NodexDialogHeader,
  NodexDialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";

export function describeProjectArchiveBlockers(
  blockers: readonly ProjectArchiveBlocker[],
): string {
  const kinds = new Set(blockers.map((blocker) => blocker.kind));
  const hasTask = kinds.has("active-turn") || kinds.has("pending-request");
  const hasProcess = kinds.has("terminal") || kinds.has("background-process");
  if (hasTask && hasProcess) {
    return "Stop the active task and close its terminals before removing this project.";
  }
  if (hasTask) return "Stop the active task before removing this project.";
  if (hasProcess) return "Close the project’s terminals and background processes before removing it.";
  return "This project still has active work. Stop it before removing the project.";
}

function blockerAccessibleLabel(blocker: ProjectArchiveBlocker): string {
  if (blocker.kind === "terminal") {
    return `Live terminal ${blocker.terminalSessionId}`;
  }
  if (blocker.kind === "background-process") {
    return blocker.label
      ? `Background process in ${blocker.label}`
      : `Background process in thread ${blocker.threadId}`;
  }
  const label = blocker.label ?? blocker.threadId;
  return blocker.kind === "active-turn"
    ? `Active task in ${label}`
    : `Pending request in ${label}`;
}

export function ProjectRemoveDialog({
  open,
  project,
  onOpenChange,
  onArchiveProject,
}: {
  open: boolean;
  project: Project;
  onOpenChange: (open: boolean) => void;
  onArchiveProject: (projectId: string) => Promise<ProjectLifecycleMutationResult>;
}) {
  const [pending, setPending] = useState(false);
  const [blockers, setBlockers] = useState<readonly ProjectArchiveBlocker[]>([]);

  const setOpen = (nextOpen: boolean) => {
    if (pending) return;
    if (!nextOpen) setBlockers([]);
    onOpenChange(nextOpen);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setBlockers([]);
    try {
      const result = await onArchiveProject(project.id);
      if (result.kind === "blocked") {
        setBlockers(result.blockers);
        return;
      }
      if (result.kind === "not-found") {
        toast.danger(`Could not remove ${project.name}`, {
          description: "The project could not be found.",
        });
        return;
      }
      onOpenChange(false);
    } catch (error) {
      toast.danger(`Could not remove ${project.name}`, {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <NodexDialog open={open} onOpenChange={setOpen}>
      <NodexDialogContent
        className="w-[420px] gap-5 sm:max-w-[420px]"
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (pending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <form className="contents" onSubmit={(event) => void submit(event)}>
          <NodexDialogHeader className="gap-2 text-left">
            <NodexDialogTitle className="text-base">
              Remove {project.name}?
            </NodexDialogTitle>
            <NodexDialogDescription>
              This removes the project from the app. Files on your computer and existing chats won&rsquo;t be deleted.
            </NodexDialogDescription>
          </NodexDialogHeader>

          {blockers.length > 0 ? (
            <div
              role="alert"
              className="rounded-lg bg-token-error-background/10 px-3 py-2 text-sm text-token-error-foreground"
            >
              {describeProjectArchiveBlockers(blockers)}
              <ul className="sr-only">
                {blockers.map((blocker, index) => (
                  <li key={`${blocker.kind}:${index}`}>
                    {blockerAccessibleLabel(blocker)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <NodexDialogFooter>
            <NodexButton
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </NodexButton>
            <NodexButton type="submit" variant="destructive" disabled={pending}>
              {pending ? "Removing…" : "Remove project"}
            </NodexButton>
          </NodexDialogFooter>
        </form>
      </NodexDialogContent>
    </NodexDialog>
  );
}
