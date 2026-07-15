import { ChevronRight, Ellipsis } from "lucide-react";
import {
  NodexDropdownItem,
  NodexDropdownMenu,
} from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";

export interface CardStageBreadcrumbItem {
  readonly projectId: string;
  readonly cardId: string;
  readonly title: string;
  readonly disabled?: boolean;
}

export interface CardStageBreadcrumbProps {
  readonly ancestors: readonly CardStageBreadcrumbItem[];
  readonly currentTitle: string;
  readonly disabled?: boolean;
  readonly onOpenAncestor: (
    ancestor: CardStageBreadcrumbItem,
    ancestorIndex: number,
  ) => void;
}

interface IndexedBreadcrumbItem {
  readonly item: CardStageBreadcrumbItem;
  readonly index: number;
}

const MAX_INLINE_ANCESTORS = 3;

function breadcrumbLabel(title: string): string {
  return title.trim() || "Untitled";
}

function CardStageBreadcrumbSeparator() {
  return (
    <ChevronRight
      aria-hidden="true"
      className="icon-2xs shrink-0 text-token-description-foreground"
    />
  );
}

function CardStageBreadcrumbAncestor({
  entry,
  showSeparator,
  disabled,
  onOpenAncestor,
}: {
  readonly entry: IndexedBreadcrumbItem;
  readonly showSeparator: boolean;
  readonly disabled: boolean;
  readonly onOpenAncestor: CardStageBreadcrumbProps["onOpenAncestor"];
}) {
  const label = breadcrumbLabel(entry.item.title);
  const itemDisabled = disabled || entry.item.disabled === true;
  return (
    <li className="flex min-w-0 shrink items-center gap-1">
      {showSeparator ? <CardStageBreadcrumbSeparator /> : null}
      <button
        type="button"
        title={label}
        disabled={itemDisabled}
        onClick={() => onOpenAncestor(entry.item, entry.index)}
        className={cn(
          "min-w-0 max-w-36 truncate rounded-md px-1 py-0.5 text-token-text-secondary outline-hidden",
          "hover:bg-token-foreground/5 hover:text-token-text-primary focus-visible:ring-token-focus focus-visible:ring-2",
          itemDisabled && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-token-text-secondary",
        )}
      >
        {label}
      </button>
    </li>
  );
}

export function CardStageBreadcrumb({
  ancestors,
  currentTitle,
  disabled = false,
  onOpenAncestor,
}: CardStageBreadcrumbProps) {
  if (ancestors.length === 0) return null;

  const indexedAncestors = ancestors.map((item, index) => ({ item, index }));
  const hasOverflow = indexedAncestors.length > MAX_INLINE_ANCESTORS;
  const leading = hasOverflow ? indexedAncestors.slice(0, 1) : indexedAncestors;
  const overflow = hasOverflow ? indexedAncestors.slice(1, -2) : [];
  const trailing = hasOverflow ? indexedAncestors.slice(-2) : [];
  const currentLabel = breadcrumbLabel(currentTitle);

  return (
    <nav
      aria-label="Card hierarchy"
      className="min-w-0 flex-1 overflow-hidden text-xs"
      data-card-stage-breadcrumb="true"
    >
      <ol className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap">
        {leading.map((entry, index) => (
          <CardStageBreadcrumbAncestor
            key={`${entry.item.projectId}:${entry.item.cardId}:${entry.index}`}
            entry={entry}
            showSeparator={index > 0}
            disabled={disabled}
            onOpenAncestor={onOpenAncestor}
          />
        ))}

        {overflow.length > 0 ? (
          <li className="flex shrink-0 items-center gap-1">
            <CardStageBreadcrumbSeparator />
            <NodexDropdownMenu
              disabled={disabled}
              side="bottom"
              align="start"
              contentWidth="menuBounded"
              triggerButton={(
                <button
                  type="button"
                  aria-label="More ancestor cards"
                  title="More ancestor cards"
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded-md text-token-description-foreground outline-hidden",
                    "hover:bg-token-foreground/5 hover:text-token-text-primary focus-visible:ring-token-focus focus-visible:ring-2",
                    disabled && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-token-description-foreground",
                  )}
                >
                  <Ellipsis className="icon-2xs shrink-0" />
                </button>
              )}
            >
              {overflow.map((entry) => {
                const label = breadcrumbLabel(entry.item.title);
                return (
                  <NodexDropdownItem
                    key={`${entry.item.projectId}:${entry.item.cardId}:${entry.index}`}
                    tooltipText={label}
                    disabled={disabled || entry.item.disabled === true}
                    onSelect={() => onOpenAncestor(entry.item, entry.index)}
                  >
                    {label}
                  </NodexDropdownItem>
                );
              })}
            </NodexDropdownMenu>
          </li>
        ) : null}

        {trailing.map((entry) => (
          <CardStageBreadcrumbAncestor
            key={`${entry.item.projectId}:${entry.item.cardId}:${entry.index}`}
            entry={entry}
            showSeparator={true}
            disabled={disabled}
            onOpenAncestor={onOpenAncestor}
          />
        ))}

        <li className="flex min-w-0 flex-1 items-center gap-1">
          <CardStageBreadcrumbSeparator />
          <span
            aria-current="page"
            title={currentLabel}
            className="min-w-0 truncate px-1 py-0.5 text-token-text-primary"
          >
            {currentLabel}
          </span>
        </li>
      </ol>
    </nav>
  );
}
