import type { ReactNode } from "react";
import { CloseIcon } from "@/components/shared/icons";
import { NodexButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ImageEditorToolbarPillProps {
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
}

export function ImageEditorToolbarPill({
  ariaLabel,
  children,
  className,
}: ImageEditorToolbarPillProps) {
  return (
    <div
      role={ariaLabel ? "toolbar" : undefined}
      aria-label={ariaLabel}
      className={cn(
        "flex w-fit max-w-full select-none items-center gap-0.5 overflow-hidden rounded-full bg-token-editor-background/95 p-0.5 shadow-md ring-1 ring-token-border-light backdrop-blur-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface ImageCommentModeToolbarProps {
  ariaLabel?: string;
  commentCount: number;
  emptyMessage: ReactNode;
  isSubmitting?: boolean;
  onCancel: () => void;
  onSend: () => void;
}

export function ImageCommentModeToolbar({
  ariaLabel,
  commentCount,
  emptyMessage,
  isSubmitting = false,
  onCancel,
  onSend,
}: ImageCommentModeToolbarProps) {
  return (
    <ImageEditorToolbarPill ariaLabel={ariaLabel}>
      <span
        className={cn(
          "min-w-0 truncate px-1.5 text-base leading-[18px]",
          commentCount === 0 ? "text-token-text-tertiary" : "text-token-foreground",
        )}
      >
        {commentCount === 0
          ? emptyMessage
          : `${commentCount} ${commentCount === 1 ? "comment" : "comments"}`}
      </span>
      <NodexButton
        variant="accentAction"
        size="composer"
        disabled={commentCount === 0 || isSubmitting}
        aria-busy={isSubmitting || undefined}
        className="!h-token-button-composer-sm !px-2 !text-base"
        onClick={onSend}
      >
        Send
      </NodexButton>
      <NodexButton
        variant="ghost"
        size="icon-xs"
        aria-label="Cancel"
        className="!size-7 rounded-full text-token-text-tertiary"
        onClick={onCancel}
      >
        <CloseIcon aria-hidden="true" className="icon-2xs" />
      </NodexButton>
    </ImageEditorToolbarPill>
  );
}
