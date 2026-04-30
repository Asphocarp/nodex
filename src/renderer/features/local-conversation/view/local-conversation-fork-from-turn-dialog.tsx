import { useEffect, useState } from "react";
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
  message: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (skipConfirm: boolean) => void;
}

export function LocalConversationForkFromTurnDialog({
  open,
  message,
  busy,
  onOpenChange,
  onConfirm,
}: LocalConversationForkFromTurnDialogProps) {
  const [skipConfirm, setSkipConfirm] = useState(false);

  useEffect(() => {
    if (!open) {
      setSkipConfirm(false);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (busy && !nextOpen) return;
      onOpenChange(nextOpen);
    }}
    >
      <DialogContent className="max-w-lg gap-4" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Fork from this turn?</DialogTitle>
          <DialogDescription>
            This will open a new thread from the selected point in the conversation.
          </DialogDescription>
        </DialogHeader>

        {message.trim().length > 0 ? (
          <div className="rounded-xl border border-(--border) bg-(--background-secondary) px-3 py-2.5">
            <div className="text-xs font-medium tracking-wide text-(--foreground-tertiary) uppercase">
              Composer draft
            </div>
            <div className="mt-1 text-sm whitespace-pre-wrap text-(--foreground-secondary)">
              {message.trim()}
            </div>
          </div>
        ) : null}

        <label className="flex items-start gap-3 rounded-lg px-1 py-1 text-sm text-(--foreground-secondary)">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border border-(--border) bg-(--background)"
            checked={skipConfirm}
            onChange={(event) => setSkipConfirm(event.target.checked)}
            disabled={busy}
          />
          <span>Don&apos;t ask again when forking from an older turn</span>
        </label>

        <DialogFooter className="gap-2 sm:flex-row">
          <NodexButton type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </NodexButton>
          <NodexButton type="button" onClick={() => onConfirm(skipConfirm)} disabled={busy}>
            {busy ? "Forking…" : "Fork thread"}
          </NodexButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
