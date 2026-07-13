import { useId, type ReactNode } from "react";
import {
  Archive,
  ChevronRight,
  ExternalLink,
  Rows3,
  TriangleAlert,
} from "lucide-react";
import type { DatabaseViewReadModel } from "../../../shared/database-views";
import { isInlineCardCycle } from "./block-reference-runtime-context";
import type { CardSummary } from "@/lib/types";
import { resolveKanbanPriorityOption } from "@/lib/kanban-options";
import {
  ReferenceExpansionStore,
  ReferenceSurfaceActivationBudget,
  referenceExpansionStore,
  referenceSurfaceActivationBudget,
  useReferenceExpansion,
  useReferenceSurfaceActivation,
} from "@/lib/reference-surface-state";
import { StatusIcon } from "@/lib/status-chip";
import { useElementVisibility } from "@/lib/use-element-visibility";
import { cn } from "@/lib/utils";

export interface ReferencedCardDocumentInput {
  readonly projectId: string;
  readonly card: CardSummary;
  readonly isActive: boolean;
}

export type ReferencedCardDocumentRenderer = (
  input: ReferencedCardDocumentInput,
) => ReactNode;

interface ReferenceSurfaceStateDependencies {
  readonly expansionStore?: ReferenceExpansionStore;
  readonly activationBudget?: ReferenceSurfaceActivationBudget;
  /** Deterministic test/story seam; production always uses IntersectionObserver. */
  readonly visibilityOverride?: boolean;
}

export interface ReferencedCardRowProps extends ReferenceSurfaceStateDependencies {
  readonly activationKey: string;
  readonly projectId: string;
  readonly card: CardSummary;
  readonly canEdit: boolean;
  readonly archived?: boolean;
  readonly legacy?: boolean;
  readonly inlineEditingDisabledReason?: string;
  readonly metadata?: ReactNode;
  readonly renderDocument?: ReferencedCardDocumentRenderer;
  readonly onOpenCard?: (input: {
    projectId: string;
    cardId: string;
    titleSnapshot?: string;
  }) => void | Promise<void>;
}

const META_CHIP =
  "inline-flex h-5 shrink-0 items-center rounded-sm bg-token-foreground/5 px-1.5 text-xs text-token-description-foreground";

function CardRowMetadata({
  card,
  archived,
}: {
  readonly card: CardSummary;
  readonly archived: boolean;
}) {
  const priority = resolveKanbanPriorityOption(card.priority);
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
      {priority ? (
        <span className={cn(META_CHIP, priority.className)}>
          {priority.shortLabel.split(" - ")[0]}
        </span>
      ) : null}
      {card.estimate ? (
        <span className={META_CHIP}>{card.estimate.toUpperCase()}</span>
      ) : null}
      <span
        className="inline-flex min-w-0 items-center gap-1 text-xs text-token-description-foreground"
        title={archived ? "Archived" : card.status}
      >
        {archived ? (
          <Archive aria-hidden="true" className="size-3.5 shrink-0" />
        ) : (
          <StatusIcon statusId={card.status} className="size-3.5!" />
        )}
      </span>
    </span>
  );
}

export function ReferencedCardRow({
  activationKey,
  projectId,
  card,
  canEdit,
  archived = false,
  legacy = false,
  inlineEditingDisabledReason,
  metadata,
  renderDocument,
  onOpenCard,
  expansionStore = referenceExpansionStore,
  activationBudget = referenceSurfaceActivationBudget,
  visibilityOverride,
}: ReferencedCardRowProps) {
  const surfaceInstanceId = useId();
  const surfaceInstanceKey = `${activationKey}:mount:${surfaceInstanceId}`;
  const [expanded, setExpanded] = useReferenceExpansion(
    surfaceInstanceKey,
    expansionStore,
  );
  const visibility = useElementVisibility();
  const visible = visibilityOverride ?? visibility.visible;
  const active = useReferenceSurfaceActivation(
    surfaceInstanceKey,
    canEdit && expanded && visible,
    activationBudget,
  );
  const title = card.title.trim() || "Untitled";
  const expandable = canEdit && typeof renderDocument === "function";

  return (
    <section
      ref={visibility.ref}
      contentEditable={false}
      data-reference-card={card.id}
      data-reference-project={projectId}
      data-reference-expanded={expanded ? "true" : "false"}
      data-reference-editor-active={active ? "true" : "false"}
      className="min-w-0 py-0.5"
      onFocusCapture={() => activationBudget.touch(surfaceInstanceKey)}
      onPointerDownCapture={() => activationBudget.touch(surfaceInstanceKey)}
    >
      <div className="group/reference-row flex min-h-8 min-w-0 items-center gap-1 rounded-md px-1 hover:bg-token-foreground/5">
        <button
          type="button"
          aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
          aria-expanded={expanded}
          disabled={!expandable}
          className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-token-description-foreground",
            expandable
              ? "cursor-pointer hover:bg-token-foreground/10 hover:text-token-text-primary"
              : "cursor-default opacity-35",
          )}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0 transition-transform duration-150 ease-out",
              expanded && "rotate-90",
            )}
          />
        </button>

        <span className="min-w-0 flex-1 truncate text-sm text-token-text-primary">
          {title}
        </span>
        {legacy ? (
          <span className="shrink-0 text-[11px] text-token-description-foreground">
            Migrating
          </span>
        ) : null}
        {inlineEditingDisabledReason ? (
          <span className="shrink-0 text-[11px] text-token-description-foreground">
            {inlineEditingDisabledReason}
          </span>
        ) : null}
        {metadata ?? <CardRowMetadata card={card} archived={archived} />}
        {onOpenCard ? (
          <button
            type="button"
            aria-label={`Open ${title}`}
            title="Open Card"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-token-description-foreground opacity-0 group-hover/reference-row:opacity-100 hover:bg-token-foreground/10 hover:text-token-text-primary focus-visible:opacity-100"
            onClick={() =>
              void onOpenCard({
                projectId,
                cardId: card.id,
                titleSnapshot: title,
              })
            }
          >
            <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="ml-3 min-w-0 border-l-[0.5px] border-token-foreground/10 pl-3">
          {active && renderDocument ? (
            renderDocument({ projectId, card, isActive: true })
          ) : visible && expandable ? (
            <button
              type="button"
              className="my-1 rounded-md px-2 py-1 text-xs text-token-description-foreground hover:bg-token-foreground/5 hover:text-token-text-primary"
              onClick={() => activationBudget.touch(surfaceInstanceKey)}
            >
              Activate inline editor
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

const ReferenceMessage = ({
  icon,
  children,
  tone = "muted",
}: {
  readonly icon: ReactNode;
  readonly children: ReactNode;
  readonly tone?: "muted" | "danger";
}) => (
  <div
    className={cn(
      "flex min-h-8 items-center gap-2 py-1 text-sm",
      tone === "danger"
        ? "text-token-error-foreground"
        : "text-token-description-foreground",
    )}
  >
    {icon}
    <span className="min-w-0 truncate">{children}</span>
  </div>
);

export interface DatabaseViewReferenceSurfaceProps extends ReferenceSurfaceStateDependencies {
  readonly referenceKey: string;
  readonly displayHint: string;
  readonly model: DatabaseViewReadModel | null;
  readonly loading?: boolean;
  readonly error?: Error | null;
  readonly renderDocument?: ReferencedCardDocumentRenderer;
  readonly onOpenCard?: ReferencedCardRowProps["onOpenCard"];
  readonly hostCardId?: string | null;
  readonly ancestorCardIds?: readonly string[];
}

export function DatabaseViewReferenceSurface({
  referenceKey,
  displayHint,
  model,
  loading = false,
  error = null,
  renderDocument,
  onOpenCard,
  hostCardId = null,
  ancestorCardIds = [],
  expansionStore,
  activationBudget,
  visibilityOverride,
}: DatabaseViewReferenceSurfaceProps) {
  if (loading) {
    return (
      <ReferenceMessage
        icon={<Rows3 aria-hidden="true" className="size-3.5 shrink-0" />}
      >
        Loading Database view…
      </ReferenceMessage>
    );
  }
  if (error) {
    return (
      <ReferenceMessage
        tone="danger"
        icon={
          <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
        }
      >
        {error.message || "Couldn’t load this Database view"}
      </ReferenceMessage>
    );
  }
  if (!model) {
    return (
      <ReferenceMessage
        icon={<Rows3 aria-hidden="true" className="size-3.5 shrink-0" />}
      >
        {displayHint.trim() || "Database view unavailable"}
      </ReferenceMessage>
    );
  }

  const name = model.view.name.trim() || displayHint.trim() || "Database view";
  return (
    <section
      contentEditable={false}
      data-database-view={model.view.id}
      className="min-w-0 py-1"
    >
      <header className="flex min-h-8 items-center gap-2 px-1 text-sm">
        <Rows3
          aria-hidden="true"
          className="size-3.5 shrink-0 text-token-description-foreground"
        />
        <span className="min-w-0 flex-1 truncate font-medium text-token-text-primary">
          {name}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-token-description-foreground">
          {model.rows.length}
        </span>
      </header>
      <div className="min-w-0" style={{ contentVisibility: "auto" }}>
        {model.rows.map((row) => {
          const referencesHost = row.card.id === hostCardId;
          const referencesAncestor = isInlineCardCycle(
            ancestorCardIds,
            row.card.id,
          );
          return (
            <ReferencedCardRow
              key={row.card.id}
              activationKey={`${referenceKey}:${row.card.id}`}
              projectId={model.view.projectId}
              card={row.card}
              canEdit={!row.card.archived && !referencesAncestor}
              archived={row.card.archived}
              inlineEditingDisabledReason={
                referencesHost
                  ? "Self"
                  : referencesAncestor
                    ? "Cycle"
                    : undefined
              }
              renderDocument={renderDocument}
              onOpenCard={onOpenCard}
              expansionStore={expansionStore}
              activationBudget={activationBudget}
              visibilityOverride={visibilityOverride}
            />
          );
        })}
      </div>
    </section>
  );
}
