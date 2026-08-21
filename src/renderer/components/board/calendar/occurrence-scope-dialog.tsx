import {
  NodexDialog as Dialog,
  NodexDialogAction as DialogAction,
  NodexDialogBody as DialogBody,
  NodexDialogContent as DialogContent,
  NodexDialogDescription as DialogDescription,
  NodexDialogFooter as DialogFooter,
  NodexDialogFrame as DialogFrame,
  NodexDialogHeader as DialogHeader,
  NodexDialogTitle as DialogTitle,
} from "@/components/ui/dialog";
import type { OccurrenceEditScope } from "@/lib/types";
import { resolveOccurrenceScopeOptions } from "./occurrence-scope-options";

interface OccurrenceScopeDialogProps {
  open: boolean;
  title: string;
  fromLabel: string;
  toLabel: string;
  thisAndFutureEquivalentToAll: boolean;
  busy: boolean;
  onCancel: () => void;
  onSelect: (scope: OccurrenceEditScope) => void | Promise<void>;
}

export function OccurrenceScopeDialog({
  open,
  title,
  fromLabel,
  toLabel,
  thisAndFutureEquivalentToAll,
  busy,
  onCancel,
  onSelect,
}: OccurrenceScopeDialogProps) {
  const options = resolveOccurrenceScopeOptions(thisAndFutureEquivalentToAll);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onCancel();
      }}
    >
      <DialogContent showCloseButton={!busy}>
        <DialogFrame>
          <DialogHeader>
            <DialogTitle>Apply recurring schedule change</DialogTitle>
            <DialogDescription>
              Choose how to apply the new time range for{" "}
              <span className="font-medium wrap-break-word text-(--foreground)">
                {title || "this recurring page"}
              </span>
              .
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            <div className="rounded-md border border-(--border) bg-(--card) p-3 text-sm">
              <p className="text-(--foreground-secondary)">
                From: <span className="text-(--foreground)">{fromLabel}</span>
              </p>
              <p className="mt-1 text-(--foreground-secondary)">
                To: <span className="text-(--foreground)">{toLabel}</span>
              </p>
            </div>
          </DialogBody>

          <DialogFooter className="flex-wrap">
            <DialogAction onClick={onCancel} disabled={busy}>
              Cancel
            </DialogAction>
            {options.map((option) => (
              <DialogAction
                key={option.scope}
                tone={option.isPrimary ? "primary" : "ghost"}
                onClick={() => void onSelect(option.scope)}
                disabled={busy}
              >
                {option.label}
              </DialogAction>
            ))}
          </DialogFooter>
        </DialogFrame>
      </DialogContent>
    </Dialog>
  );
}
