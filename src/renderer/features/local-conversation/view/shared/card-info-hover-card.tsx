import type { ReactNode } from "react";
import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import { EstimateIcon, PriorityValueIcon } from "@/components/shared/icons";
import { StatusLabel } from "@/lib/status-presentation";
import {
  BOARD_STATUS_LABELS,
  resolveBoardPriorityOption,
} from "../../../../lib/board-options";
import { cn } from "../../../../lib/utils";
import type { DatabasePage } from "../../../../lib/types";

const ESTIMATE_LABEL: Record<string, string> = {
  xs: "XS",
  s: "S",
  m: "M",
  l: "L",
  xl: "XL",
};

function formatColumnName(columnId: string): string {
  return BOARD_STATUS_LABELS[columnId] ?? columnId.replace(/_/g, " ").replace(/^\w/, (char) => char.toUpperCase());
}

export function CardInfoHoverCard({
  card,
  columnId,
  children,
}: {
  card: DatabasePage | null;
  columnId: string | null;
  children: ReactNode;
}) {
  if (!card) return <>{children}</>;

  const priorityOption = resolveBoardPriorityOption(card.priority);
  const priorityLabel = priorityOption?.label.replace(" - ", " ") ?? null;
  const descriptionPreview = card.description?.trim()
    ? card.description.slice(0, 140) + (card.description.length > 140 ? "..." : "")
    : null;

  return (
    <HoverCardPrimitive.Root openDelay={0} closeDelay={0}>
      <HoverCardPrimitive.Trigger asChild>
        {children}
      </HoverCardPrimitive.Trigger>
      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          side="bottom"
          align="end"
          sideOffset={2}
          className={cn(
            "z-50 w-72 rounded-xl border shadow-lg",
            "border-[color-mix(in_srgb,var(--border)_85%,transparent)]",
            "bg-[color-mix(in_srgb,var(--background-secondary)_96%,transparent)] backdrop-blur-md",
            "animate-in fade-in-0 zoom-in-[0.985] data-[side=bottom]:slide-in-from-top-1",
            "outline-none",
          )}
        >
          <div className="space-y-2.5 px-3.5 pt-3 pb-3">
            {/* Title */}
            <div className="line-clamp-2 text-sm/snug font-medium text-(--foreground)">
              {card.title}
            </div>

            {/* Description preview */}
            {descriptionPreview && (
              <div className="line-clamp-3 text-xs/relaxed text-(--foreground-secondary)">
                {descriptionPreview}
              </div>
            )}

            {/* Metadata row */}
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Column/status */}
              {columnId && (
                <StatusLabel
                  statusId={columnId}
                  label={formatColumnName(columnId)}
                  className="gap-1 text-[11px]/5 text-(--foreground-secondary)"
                  labelClassName="text-[11px]"
                  iconClassName="size-3.5"
                />
              )}

              {/* Priority */}
              {priorityOption && priorityLabel ? (
                <span className="inline-flex h-5 items-center gap-1 text-[11px]/5 text-(--foreground-secondary)">
                  <PriorityValueIcon priority={card.priority ?? null} className="size-3.5" />
                  <span>{priorityLabel}</span>
                </span>
              ) : null}

              {/* Estimate */}
              {card.estimate && (
                <span className="inline-flex h-5 items-center gap-1 text-[11px]/5 text-(--foreground-secondary)">
                  <EstimateIcon className="size-3.5" />
                  <span>{ESTIMATE_LABEL[card.estimate] ?? card.estimate.toUpperCase()}</span>
                </span>
              )}
            </div>

            {/* Tags */}
            {card.tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                {card.tags.slice(0, 5).map((tag) => (
                  <span
                    key={tag}
                    className="h-4.5 rounded-sm bg-(--background-tertiary) px-1.5 text-[10px] font-medium text-(--foreground-tertiary)"
                  >
                    {tag}
                  </span>
                ))}
                {card.tags.length > 5 && (
                  <span className="text-[10px] text-(--foreground-tertiary)">
                    +{card.tags.length - 5}
                  </span>
                )}
              </div>
            )}

          </div>
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  );
}
