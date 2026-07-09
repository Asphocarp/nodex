import {
  BranchStatusIcon,
  LocalStatusIcon,
  WorktreeStatusIcon,
} from "@/components/shared/icons";
import { NodexButton } from "@/components/ui/button";
import {
  NodexDialog as Dialog,
  NodexDialogContent as DialogContent,
  NodexDialogDescription as DialogDescription,
  NodexDialogFooter as DialogFooter,
  NodexDialogHeader as DialogHeader,
  NodexDialogTitle as DialogTitle,
} from "@/components/ui/dialog";

interface LocalConversationForkFromTurnDialogProps {
  open: boolean;
  busy: boolean;
  isWorktreeThread: boolean;
  showWorktreeOption: boolean;
  onOpenChange: (open: boolean) => void;
  onForkIntoLocal: () => void;
  onForkIntoWorktree: () => void;
}

const choiceClassName =
  "group flex w-full items-center gap-3 rounded-lg px-[var(--padding-row-x)] py-2 text-left text-token-foreground outline-hidden enabled:cursor-interaction enabled:hover:bg-token-list-hover-background enabled:focus:bg-token-list-hover-background disabled:cursor-not-allowed disabled:opacity-50";

function ForkChoice({
  icon,
  title,
  description,
  disabled,
  onClick,
}: {
  icon: "local" | "worktree";
  title: string;
  description: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = icon === "worktree" ? WorktreeStatusIcon : LocalStatusIcon;

  return (
    <button
      type="button"
      className={choiceClassName}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="icon-xs shrink-0 opacity-75 group-hover:opacity-100 group-focus:opacity-100" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium electron:text-base">{title}</span>
        <span className="text-xs whitespace-normal text-token-description-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}

export function LocalConversationForkFromTurnDialog({
  open,
  busy,
  isWorktreeThread,
  showWorktreeOption,
  onOpenChange,
  onForkIntoLocal,
  onForkIntoWorktree,
}: LocalConversationForkFromTurnDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (busy && !nextOpen) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="max-w-[420px] gap-4 rounded-2xl p-5"
        showCloseButton={false}
      >
        <DialogHeader className="text-left">
          <div className="flex items-start gap-3">
            <BranchStatusIcon className="icon-sm shrink-0 text-token-foreground" />
            <div className="flex min-w-0 flex-col gap-1">
              <DialogTitle className="text-base">Continue from this message?</DialogTitle>
              <DialogDescription>
                This keeps your current files and worktree unchanged. If later turns changed files,
                the new task may not match what is on disk.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-1">
          <ForkChoice
            icon={isWorktreeThread ? "worktree" : "local"}
            title={isWorktreeThread ? "Continue in same worktree" : "Continue in new task"}
            description={isWorktreeThread
              ? "Continue from this message in the same worktree"
              : "Continue from this message in a new local task"}
            disabled={busy}
            onClick={onForkIntoLocal}
          />
          {showWorktreeOption ? (
            <ForkChoice
              icon="worktree"
              title="Continue in new worktree"
              description="Continue from this message in a new worktree"
              disabled={busy}
              onClick={onForkIntoWorktree}
            />
          ) : null}
        </div>

        <DialogFooter>
          <NodexButton
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </NodexButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
