import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ComposerAdaptiveLayout = "single-line" | "multiline";

interface ComposerInputProps {
  children: ReactNode;
  layout: ComposerAdaptiveLayout;
}

export function ComposerInput({
  children,
  layout,
}: ComposerInputProps) {
  return (
    <div
      data-composer-input="true"
      className={
        layout === "single-line"
          ? "min-w-0"
          : "mb-1 flex-grow overflow-y-auto px-3"
      }
    >
      {children}
    </div>
  );
}

interface ComposerAdaptiveFooterProps {
  input: ReactNode;
  layout: ComposerAdaptiveLayout;
  leadingControls: ReactNode;
  trailingControls: ReactNode;
}

export function ComposerAdaptiveFooter({
  input,
  layout,
  leadingControls,
  trailingControls,
}: ComposerAdaptiveFooterProps) {
  const multiline = layout === "multiline";
  const row = multiline ? "controls" : "single-line";

  return (
    <div
      data-composer-form-footer="true"
      data-composer-layout={layout}
      className={cn(
        "_footer_1u8sk_2 grid items-center select-none",
        multiline
          ? "mb-2 grid-cols-[minmax(0,auto)_auto_minmax(0,1fr)] gap-x-[5px] px-2"
          : "grid-cols-[auto_minmax(0,1fr)_auto] gap-2 px-2 py-1",
      )}
    >
      <div
        data-composer-footer-leading="true"
        data-composer-footer-row={row}
        className={cn(
          "min-w-0",
          multiline && "col-start-1 row-start-2",
        )}
      >
        {leadingControls}
      </div>
      <div
        data-composer-input-slot="true"
        data-composer-footer-row={multiline ? "prompt" : row}
        className={cn(
          "min-w-0",
          multiline && "col-span-full row-start-1 -mx-2",
        )}
      >
        {input}
      </div>
      <div
        data-composer-footer-trailing="true"
        data-composer-footer-row={row}
        className={cn(
          "min-w-0",
          multiline && "col-start-3 row-start-2",
        )}
      >
        {trailingControls}
      </div>
    </div>
  );
}
