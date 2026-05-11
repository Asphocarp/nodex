import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "@/components/shared/icons";
import { resolveCommandExecutionRenderStatus } from "../../../../../../shared/codex-command-execution";
import type { CodexCommandAction, CodexTranscriptEntry } from "../../../../../lib/types";
import { getDisplayCommand } from "../../../../../lib/command-display";
import { resolveCodexThreadDetailLevel } from "../../../../../lib/codex-thread-settings";
import { useCodexThreadSettings } from "../../../../../lib/use-codex-thread-settings";
import { cn } from "../../../../../lib/utils";
import { CODEX_THREAD_ACCORDION_TRANSITION } from "../thread-motion";
import { useMeasuredElementHeight } from "../use-measured-element-height";
import { extractCommandActions, isExplorationAction } from "./command-actions";
import {
  ToolActivityIcon,
  resolveExplorationActionIcon,
  semanticToolIcon,
  type ToolActivityIconDescriptor,
} from "./tool-call-icons";
import { ToolErrorDetail } from "./tool-primitives";
import { ThreadCommandShellBlock } from "./thread-command-shell-block";

interface CommandToolCallProps {
  item: CodexTranscriptEntry;
  threadCwd?: string;
  defaultExpandExecShell?: boolean;
  execSummaryTone?: "default" | "muted";
  showExecSummaryIcon?: boolean;
}

interface CommandToolArgs {
  summaryLabel?: string;
}

type CommandViewState = "preview" | "collapsed" | "expanded";

export interface CommandElapsedSnapshot {
  startedAt: number | null;
  settledElapsedMs: number | null;
  lastMeasuredAt: number;
}

const PREVIEW_TIMEOUT_MS = 200;
const EXPAND_AFTER_START_MS = 2_000;
const EXEC_PREVIEW_HEIGHT_REM = 8;

function normalizePath(path: string | undefined): string | null {
  if (!path) return null;
  const trimmed = path.trim();
  if (trimmed.length === 0) return null;
  const normalized = trimmed.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : null;
}

function shouldShowCwdSubtitle(commandCwd: string | undefined, threadCwd: string | undefined): boolean {
  const normalizedCommandCwd = normalizePath(commandCwd);
  const normalizedThreadCwd = normalizePath(threadCwd);
  if (!normalizedCommandCwd || !normalizedThreadCwd) return false;
  return normalizedCommandCwd !== normalizedThreadCwd;
}

function formatElapsedDuration(elapsedMs: number): string | null {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 1_000) return null;

  const totalSeconds = Math.floor(elapsedMs / 1_000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours > 0) {
    return seconds > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  return `${seconds}s`;
}

export function reconcileCommandElapsedSnapshot(
  snapshot: CommandElapsedSnapshot,
  status: string | undefined,
  now: number,
): CommandElapsedSnapshot {
  if (status === "inProgress") {
    return {
      startedAt: snapshot.startedAt ?? now,
      settledElapsedMs: null,
      lastMeasuredAt: now,
    };
  }

  if (snapshot.startedAt === null || snapshot.settledElapsedMs !== null) {
    return snapshot;
  }

  return {
    startedAt: null,
    settledElapsedMs: Math.max(now - snapshot.startedAt, 0),
    lastMeasuredAt: now,
  };
}

export function formatCommandMetaText(
  elapsedLabel: string | null,
  cwdSubtitle: string | undefined,
): string | null {
  const metaParts: string[] = [];
  if (elapsedLabel) metaParts.push(`for ${elapsedLabel}`);
  if (cwdSubtitle) metaParts.push(cwdSubtitle);
  if (metaParts.length === 0) return null;
  return metaParts.join(" · ");
}

function useElapsedLabel(status: string | undefined): string | null {
  const startedAtRef = useRef<number | null>(status === "inProgress" ? Date.now() : null);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (status === "inProgress") {
      startedAtRef.current ??= Date.now();
      const update = () => {
        if (startedAtRef.current === null) return;
        setElapsedMs(Date.now() - startedAtRef.current);
      };
      update();
      const intervalId = window.setInterval(update, 1_000);
      return () => window.clearInterval(intervalId);
    }

    if (startedAtRef.current !== null) {
      setElapsedMs(Date.now() - startedAtRef.current);
      startedAtRef.current = null;
    }
  }, [status]);

  return formatElapsedDuration(elapsedMs);
}

function resolveSummaryLabel(
  command: string,
  effectiveStatus: string | undefined,
  summaryLabel?: string,
  markdownText?: string,
): string {
  if (summaryLabel && summaryLabel.trim().length > 0) return summaryLabel.trim();
  if (markdownText && markdownText.trim().length > 0) return markdownText.trim();
  if (effectiveStatus === "inProgress") return `Running ${command}`;
  return `Ran ${command}`;
}

function formatExplorationSummary(actions: CodexCommandAction[], effectiveStatus: string | undefined): string {
  const verb = effectiveStatus === "inProgress" ? "Exploring" : "Explored";
  if (actions.length === 0) return verb;
  return `${verb} ${actions.length} ${actions.length === 1 ? "step" : "steps"}`;
}

function renderExplorationLine(action: CodexCommandAction): string {
  if (action.type === "read") return `Read ${action.name || action.path}`;
  if (action.type === "listFiles") return `Listed ${action.path || "files"}`;
  if (action.type === "search") {
    if (action.query && action.path) return `Searched for ${action.query} in ${action.path}`;
    if (action.query) return `Searched for ${action.query}`;
  }
  return action.command;
}

function resolveCommandHeaderIcon(actions: CodexCommandAction[], isExploration: boolean): ToolActivityIconDescriptor {
  if (!isExploration) return semanticToolIcon("run-command");
  if (actions.some((action) => resolveExplorationActionIcon(action) === "skill")) return semanticToolIcon("skill");
  if (actions.some((action) => action.type === "search")) return semanticToolIcon("code-searching");
  if (actions.some((action) => action.type === "listFiles")) return semanticToolIcon("list-files");
  return semanticToolIcon("run-command");
}

function SummaryText({
  command,
  summaryLabel,
  elapsedLabel,
  commandCwd,
  threadCwd,
  isExpanded,
  tone,
}: {
  command: string;
  summaryLabel: string;
  elapsedLabel: string | null;
  commandCwd?: string;
  threadCwd?: string;
  isExpanded: boolean;
  tone: "default" | "muted";
}) {
  const metaParts: string[] = [];
  if (elapsedLabel) metaParts.push(`for ${elapsedLabel}`);
  if (shouldShowCwdSubtitle(commandCwd, threadCwd) && commandCwd) metaParts.push(`in ${commandCwd}`);
  const labelClassName = tone === "muted"
    ? "text-token-foreground/40 group-hover:text-token-foreground"
    : "text-token-description-foreground group-hover:text-token-foreground";

  return (
    <div className="min-w-0 flex-1 text-size-chat truncate text-token-foreground/40 group-hover:text-token-foreground">
      <span className={cn("font-sans", labelClassName)}>
        {summaryLabel}
      </span>
      {metaParts.length > 0 ? (
        <span className="ml-1 text-token-foreground/30">
          {metaParts.join(" · ")}
        </span>
      ) : null}
      {!isExpanded ? null : <span className="sr-only">{command}</span>}
    </div>
  );
}

function CommandFooter({
  isInProgress,
  exitCode,
  effectiveStatus,
}: {
  isInProgress: boolean;
  exitCode: number | null;
  effectiveStatus: string | undefined;
}) {
  const isSuccess = effectiveStatus === "completed" || (exitCode !== null && exitCode === 0);

  return (
    <div className="text-size-chat flex items-center gap-2 px-2.5 pt-0.5 pb-1 text-token-input-placeholder-foreground">
      <span className="ml-auto flex items-center gap-1">
        {isInProgress ? (
          <>
            <span className="size-2 animate-pulse rounded-full bg-(--accent-blue)" />
            Running
          </>
        ) : (
          <>
            <svg width="17" height="17" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg" className="icon-xxs">
              <path d="M12.8961 3.64101C13.1297 3.41418 13.4984 3.37523 13.7779 3.56581C14.0571 3.75635 14.1554 4.11331 14.0299 4.41347L13.9615 4.53847L7.71151 13.7045C7.59411 13.8767 7.4063 13.9877 7.19881 14.0072C6.99136 14.0267 6.78564 13.9533 6.63826 13.806L2.88826 10.056L2.79842 9.9457C2.6192 9.67407 2.64927 9.30496 2.88826 9.06581C3.12738 8.82669 3.49647 8.79676 3.76815 8.97597L3.8785 9.06581L7.03084 12.2182L12.8053 3.74941L12.8961 3.64101Z" fill="currentColor" />
            </svg>
            {isSuccess ? "Success" : exitCode !== null ? `Exit ${exitCode}` : "Finished"}
          </>
        )}
      </span>
    </div>
  );
}

export function CommandToolCall({
  item,
  threadCwd,
  defaultExpandExecShell,
  execSummaryTone = "default",
  showExecSummaryIcon = true,
}: CommandToolCallProps) {
  const { settings } = useCodexThreadSettings();
  const threadDetailLevel = resolveCodexThreadDetailLevel(settings.detailLevel);
  if (threadDetailLevel === "STEPS_PROSE") return null;

  const toolArgs = (typeof item.toolCall?.args === "object" && item.toolCall.args !== null)
    ? item.toolCall.args as CommandToolArgs
    : {};
  const rawCommand = typeof item.command === "string" && item.command.trim().length > 0
    ? item.command
    : "command";
  const command = getDisplayCommand(rawCommand);
  const output = item.aggregatedOutput ?? "";
  const exitCode = item.exitCode ?? null;
  const effectiveStatus = resolveCommandExecutionRenderStatus({
    itemStatus: item.status,
  });
  const isInProgress = effectiveStatus === "inProgress";
  const elapsedLabel = useElapsedLabel(effectiveStatus);
  const commandActions = extractCommandActions(item);
  const isExploration = commandActions.length > 0 && commandActions.every(isExplorationAction);
  const prefersExpandedWhenSettled = defaultExpandExecShell ?? threadDetailLevel === "STEPS_EXECUTION";
  const [viewState, setViewState] = useState<CommandViewState>(() => (
    prefersExpandedWhenSettled && !isInProgress ? "expanded" : "collapsed"
  ));
  const previewTimeoutRef = useRef<number | null>(null);
  const expandTimeoutRef = useRef<number | null>(null);
  const previousInProgressRef = useRef(false);
  const previousThreadDetailLevelRef = useRef(threadDetailLevel);
  const viewStateRef = useRef<CommandViewState>(viewState);
  const { elementHeightPx: bodyHeightPx, elementRef: bodyRef } = useMeasuredElementHeight();

  useEffect(() => {
    viewStateRef.current = viewState;
  }, [viewState]);

  useEffect(() => {
    if (previousThreadDetailLevelRef.current === threadDetailLevel) return;
    previousThreadDetailLevelRef.current = threadDetailLevel;
    if (isInProgress) return;
    setViewState(prefersExpandedWhenSettled ? "expanded" : "collapsed");
  }, [isInProgress, prefersExpandedWhenSettled, threadDetailLevel]);

  useEffect(() => {
    if (previewTimeoutRef.current !== null) {
      window.clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = null;
    }
    if (expandTimeoutRef.current !== null) {
      window.clearTimeout(expandTimeoutRef.current);
      expandTimeoutRef.current = null;
    }

    const wasInProgress = previousInProgressRef.current;

    if (wasInProgress && !isInProgress) {
      if (viewStateRef.current === "expanded") {
        setViewState("preview");
        previewTimeoutRef.current = window.setTimeout(() => {
          setViewState("collapsed");
          previewTimeoutRef.current = null;
        }, PREVIEW_TIMEOUT_MS);
      }
    }

    if (!wasInProgress && isInProgress) {
      expandTimeoutRef.current = window.setTimeout(() => {
        setViewState("expanded");
        expandTimeoutRef.current = null;
      }, EXPAND_AFTER_START_MS);
    }

    previousInProgressRef.current = isInProgress;

    return () => {
      if (previewTimeoutRef.current !== null) {
        window.clearTimeout(previewTimeoutRef.current);
        previewTimeoutRef.current = null;
      }
      if (expandTimeoutRef.current !== null) {
        window.clearTimeout(expandTimeoutRef.current);
        expandTimeoutRef.current = null;
      }
    };
  }, [isInProgress]);

  const isExpanded = viewState === "expanded";
  const summaryLabel = isExploration
    ? formatExplorationSummary(commandActions, effectiveStatus)
    : resolveSummaryLabel(command, effectiveStatus, toolArgs.summaryLabel, item.markdownText);

  const handleToggle = () => {
    if (isInProgress && viewState === "expanded") return;
    setViewState((currentState) => (currentState === "expanded" ? "collapsed" : "expanded"));
  };

  const header = (
    <div
      className="group flex items-start gap-1 px-0 py-0 cursor-interaction"
      data-command-tool-summary-toggle
      onClick={handleToggle}
    >
      <div className="flex min-w-0 items-center gap-1">
        {showExecSummaryIcon ? <ToolActivityIcon descriptor={resolveCommandHeaderIcon(commandActions, isExploration)} /> : null}
        <SummaryText
          command={command}
          summaryLabel={summaryLabel}
          elapsedLabel={elapsedLabel}
          commandCwd={item.cwd ?? undefined}
          threadCwd={threadCwd}
          isExpanded={isExpanded}
          tone={execSummaryTone}
        />
        {!isInProgress ? (
          <span className={cn("inline-chevron flex-shrink-0 text-token-input-placeholder-foreground transition-opacity duration-200 opacity-0 group-hover:opacity-100", isExpanded && "opacity-100")}>
            <ChevronDownIcon className={cn("icon-2xs text-current transition-transform duration-300", isExpanded ? "rotate-0" : "-rotate-90")} />
          </span>
        ) : null}
      </div>
    </div>
  );

  const body = isExploration ? (
    <div className="pt-2">
      <div className="flex flex-col gap-1.5 text-size-chat-sm text-token-description-foreground">
        {commandActions.map((action, index) => (
          <div key={`${action.type}:${index}`} className="flex min-w-0 items-start font-vscode-editor whitespace-pre-wrap break-words">
            <span className="min-w-0 flex-1">{renderExplorationLine(action)}</span>
          </div>
        ))}
        {item.toolCall?.error ? <ToolErrorDetail error={item.toolCall.error} className="pt-1" /> : null}
      </div>
    </div>
  ) : (
    <div className="pt-2">
        <ThreadCommandShellBlock
        variant="embedded"
      command={command}
        output={output}
        cwd={item.cwd ?? undefined}
        isInProgress={isInProgress}
        footer={(
          <CommandFooter
            isInProgress={isInProgress}
            exitCode={exitCode}
            effectiveStatus={effectiveStatus}
          />
        )}
      />
    </div>
  );
  const previewHeightPx = bodyHeightPx > 0
    ? Math.min(bodyHeightPx, EXEC_PREVIEW_HEIGHT_REM * 16)
    : EXEC_PREVIEW_HEIGHT_REM * 16;
  const measuredHeight = viewState === "expanded"
    ? bodyHeightPx
    : viewState === "preview"
      ? previewHeightPx
      : 0;
  const isMeasuredOpen = viewState !== "collapsed";

  return (
    <div className="min-w-0 text-size-chat relative overflow-visible py-0">
      <div className="px-0">
        <div className="relative flex flex-col overflow-clip">
          {header}
          <motion.div
            className={cn(isMeasuredOpen ? "overflow-visible" : "overflow-hidden")}
            data-thread-find-skip={isMeasuredOpen ? undefined : true}
            initial={false}
            animate={{
              height: Math.max(measuredHeight, 0),
              opacity: isMeasuredOpen ? 1 : 0,
            }}
            transition={CODEX_THREAD_ACCORDION_TRANSITION}
            style={{
              overflow: isExpanded ? "visible" : "hidden",
              pointerEvents: isMeasuredOpen ? "auto" : "none",
            }}
          >
            <div ref={bodyRef}>
              {body}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
