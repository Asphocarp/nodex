import { useEffect, useRef, useState } from "react";
import { NodexButton } from "@/components/ui/button";
import {
  NodexDialog,
  NodexDialogContent,
  NodexDialogDescription,
  NodexDialogFooter,
  NodexDialogHeader,
  NodexDialogTitle,
} from "@/components/ui/dialog";

interface RenameChatDialogProps {
  open: boolean;
  initialValue: string;
  busy: boolean;
  requireNonEmpty?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (title: string) => void;
}

export function RenameChatDialog({
  open,
  initialValue,
  busy,
  requireNonEmpty = false,
  onOpenChange,
  onSave,
}: RenameChatDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState(initialValue);
  const saveDisabled = busy || (requireNonEmpty && title.trim().length === 0);

  useEffect(() => {
    if (!open) return;
    setTitle(initialValue);
  }, [initialValue, open]);

  const focusAndSelectInput = () => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  };
  const updateTitleFromInput = (value: string) => {
    setTitle(value);
  };

  return (
    <NodexDialog open={open} onOpenChange={onOpenChange}>
      <NodexDialogContent
        className="max-w-sm gap-5 rounded-2xl p-5"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          window.requestAnimationFrame(focusAndSelectInput);
        }}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (saveDisabled) return;
            onSave(title);
          }}
        >
          <NodexDialogHeader className="gap-1">
            <NodexDialogTitle className="text-base">Rename chat</NodexDialogTitle>
            <NodexDialogDescription>Keep it short and recognizable</NodexDialogDescription>
          </NodexDialogHeader>
          <input
            ref={inputRef}
            aria-label="Chat title"
            placeholder="Add a title…"
            className="w-full rounded-xl border border-token-border bg-token-main-surface-primary px-3 py-2 text-base text-token-input-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-token-focus"
            value={title}
            onChange={(event) => updateTitleFromInput(event.currentTarget.value)}
            onInput={(event) => updateTitleFromInput(event.currentTarget.value)}
            onFocus={(event) => event.currentTarget.select()}
          />
          <NodexDialogFooter>
            <NodexButton
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </NodexButton>
            <NodexButton type="submit" size="sm" disabled={saveDisabled}>
              Save
            </NodexButton>
          </NodexDialogFooter>
        </form>
      </NodexDialogContent>
    </NodexDialog>
  );
}
