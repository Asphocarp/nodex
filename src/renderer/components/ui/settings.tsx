import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const CODEX_SETTINGS_SHELL_STYLE = {
  "--vscode-font-size": "15px",
  "--text-4xl": "83px",
  "--text-3xl": "55px",
  "--text-2xl": "42px",
  "--text-xl": "32px",
  "--text-lg": "18px",
  "--text-base": "15px",
  "--text-sm": "14px",
  "--text-xs": "12px",
  "--text-heading-lg": "28px",
  "--text-heading-md": "23px",
  "--cursor-interaction": "pointer",
} as CSSProperties;

export interface NodexSettingsRowProps {
  label: string;
  description?: string;
  children: ReactNode;
}

export function NodexSettingsRow({
  label,
  description,
  children,
}: NodexSettingsRowProps) {
  return (
    <div className="flex items-center justify-between p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="min-w-0 text-sm text-token-text-primary">{label}</div>
        {description ? (
          <div className="min-w-0 text-sm text-token-text-secondary">{description}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

export function NodexSettingsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col">
      <div className="flex h-toolbar items-center justify-between gap-2 px-0 py-0">
        <div className="text-base font-medium text-token-text-primary">{title}</div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div
          className="border-token-border flex flex-col divide-y-[0.5px] divide-token-border rounded-lg border"
          style={{ backgroundColor: "var(--color-background-panel, var(--color-token-bg-fog))" }}
        >
          {children}
        </div>
      </div>
    </section>
  );
}

export function NodexSettingsPageSurface({
  title,
  backSlot,
  subtitle,
  children,
  fullWidth = false,
  contentClassName,
  action,
  className,
}: {
  title: string;
  backSlot?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  fullWidth?: boolean;
  contentClassName?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("main-surface flex h-full min-h-0 flex-col", className)}
      style={CODEX_SETTINGS_SHELL_STYLE}
    >
      <div className="draggable flex items-center px-panel electron:h-toolbar extension:h-toolbar-sm">
        {backSlot}
      </div>
      <div className="flex-1 overflow-y-auto p-panel">
        <div
          className={cn(
            "mx-auto flex w-full flex-col",
            fullWidth ? null : "max-w-2xl",
            contentClassName,
          )}
        >
          <div className="flex items-center justify-between gap-3 pb-panel">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 pb-panel">
              <div className="electron:heading-lg heading-base truncate">{title}</div>
              {subtitle ? (
                <div className="truncate text-base text-token-text-secondary">{subtitle}</div>
              ) : null}
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
          </div>
          <div className="flex flex-col gap-[var(--padding-panel)]">{children}</div>
        </div>
      </div>
    </div>
  );
}
