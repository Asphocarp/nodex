import { useId, type CSSProperties, type ReactNode } from "react";
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
    <div className="flex items-start justify-between gap-6 px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="min-w-0 text-sm text-token-text-primary">{label}</div>
        {description ? (
          <div className="min-w-0 break-words text-sm text-token-text-secondary">
            {description}
          </div>
        ) : null}
      </div>
      <div className="flex max-w-full shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

export function NodexSettingsSection({
  id,
  title,
  children,
  cardClassName,
}: {
  id?: string;
  title?: string;
  children: ReactNode;
  cardClassName?: string;
}) {
  const titleId = useId();

  return (
    <section id={id} aria-labelledby={title ? titleId : undefined} className="flex flex-col">
      {title ? (
        <h2
          id={titleId}
          className="min-h-toolbar pb-1.5 text-base font-medium text-token-text-primary"
        >
          {title}
        </h2>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <div
          className={cn(
            "border-token-border bg-token-bg-fog flex flex-col divide-y-[0.5px] divide-token-border overflow-hidden rounded-2xl border-[0.5px]",
            cardClassName,
          )}
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
  const titleId = useId();

  return (
    <main
      aria-labelledby={titleId}
      className={cn("main-surface flex h-full min-h-0 w-full flex-col", className)}
      style={CODEX_SETTINGS_SHELL_STYLE}
    >
      <div className="draggable flex items-center px-panel electron:h-toolbar extension:h-toolbar-sm">
        {backSlot}
      </div>
      <div className="flex-1 overflow-y-auto p-panel">
        <div
          className={cn(
            "mx-auto flex w-full min-w-0 flex-col",
            fullWidth ? null : "max-w-3xl",
            contentClassName,
          )}
        >
          <div className="flex items-center justify-between gap-3 pb-panel">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 pb-panel">
              <h1 id={titleId} className="electron:heading-lg heading-base break-words">
                {title}
              </h1>
              {subtitle ? (
                <p className="break-words text-base text-token-text-secondary">{subtitle}</p>
              ) : null}
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
          </div>
          <div className="flex flex-col gap-10">{children}</div>
        </div>
      </div>
    </main>
  );
}
