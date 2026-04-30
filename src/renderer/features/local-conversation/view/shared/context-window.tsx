import { NodexTooltip } from "@/components/ui/tooltip";
import { cn } from "../../../../lib/utils";
import type { CodexAccountSnapshot } from "@/lib/types";
import type { ContextWindowIndicatorState } from "@/lib/codex-context-window";

const PROMPT_TEXTAREA_MAX_VIEWPORT_RATIO = 0.25;
const FALLBACK_PROMPT_TEXTAREA_MAX_HEIGHT_PX = 220;
const CONTEXT_RING_RADIUS = 5;
const CONTEXT_RING_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_RING_RADIUS;
const WHOLE_TOKEN_FORMATTER = new Intl.NumberFormat("en-US");

export function resolvePromptTextareaMaxHeightPx(): number {
  if (typeof window === "undefined") return FALLBACK_PROMPT_TEXTAREA_MAX_HEIGHT_PX;

  const maxHeightPx = Math.floor(window.innerHeight * PROMPT_TEXTAREA_MAX_VIEWPORT_RATIO);
  if (!Number.isFinite(maxHeightPx) || maxHeightPx <= 0) {
    return FALLBACK_PROMPT_TEXTAREA_MAX_HEIGHT_PX;
  }

  return maxHeightPx;
}

function formatRoundedTokenThousands(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "0k";
  return `${Math.max(0, Math.round(value / 1_000))}k`;
}

function formatWholeTokenCount(value: number): string {
  const normalizedValue = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return WHOLE_TOKEN_FORMATTER.format(normalizedValue);
}

function shouldShowAutoCompactionNote(account: CodexAccountSnapshot | null): boolean {
  return account?.account?.type === "chatgpt";
}

export function ContextWindowTooltipContent({
  state,
  showAutoCompactionNote,
}: {
  state: ContextWindowIndicatorState;
  showAutoCompactionNote: boolean;
}) {
  if (state.status !== "ready" || state.usedTokens === null || state.windowTokens === null) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="whitespace-pre-line text-token-input-placeholder-foreground">Context window:</span>
        <span>0% used (100% left)</span>
      </div>
    );
  }

  const remainingPercent = Math.max(0, 100 - state.percentFull);
  const isFullLabel = state.percentFull >= 50;

  return (
    <div className="flex w-38 flex-col gap-0.5 text-center">
      <span className="whitespace-pre-line text-token-input-placeholder-foreground">Context window:</span>
      <span className={isFullLabel ? "text-token-input-placeholder-foreground" : undefined}>
        {isFullLabel
          ? `${state.percentFull}% full`
          : `${state.percentFull}% used (${remainingPercent}% left)`}
      </span>
      <span>{formatRoundedTokenThousands(state.usedTokens)} / {formatRoundedTokenThousands(state.windowTokens)} tokens used</span>
      {showAutoCompactionNote ? <p className="mt-2 font-medium">Codex automatically compacts its context</p> : null}
    </div>
  );
}

function contextWindowAriaLabel(state: ContextWindowIndicatorState): string {
  if (state.status === "ready" && state.usedTokens !== null && state.windowTokens !== null) {
    if (state.percentFull >= 50) {
      return `Context window ${state.percentFull}% full, ${formatWholeTokenCount(state.usedTokens)} of ${formatWholeTokenCount(state.windowTokens)} tokens used`;
    }

    return `Context window ${state.percentFull}% used, ${Math.max(0, 100 - state.percentFull)}% left, ${formatWholeTokenCount(state.usedTokens)} of ${formatWholeTokenCount(state.windowTokens)} tokens used`;
  }

  return "Context window 0% used, 100% left";
}

export function ContextWindowIndicator({
  state,
  account,
  className,
  showFallbackLabel = true,
}: {
  state: ContextWindowIndicatorState;
  account: CodexAccountSnapshot | null;
  className?: string;
  showFallbackLabel?: boolean;
}) {
  const dashOffset = CONTEXT_RING_CIRCUMFERENCE * (1 - state.percentFull / 100);
  const shouldShowFallbackLabel = showFallbackLabel && state.status !== "ready";
  const showAutoCompaction = shouldShowAutoCompactionNote(account);

  return (
    <NodexTooltip
      tooltipContent={(
        <ContextWindowTooltipContent
          state={state}
          showAutoCompactionNote={showAutoCompaction}
        />
      )}
      side="top"
    >
      <button
        type="button"
        aria-label={contextWindowAriaLabel(state)}
        className={cn(
          "ml-2 inline-flex items-center gap-1 rounded-full text-token-description-foreground outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
          className,
        )}
      >
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" className="shrink-0">
          <circle cx="6" cy="6" r={CONTEXT_RING_RADIUS} stroke="currentColor" strokeWidth="2" fill="none" opacity="0.16" />
          <circle
            cx="6"
            cy="6"
            r={CONTEXT_RING_RADIUS}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
            strokeDasharray={CONTEXT_RING_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 6 6)"
            opacity={state.status === "unavailable" ? 0 : 1}
          />
        </svg>
        {shouldShowFallbackLabel ? (
          <span className="composer-footer__label--sm select-none whitespace-nowrap text-sm text-token-input-placeholder-foreground opacity-60">
            0%
          </span>
        ) : null}
      </button>
    </NodexTooltip>
  );
}
