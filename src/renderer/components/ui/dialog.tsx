import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { NodexButton } from "./button";

export function NodexDialog(
  props: React.ComponentProps<typeof DialogPrimitive.Root>,
) {
  return <DialogPrimitive.Root data-slot="codex-dialog" {...props} />;
}

export function NodexDialogTrigger(
  props: React.ComponentProps<typeof DialogPrimitive.Trigger>,
) {
  return <DialogPrimitive.Trigger data-slot="codex-dialog-trigger" {...props} />;
}

export function NodexDialogPortal(
  props: React.ComponentProps<typeof DialogPrimitive.Portal>,
) {
  return <DialogPrimitive.Portal data-slot="codex-dialog-portal" {...props} />;
}

export function NodexDialogClose(
  props: React.ComponentProps<typeof DialogPrimitive.Close>,
) {
  return <DialogPrimitive.Close data-slot="codex-dialog-close" {...props} />;
}

export function NodexDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="codex-dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/45",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

export function NodexDialogContent({
  className,
  overlayClassName,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  overlayClassName?: string;
}) {
  return (
    <NodexDialogPortal>
      <NodexDialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        data-slot="codex-dialog-content"
        className={cn(
          "codex-dialog fixed left-1/2 top-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-3xl",
          "bg-token-dropdown-background/90 text-token-foreground p-6 shadow-xl-spread ring-[0.5px] ring-token-border backdrop-blur-xl outline-hidden",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          "sm:max-w-lg",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close asChild>
            <NodexButton
              variant="ghost"
              size="icon-xs"
              className="absolute right-4 top-4 text-token-description-foreground hover:text-token-foreground"
              aria-label="Close"
            >
              <XIcon />
            </NodexButton>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </NodexDialogPortal>
  );
}

export function NodexDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="codex-dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  );
}

export function NodexDialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="codex-dialog-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    >
      {children}
      {showCloseButton ? (
        <DialogPrimitive.Close asChild>
          <NodexButton variant="outline">Close</NodexButton>
        </DialogPrimitive.Close>
      ) : null}
    </div>
  );
}

export function NodexDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="codex-dialog-title"
      className={cn("heading-dialog text-token-foreground", className)}
      {...props}
    />
  );
}

export function NodexDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="codex-dialog-description"
      className={cn("text-sm text-token-description-foreground", className)}
      {...props}
    />
  );
}
