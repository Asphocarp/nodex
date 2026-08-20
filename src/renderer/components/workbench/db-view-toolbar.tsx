import { SearchIcon } from "@/components/shared/icons";
import { type ComponentType, type ReactNode, type RefObject } from "react";
import { XCircle } from "@/components/shared/icons/generic-icons";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { NodexIconButton } from "@/components/ui/button";
import { NodexTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const DB_VIEW_TOOLBAR_TEST_ID = "db-view-toolbar";

export interface DbViewToolbarItem {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  active?: boolean;
  onSelect: () => void;
}

interface DbViewToolbarProps {
  items: DbViewToolbarItem[];
  destinationItems?: DbViewToolbarItem[];
  activeSearchQuery: string;
  taskSearchOpen: boolean;
  searchShortcutLabel: string;
  taskSearchInputRef: RefObject<HTMLInputElement | null>;
  viewContextLabel?: ReactNode;
  managementControl?: ReactNode;
  databaseViewControls?: ReactNode;
  rulesSummaryRow?: ReactNode;
  showSearchControls?: boolean;
  onSearchQueryChange: (value: string) => void;
  onOpenTaskSearch: (selectQuery?: boolean) => void;
  onCloseTaskSearch: () => void;
}

export function resolveDbViewToolbarClearAction(hasActiveSearchQuery: boolean): {
  shouldClear: boolean;
  shouldClose: boolean;
} {
  if (!hasActiveSearchQuery) {
    return {
      shouldClear: false,
      shouldClose: true,
    };
  }

  return {
    shouldClear: true,
    shouldClose: true,
  };
}

export function DbViewToolbar({
  items,
  destinationItems = [],
  activeSearchQuery,
  taskSearchOpen,
  searchShortcutLabel,
  taskSearchInputRef,
  viewContextLabel,
  managementControl,
  databaseViewControls,
  rulesSummaryRow,
  showSearchControls = true,
  onSearchQueryChange,
  onOpenTaskSearch,
  onCloseTaskSearch,
}: DbViewToolbarProps) {
  const activeItem = items.find((item) => item.active) ?? items[0] ?? null;
  if (!activeItem) return null;

  const hasActiveSearchQuery = activeSearchQuery.trim().length > 0;
  const showSearchField = showSearchControls && (taskSearchOpen || hasActiveSearchQuery);

  return (
    <header
      className={cn(
        "sticky top-0 z-20 shrink-0",
        "bg-[color-mix(in_srgb,var(--background)_94%,transparent)] backdrop-blur-sm",
      )}
      data-testid={DB_VIEW_TOOLBAR_TEST_ID}
    >
      <div className="pl-4 pr-2 pb-2">
        <div className="flex min-h-11 items-center gap-2">
          <TabsPrimitive.Root
            value={activeItem.id}
            onValueChange={(value) => {
              const nextItem = items.find((item) => item.id === value);
              nextItem?.onSelect();
            }}
          >
            <TabsPrimitive.List
              aria-label="Database views"
              className="hide-scrollbar -ml-1 flex min-w-0 items-center overflow-x-auto"
            >
              {items.map((item) => {
                const isActive = item.id === activeItem.id;
                const Icon = item.icon;
                return (
                  <TabsPrimitive.Trigger
                    key={item.id}
                    value={item.id}
                    aria-label={item.label}
                    title={item.label}
                    className={cn(
                      "group/view mx-0.5 inline-flex h-8 shrink-0 items-center justify-center rounded-full",
                      "text-sm font-medium leading-none whitespace-nowrap outline-none",
                      "focus-visible:ring-2 focus-visible:ring-(--ring)/35",
                      isActive
                        ? "bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)] px-3 text-(--foreground)"
                        : "w-8 text-(--foreground-secondary) hover:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)] hover:text-(--foreground)",
                    )}
                  >
                    {Icon ? (
                      <Icon
                        className={cn(
                          "size-4 shrink-0",
                          isActive
                            ? "text-current"
                            : "text-[color-mix(in_srgb,var(--foreground)_62%,transparent)] group-hover/view:text-current",
                        )}
                      />
                    ) : null}
                    <span
                      aria-hidden={!isActive}
                      data-tab-label-visible={isActive ? "true" : "false"}
                      className={cn(
                        "grid min-w-0 overflow-hidden",
                        isActive ? "grid-cols-[1fr]" : "grid-cols-[0fr]",
                      )}
                    >
                      <span className="min-w-0 overflow-hidden">
                        <span className="block pl-1.5 pt-px text-left">{item.label}</span>
                      </span>
                    </span>
                  </TabsPrimitive.Trigger>
                );
              })}
            </TabsPrimitive.List>
          </TabsPrimitive.Root>
          {destinationItems.map((item) => {
            const Icon = item.icon;
            return (
              <NodexTooltip key={item.id} tooltipContent={item.label}>
                <button
                  type="button"
                  aria-label={item.label}
                  className={cn(
                    "group/view mx-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full",
                    "text-(--foreground-secondary) outline-none",
                    "hover:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)] hover:text-(--foreground)",
                    "focus-visible:ring-2 focus-visible:ring-(--ring)/35",
                  )}
                  onClick={item.onSelect}
                >
                  {Icon ? (
                    <Icon className="size-4 text-[color-mix(in_srgb,var(--foreground)_62%,transparent)] group-hover/view:text-current" />
                  ) : null}
                </button>
              </NodexTooltip>
            );
          })}

          {viewContextLabel ? (
            <div className="flex min-w-0 shrink items-center">{viewContextLabel}</div>
          ) : null}

          <div className="ml-auto flex h-full items-center justify-end gap-0.5">
            {managementControl}
            {databaseViewControls}

            {showSearchControls ? (
              <div className="flex items-center">
                <NodexIconButton
                  icon={SearchIcon}
                  size="sm"
                  ariaLabel="Search"
                  title={`Task search (${searchShortcutLabel})`}
                  onClick={() => onOpenTaskSearch(true)}
                />

                <div
                  aria-hidden={!showSearchField}
                  className={cn(
                    "overflow-hidden transition-[width,opacity,margin] duration-200 ease-out",
                    showSearchField ? "ml-1 w-[150px] opacity-100" : "ml-0 w-0 opacity-0",
                  )}
                >
                  <div className="flex items-center overflow-hidden">
                    <div className="mb-px flex w-full items-center pr-1 text-sm text-(--foreground)">
                      <input
                        ref={taskSearchInputRef}
                        type="text"
                        value={activeSearchQuery}
                        onChange={(event) => onSearchQueryChange(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Escape") return;
                          event.preventDefault();
                          onCloseTaskSearch();
                        }}
                        placeholder="Type to search..."
                        aria-label="Search tasks"
                        tabIndex={showSearchField ? 0 : -1}
                        className={cn(
                          "w-full border-none bg-transparent p-0 text-sm text-(--foreground) outline-none",
                          "placeholder:text-(--foreground-tertiary)",
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const nextAction = resolveDbViewToolbarClearAction(hasActiveSearchQuery);
                          if (nextAction.shouldClear) {
                            onSearchQueryChange("");
                          }
                          if (nextAction.shouldClose) {
                            onCloseTaskSearch();
                          }
                        }}
                        aria-label={hasActiveSearchQuery ? "Clear search" : "Close search"}
                        className={cn(
                          "inline-flex size-6 shrink-0 items-center justify-center rounded-full",
                          "text-(--foreground-tertiary) hover:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)] hover:text-(--foreground-secondary)",
                        )}
                      >
                        <XCircle className="size-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {rulesSummaryRow}
    </header>
  );
}
