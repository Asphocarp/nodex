import { type ReactNode, useState } from "react";
import { ChevronDownIcon } from "@/components/shared/icons";
import { cn } from "../../../../lib/utils";

interface ThreadSummaryPanelSectionProps {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  defaultCollapsed?: boolean;
}

export function ThreadSummaryPanelSection({
  title,
  actions,
  children,
  defaultCollapsed = false,
}: ThreadSummaryPanelSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <section className="relative z-0 flex flex-col pb-3 after:absolute after:inset-x-4 after:bottom-0 after:h-[0.5px] after:bg-token-border-default after:content-[''] last:pb-0 last:after:hidden">
      <header className="sticky top-0 z-10 flex h-7 w-full min-w-0 items-center justify-start gap-2 bg-token-dropdown-background ps-4 pe-2.5 pb-0.5 text-base text-token-text-tertiary">
        <button
          type="button"
          className="group/section-toggle inline-flex min-w-0 shrink-0 cursor-interaction items-center gap-1.5 rounded-md py-0.5 pr-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((current) => !current)}
        >
          <span className="truncate">{title}</span>
          <ChevronDownIcon
            className={cn(
              "icon-2xs shrink-0 opacity-0 transition-transform group-hover/section-toggle:opacity-100 group-focus-visible/section-toggle:opacity-100",
              collapsed ? "-rotate-90" : "rotate-0",
            )}
          />
        </button>
        {actions ? <div className="flex min-w-0 flex-1">{actions}</div> : null}
      </header>
      {collapsed ? null : (
        <div className="flex min-w-0 flex-col px-4">
          {children}
        </div>
      )}
    </section>
  );
}
