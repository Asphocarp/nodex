import { ArrowUpRight } from "lucide-react";
import type {
  ProjectAgentDockModel,
  ProjectAgentDockPendingWorktreeModel,
  ProjectAgentDockTargetRow,
} from "@/lib/project-agent-dock-model";
import {
  RightPanelComposerOverlay,
  type RightPanelComposerOverlayAttention,
} from "@/features/local-conversation/view/right-panel-composer-overlay";
import { RIGHT_PANEL_COMPOSER_ACCESSORY_INLINE_INSET_CLASS } from "@/features/local-conversation/view/right-panel-composer-presentation";
import { cn } from "@/lib/utils";
import { ProjectAgentDockTargetSelector } from "./project-agent-dock-target-selector";

export interface ProjectAgentDockLeadingRowProps {
  readonly model: ProjectAgentDockModel;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly onSelect: (row: ProjectAgentDockTargetRow) => void;
  readonly onLoadMore: () => void;
  readonly onRetry: () => void;
  readonly onOpenTask: () => void;
  readonly pendingWorktree?: ProjectAgentDockPendingWorktreeModel | null;
  readonly onOpenPendingWorktreeDetails?: () => void;
}

export function ProjectAgentDockLeadingRow({
  model,
  query,
  onQueryChange,
  onSelect,
  onLoadMore,
  onRetry,
  onOpenTask,
  pendingWorktree = null,
  onOpenPendingWorktreeDetails,
}: ProjectAgentDockLeadingRowProps) {
  const canOpenTask = model.trigger.kind === "session";

  return (
    <div
      data-testid="project-agent-dock-target-row"
      className={cn(
        RIGHT_PANEL_COMPOSER_ACCESSORY_INLINE_INSET_CLASS,
        "flex min-w-0 items-center gap-1 px-1.5 pb-1",
      )}
    >
      <ProjectAgentDockTargetSelector
        model={model}
        query={query}
        onQueryChange={onQueryChange}
        onSelect={onSelect}
        onLoadMore={onLoadMore}
        onRetry={onRetry}
      />
      {pendingWorktree && onOpenPendingWorktreeDetails ? (
        <button
          type="button"
          aria-label={`${pendingWorktree.statusLabel} View setup details`}
          data-project-agent-dock-pending-attention={pendingWorktree.attention}
          className="ml-auto inline-flex h-7 shrink-0 cursor-interaction items-center gap-1 rounded-lg px-2 text-xs text-token-description-foreground hover:bg-token-foreground/5 hover:text-token-foreground focus-visible:bg-token-foreground/5 focus-visible:outline-none data-[project-agent-dock-pending-attention=request]:text-token-error-foreground"
          onClick={onOpenPendingWorktreeDetails}
        >
          {pendingWorktree.statusLabel}
          <ArrowUpRight className="size-3" aria-hidden="true" />
        </button>
      ) : canOpenTask ? (
        <button
          type="button"
          className="ml-auto inline-flex h-7 shrink-0 cursor-interaction items-center gap-1 rounded-lg px-2 text-xs text-token-description-foreground hover:bg-token-foreground/5 hover:text-token-foreground focus-visible:bg-token-foreground/5 focus-visible:outline-none"
          onClick={onOpenTask}
        >
          Open task
          <ArrowUpRight className="size-3" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export function ProjectAgentDockUnavailableOverlay({
  target,
  visible,
  attention,
  focusRequestKey,
  onVisibleChange,
  leadingContent,
  message,
}: {
  readonly target: HTMLElement | null;
  readonly visible: boolean;
  readonly attention: RightPanelComposerOverlayAttention;
  readonly focusRequestKey?: number;
  readonly onVisibleChange: (visible: boolean) => void;
  readonly leadingContent: React.ReactNode;
  readonly message: string;
}) {
  return (
    <RightPanelComposerOverlay
      target={target}
      visibility={{
        kind: "controlled",
        visible,
        attention,
        focusRequestKey,
        onVisibleChange,
      }}
    >
      <div className="composer-surface-chrome flex min-h-20 flex-col rounded-2xl border border-token-border/60 bg-token-input-background/90 p-2 backdrop-blur-lg electron:dark:bg-token-dropdown-background">
        {leadingContent}
        <div
          role="status"
          className="flex min-h-11 items-center px-2 text-sm text-token-description-foreground"
        >
          {message}
        </div>
      </div>
    </RightPanelComposerOverlay>
  );
}
