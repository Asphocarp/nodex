import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { motion } from "motion/react";
import { ChevronRightIcon, CodexGoalTargetIcon } from "@/components/shared/icons";
import { MarkdownRenderer } from "../shared/markdown/markdown-renderer";
import { AutomaticApprovalReviewSurface } from "../shared/automatic-approval-review-surface";
import { MultiAgentActionSurface } from "../shared/multi-agent-action-surface";
import { PlanMessage } from "../shared/plan-message";
import { ReasoningSurface } from "../shared/reasoning-surface";
import { TurnDiffSurface } from "../shared/turn-diff-surface";
import {
  AssistantRatingButton,
  CopyMessageActionButton,
  EditMessageIcon,
  ForkMessageIcon,
  MessageTimestamp,
  ThreadActionIconButton,
  ThreadMessageActionRow,
  USER_COPY_FEEDBACK_MS,
  type AssistantMessageRating,
} from "../shared/thread-message-actions";
import { TodoListSurface } from "../shared/todo-list-surface";
import { getToolComponent } from "../shared/tools/get-tool-component";
import { DynamicToolCallSummary } from "../shared/tools/dynamic-tool-call";
import {
  buildDynamicToolCallSummaryPartKey,
  continuesCodexAppLiveActivityBetweenCalls,
} from "../shared/tools/dynamic-tool-call-utils";
import { WebSearchToolCallGroup } from "../shared/tools/web-search-tool-call";
import { AnimatedDiffStats } from "../shared/tools/diff-file-shared";
import {
  JsonBlock,
  ThreadActivityDisclosure,
  ThreadActivityHeader,
  ThreadActivityList,
  THREAD_ACTIVITY_LIST_7_TO_20_REM_MAX_HEIGHT_BY_STATE,
  THREAD_ACTIVITY_LIST_20_REM_MAX_HEIGHT_BY_STATE,
  ThreadActivityShell,
  type ThreadActivitySummaryTransition,
} from "../shared/tools/tool-primitives";
import { resolveMcpToolDisplayName } from "../shared/tools/mcp-tool-call-labels";
import {
  extractCommandActions,
  normalizeExplorationPath,
  resolveExplorationPath,
  resolveExplorationSkillPathInfo,
} from "../shared/tools/command-actions";
import { buildCollapsedToolActivitySummary } from "../../projection/collapsed-tool-activity-summary";
import { shouldDisplayCollapsedToolActivityActiveSummary } from "../../projection/group-exploration-blocks";
import {
  ToolActivityIcon,
  resolveCollapsedToolActivityIcon,
  resolveExplorationEntriesIcon,
  resolveMcpSourceIcon,
  semanticToolIcon,
  type ToolActivityIconDescriptor,
} from "../shared/tools/tool-call-icons";
import { UserMessageText } from "../shared/user-message-collapse";
import {
  CODEX_THREAD_ACCORDION_TRANSITION,
  CODEX_THREAD_DIVIDER_ENTER_ANIMATE,
  CODEX_THREAD_DIVIDER_ENTER_INITIAL,
} from "../shared/thread-motion";
import { useMeasuredElementHeight } from "../shared/use-measured-element-height";
import { CodexShimmerText } from "../shared/codex-shimmer-text";
import { AnsweredUserInputBlock } from "../composer/request-cards/answered-user-input-block";
import { UserAttachmentStrip } from "../shared/user-message-attachments";
import { useWorkedForLabelText } from "../shared/use-worked-for-label";
import type { CodexCommandAction } from "../../../../lib/types";
import type { CodexConversationItem, CodexTurnDiffReviewTarget } from "../../../../lib/types";
import { resolveCodexThreadDetailLevel } from "../../../../lib/codex-thread-settings";
import { logAssistantStreamingDebugState } from "../../../../lib/assistant-streaming-debug";
import { useCodexThreadSettings } from "../../../../lib/use-codex-thread-settings";
import { cn } from "../../../../lib/utils";
import type {
  ThreadAssistantMessageActionsModel,
  ThreadBlockModel,
  ThreadCollapsedToolActivityActiveSummary,
  ThreadPlanSidePanelState,
  ThreadStageActions,
  ThreadSubagentActivityInlineRowModel,
  ThreadTranscriptBlockModel,
  ThreadWorkedForBlockModel,
} from "../../thread-stage-types";
import { THREAD_VISUAL_TOKENS } from "./local-conversation-visual-tokens";

export interface ThreadLeafBlockProps {
  block: ThreadTranscriptBlockModel;
  isLatestTurn: boolean;
  isStreamingTurn: boolean;
  nestedInCollapsedActivity?: boolean;
  isSearchMatch?: boolean;
  isActiveSearchMatch?: boolean;
  projectWorkspacePath?: string | null;
  threadCwd?: string | null;
  onEditLastUserTurn?: (input: { threadId: string; turnId: string; message: string }) => void | Promise<void>;
  onForkFromTurn?: (input: { threadId: string; turnId: string; message: string; isLatestTurn: boolean }) => void | Promise<void>;
  onOpenTurnDiffReview?: (target: CodexTurnDiffReviewTarget) => void;
  onOpenTurnDiffFileInSidePanel?: ThreadStageActions["onOpenTurnDiffFileInSidePanel"];
  onOpenSideChat?: ThreadStageActions["onOpenSideChat"];
  onOpenThread?: ThreadStageActions["onOpenThread"];
  onOpenMcpAppSidePanel?: ThreadStageActions["onOpenMcpAppSidePanel"];
  onOpenPlanInSidePanel?: ThreadStageActions["onOpenPlanInSidePanel"];
  onClosePlanSidePanel?: ThreadStageActions["onClosePlanSidePanel"];
  planSidePanelState?: ThreadPlanSidePanelState | null;
  allowInProgressTurnDiff?: boolean;
  turnDiffHoverPreviewDisabled?: boolean;
  assistantAfter?: ReactNode;
}

export interface ThreadSpecialBlockProps {
  block: ThreadBlockModel;
  isLatestTurn: boolean;
  isStreamingTurn: boolean;
  projectWorkspacePath?: string | null;
  threadCwd?: string | null;
  onOpenTurnDiffReview?: (target: CodexTurnDiffReviewTarget) => void;
  onOpenTurnDiffFileInSidePanel?: ThreadStageActions["onOpenTurnDiffFileInSidePanel"];
  onOpenSideChat?: ThreadStageActions["onOpenSideChat"];
  onOpenThread?: ThreadStageActions["onOpenThread"];
  onOpenMcpAppSidePanel?: ThreadStageActions["onOpenMcpAppSidePanel"];
  onOpenPlanInSidePanel?: ThreadStageActions["onOpenPlanInSidePanel"];
  onClosePlanSidePanel?: ThreadStageActions["onClosePlanSidePanel"];
  planSidePanelState?: ThreadPlanSidePanelState | null;
  turnDiffHoverPreviewDisabled?: boolean;
}

interface ExplorationDisplayLine {
  key: string;
  label: string;
  leadingIcon?: ToolActivityIconDescriptor;
}

function SteeringStatusIcon() {
  return (
    <svg viewBox="0 0 21 21" className="icon-2xs shrink-0 text-token-description-foreground" fill="none" aria-hidden="true">
      <path
        d="M13.1293 7.34753C13.3565 7.12027 13.7081 7.09207 13.9662 7.26257L14.0707 7.34753L18.0707 11.3475C18.3304 11.6072 18.3304 12.0292 18.0707 12.2889L14.0707 16.2889C13.811 16.5486 13.389 16.5486 13.1293 16.2889C12.8696 16.0292 12.8696 15.6072 13.1293 15.3475L15.9935 12.4833H6.59998C4.57585 12.4833 2.93494 10.8424 2.93494 8.81824V5.31824C2.93494 4.95097 3.23271 4.6532 3.59998 4.6532C3.96724 4.6532 4.26501 4.95097 4.26501 5.31824V8.81824C4.26501 10.1078 5.31039 11.1532 6.59998 11.1532H15.9935L13.1293 8.28894L13.0443 8.18445C12.8738 7.92632 12.902 7.5748 13.1293 7.34753Z"
        fill="currentColor"
      />
    </svg>
  );
}

function resolveSteeringStatusLabel(status: CodexConversationItem["steeringStatus"]): string | null {
  if (status === "pending") return "Steering conversation";
  if (status === "accepted") return "Steered conversation";
  return null;
}

function UserMessageGoalStatus() {
  return (
    <div className="ms-1 mr-1 flex items-center gap-2">
      <CodexGoalTargetIcon className="icon-2xs shrink-0 text-token-description-foreground" />
      <span className="text-token-description-foreground text-xs">Sent as goal</span>
    </div>
  );
}

interface ExplorationAccordionModel {
  lines: ExplorationDisplayLine[];
  uniqueReadFileCount: number;
  searchCount: number;
  listCount: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function extractCommandCwd(entry: CodexConversationItem): string | null {
  return entry.cwd ?? null;
}

function formatExplorationLine(action: CodexCommandAction, cwd: string | null): string {
  const resolvedSkillPath = action.type === "read"
    ? resolveExplorationPath(action.path || action.name, cwd)
    : action.type === "search" || action.type === "listFiles"
      ? resolveExplorationPath(action.path, cwd)
      : null;
  const resolvedSkill = resolveExplorationSkillPathInfo(resolvedSkillPath);

  if (resolvedSkill) {
    if (action.type === "read") return `Read ${resolvedSkill.skillName} skill`;
    if (action.type === "search") {
      return action.query && action.query.trim().length > 0
        ? `Searched for ${action.query} in ${resolvedSkill.skillName} skill`
        : `Searched in ${resolvedSkill.skillName} skill`;
    }
    if (action.type === "listFiles") return `Listed files in ${resolvedSkill.skillName} skill`;
  }

  if (action.type === "read") {
    return `Read ${normalizeExplorationPath(action.name) ?? action.name}`;
  }

  if (action.type === "search") {
    if (action.query && action.path) return `Searched for ${action.query} in ${action.path}`;
    if (action.query) return `Searched for ${action.query}`;
    return "Searched for files";
  }

  if (action.type === "listFiles") {
    return action.path ? `Listed files in ${action.path}` : "Listed files";
  }

  return action.command;
}

export function buildExplorationAccordionModel(entries: CodexConversationItem[]): ExplorationAccordionModel {
  const flattenedActions = entries.flatMap((entry, entryIndex) => {
    const cwd = extractCommandCwd(entry);
    return extractCommandActions(entry).map((action, actionIndex) => ({
      key: `${entry.entryId ?? entry.itemId}:${entryIndex}:${action.type}:${actionIndex}`,
      action,
      cwd,
    }));
  });

  const seenReadPaths = new Set<string>();
  let searchCount = 0;
  let listCount = 0;

  for (const flattenedAction of flattenedActions) {
    if (flattenedAction.action.type === "search") searchCount += 1;
    if (flattenedAction.action.type === "listFiles") listCount += 1;
    if (flattenedAction.action.type !== "read") continue;

    const resolvedPath = resolveExplorationPath(
      flattenedAction.action.path || flattenedAction.action.name,
      flattenedAction.cwd,
    );
    if (!resolvedPath) continue;
    seenReadPaths.add(resolvedPath);
  }

  return {
    lines: flattenedActions.map((flattenedAction) => ({
      key: flattenedAction.key,
      label: formatExplorationLine(flattenedAction.action, flattenedAction.cwd),
    })),
    uniqueReadFileCount: seenReadPaths.size,
    searchCount,
    listCount,
  };
}

function ExplorationChevron({ expanded }: { expanded: boolean }) {
  return (
    <ChevronRightIcon
      className={cn(
        "inline-chevron ml-1 text-token-input-placeholder-foreground group-hover:text-token-foreground transition-all duration-500 opacity-0 group-hover:opacity-100",
        expanded && "opacity-100 rotate-90",
      )}
    />
  );
}

function ExplorationCountParts({
  fileCount,
  searchCount,
  listCount,
}: {
  fileCount: number;
  searchCount: number;
  listCount: number;
}) {
  const parts: string[] = [];
  if (fileCount > 0) parts.push(`${fileCount} ${fileCount === 1 ? "file" : "files"}`);
  if (searchCount > 0) parts.push(`${searchCount} ${searchCount === 1 ? "search" : "searches"}`);
  if (listCount > 0) parts.push(`${listCount} ${listCount === 1 ? "list" : "lists"}`);
  if (parts.length === 0) return null;

  return (
    <>
      {parts.map((part, index) => (
        <span key={`${part}:${index}`}>
          {index > 0 ? <span>, </span> : null}
          <span>{part}</span>
        </span>
      ))}
    </>
  );
}

type ExplorationViewState = "preview" | "expanded" | "collapsed";

const EXPLORATION_PREVIEW_MAX_HEIGHT_PX = 7 * 16;
const EXPLORATION_EXPANDED_MAX_HEIGHT_PX = 20 * 16;

function ThreadExplorationAccordion({ entries, status }: { entries: CodexConversationItem[]; status?: CodexConversationItem["status"] }) {
  const accordionId = useId();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const wasExploringRef = useRef(status === "inProgress");
  const hasAutoScrolledRef = useRef(false);
  const isExploring = status === "inProgress";
  const model = useMemo(() => buildExplorationAccordionModel(entries), [entries]);
  const [viewState, setViewState] = useState<ExplorationViewState>(isExploring ? "preview" : "collapsed");
  const { elementHeightPx, elementRef } = useMeasuredElementHeight();

  const resetViewState = useEffectEvent(() => {
    setViewState(isExploring ? "preview" : "collapsed");
    if (isExploring) return;
    hasAutoScrolledRef.current = false;
  });

  useEffect(() => {
    resetViewState();
  }, [isExploring]);

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    const justStartedExploring = isExploring && !wasExploringRef.current;
    wasExploringRef.current = isExploring;

    if (!isExploring) return;
    if (viewState === "collapsed") return;

    scrollElement.scrollTo({
      top: scrollElement.scrollHeight,
      behavior: hasAutoScrolledRef.current && !justStartedExploring ? "smooth" : "auto",
    });
    hasAutoScrolledRef.current = true;
  }, [entries.length, isExploring, viewState]);

  const countParts = isExploring && model.lines.length === 1
    ? null
    : (
        <ExplorationCountParts
          fileCount={model.uniqueReadFileCount}
          searchCount={model.searchCount}
          listCount={model.listCount}
        />
      );
  const isExpanded = viewState !== "collapsed";
  const maxVisibleHeightPx = viewState === "preview"
    ? EXPLORATION_PREVIEW_MAX_HEIGHT_PX
    : viewState === "expanded"
      ? EXPLORATION_EXPANDED_MAX_HEIGHT_PX
      : 0;
  const measuredHeightPx = isExpanded ? Math.min(elementHeightPx, maxVisibleHeightPx) : 0;

  return (
    <div className="min-w-0 text-size-chat relative overflow-visible py-0">
      <div className="flex flex-col">
        <div className="gap-1 px-0">
          <div className="relative">
            <button
              type="button"
              aria-expanded={isExpanded}
              aria-controls={accordionId}
              className="flex w-full items-center gap-1.5 px-0 py-0 cursor-interaction group text-left"
              onClick={() => {
                setViewState((currentState) => {
                  if (currentState === "expanded") return isExploring ? "preview" : "collapsed";
                  return "expanded";
                });
              }}
            >
              <span className="inline-flex min-w-0 flex-1 items-center gap-1 text-token-foreground/40 group-hover:text-token-foreground">
                <ToolActivityIcon descriptor={resolveExplorationEntriesIcon(entries)} />
                {isExploring ? (
                  <>
                    <CodexShimmerText className="text-token-description-foreground/90 group-hover:text-token-foreground">
                      Exploring
                    </CodexShimmerText>
                    {countParts ? (
                      <>
                        <span className="text-token-description-foreground/90 group-hover:text-token-foreground"> </span>
                        <span className="text-token-foreground/40 group-hover:text-token-foreground">{countParts}</span>
                      </>
                    ) : null}
                  </>
                ) : (
                  <span className="text-token-description-foreground/90 group-hover:text-token-foreground">
                    Explored
                    {countParts ? (
                      <>
                        {" "}
                        <span className="text-token-foreground/40 group-hover:text-token-foreground">{countParts}</span>
                      </>
                    ) : null}
                  </span>
                )}
                <ExplorationChevron expanded={viewState === "expanded"} />
              </span>
            </button>
            <motion.div
              id={accordionId}
              data-testid="exploration-accordion-body"
              initial={false}
              animate={{
                height: measuredHeightPx,
                opacity: isExpanded ? 1 : 0,
              }}
              transition={CODEX_THREAD_ACCORDION_TRANSITION}
              className={cn(isExpanded ? "overflow-visible" : "overflow-hidden")}
              style={{
                pointerEvents: isExpanded ? "auto" : "none",
              }}
            >
              <div ref={elementRef} className="pt-0 text-token-foreground/60 [&_*]:text-token-foreground/50">
                <div className="-mx-2.5 mt-1">
                  <div
                    ref={scrollRef}
                    className="vertical-scroll-fade-mask [--edge-fade-distance:1.5rem] overflow-y-auto scroll-contain text-size-chat rounded-none border-0 px-2.5 font-sans text-token-description-foreground/80 [&_*]:text-token-description-foreground/80"
                    style={{
                      maxHeight: `${maxVisibleHeightPx}px`,
                    }}
                  >
                    <div className={cn("flex flex-col gap-1", viewState === "preview" && "pb-1")}>
                      {model.lines.map((line) => (
                        <div key={line.key}>
                          <div className="flex min-w-0 items-center gap-1.5 truncate">
                            {line.leadingIcon ? <ToolActivityIcon descriptor={line.leadingIcon} className="icon-2xs" /> : null}
                            <span className="min-w-0 truncate">{line.label}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThreadExplorationBodyOnly({ entries }: { entries: CodexConversationItem[] }) {
  const model = useMemo(() => buildExplorationAccordionModel(entries), [entries]);

  if (model.lines.length === 0) return null;

  return (
    <div className="pt-0 text-token-foreground/60 [&_*]:text-token-foreground/50">
      <div className="-mx-2.5 mt-1">
        <div className="text-size-chat rounded-none border-0 px-2.5 font-sans text-token-description-foreground/80 [&_*]:text-token-description-foreground/80">
          <div className="flex flex-col gap-1">
            {model.lines.map((line) => (
              <div key={line.key} className="truncate">
                <div className="flex min-w-0 items-center gap-1.5 truncate">
                  {line.leadingIcon ? <ToolActivityIcon descriptor={line.leadingIcon} className="icon-2xs" /> : null}
                  <span className="min-w-0 truncate">{line.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function humanizeBlockType(type: ThreadBlockModel["type"]): string {
  switch (type) {
    case "streamError":
      return "Stream error";
    case "systemError":
      return "System error";
    case "remoteTaskCreated":
      return "Remote task created";
    case "personalityChanged":
      return "Personality changed";
    case "forkedFromConversation":
      return "Forked conversation";
    case "modelChanged":
      return "Model changed";
    case "modelRerouted":
      return "Model rerouted";
    case "contextCompaction":
      return "Context automatically compacted";
    case "automaticApprovalReview":
      return "Approval review";
    case "autoReviewInterruptionWarning":
      return "Auto-review interrupted";
    case "hook":
      return "Hook";
    case "planImplementation":
      return "Plan implementation";
    case "mcpServerElicitation":
      return "MCP elicitation";
    case "mcpToolCall":
      return "MCP tool call";
    case "multiAgentAction":
      return "Multi-agent action";
    case "webSearch":
      return "Web search";
    case "webSearchGroup":
      return "Web search";
    case "userInputResponse":
      return "User input response";
    default:
      return "System event";
  }
}

const EDIT_MESSAGE_MIN_ROWS = 2;
const EDIT_MESSAGE_MAX_ROWS = 6;

function resizeEditMessageTextarea(element: HTMLTextAreaElement): void {
  const lineHeightPx = Number.parseFloat(window.getComputedStyle(element).lineHeight);
  if (!Number.isFinite(lineHeightPx)) return;

  const minHeightPx = lineHeightPx * EDIT_MESSAGE_MIN_ROWS;
  const maxHeightPx = lineHeightPx * EDIT_MESSAGE_MAX_ROWS;
  element.style.height = "auto";
  element.style.height = `${Math.min(Math.max(element.scrollHeight, minHeightPx), maxHeightPx)}px`;
  element.style.overflowY = element.scrollHeight > maxHeightPx ? "auto" : "hidden";
}

export function ThreadExplorationGroupBlock({
  block,
}: ThreadSpecialBlockProps) {
  const { settings } = useCodexThreadSettings();
  if (block.type !== "explorationGroup") return null;
  if (resolveCodexThreadDetailLevel(settings.detailLevel) === "STEPS_PROSE") return null;
  return <ThreadExplorationAccordion entries={block.entries} status={block.status} />;
}

export function ThreadMultiAgentGroupBlock({
  block,
  onOpenThread,
}: ThreadSpecialBlockProps) {
  if (block.type !== "multiAgentGroup") return null;

  return <MultiAgentActionSurface items={block.entries} onOpenThread={onOpenThread} />;
}

export function ThreadWebSearchGroupBlock({
  block,
  isLatestTurn,
  isStreamingTurn,
}: ThreadSpecialBlockProps & { nestedInCollapsedActivity?: boolean }) {
  if (block.type !== "webSearchGroup") return null;

  return (
    <WebSearchToolCallGroup
      items={block.entries.map((entry) => entry.entry)}
      isActive={isLatestTurn && isStreamingTurn && block.entries.some((entry) => entry.status === "inProgress")}
    />
  );
}

function getMcpCallServer(entry: ThreadTranscriptBlockModel & { type: "mcpToolCall" }): string {
  return entry.entry.mcpToolCall?.invocation.server ?? entry.entry.toolCall?.server ?? "";
}

function getPendingMcpSourceList(block: Extract<ThreadBlockModel, { type: "pendingMcpToolCalls" }>): string {
  const prefix = "Using ";
  if (block.summary.startsWith(prefix)) return block.summary.slice(prefix.length);
  return block.entries.length === 1 ? "tool" : `${block.entries.length} tools`;
}

function isPendingMcpNodeReplGroup(block: Extract<ThreadBlockModel, { type: "pendingMcpToolCalls" }>): boolean {
  return block.entries.length > 0
    && block.entries.every((entry) => getMcpCallServer(entry) === "node_repl" && !entry.entry.mcpToolCall?.pluginId && !entry.entry.mcpToolCall?.mcpAppResourceUri);
}

function isPendingMcpIntegrationGroup(block: Extract<ThreadBlockModel, { type: "pendingMcpToolCalls" }>): boolean {
  return block.entries.length > 0
    && block.entries.every((entry) => Boolean(entry.entry.mcpToolCall?.pluginId || entry.entry.mcpToolCall?.mcpAppResourceUri));
}

function getPendingMcpCompletedSummary(block: Extract<ThreadBlockModel, { type: "pendingMcpToolCalls" }>): string {
  if (isPendingMcpNodeReplGroup(block)) {
    return block.entries.length === 1 ? "Ran a command" : `Ran ${block.entries.length} commands`;
  }

  const sourceList = getPendingMcpSourceList(block);
  if (isPendingMcpIntegrationGroup(block)) {
    return block.entries.length === 1 ? `Used ${sourceList} integration` : `Used ${sourceList} integrations`;
  }

  return `Used ${sourceList}`;
}

function getPendingMcpActiveEntry(block: Extract<ThreadBlockModel, { type: "pendingMcpToolCalls" }>): (ThreadTranscriptBlockModel & { type: "mcpToolCall" }) | null {
  for (let index = block.entries.length - 1; index >= 0; index -= 1) {
    const entry = block.entries[index];
    if (!entry) continue;
    if (entry.entry.mcpToolCall?.completed === false || entry.status === "inProgress") return entry;
  }
  return block.entries.at(-1) ?? null;
}

export function ThreadPendingMcpToolCallsBlock({
  block,
  isLatestTurn,
  isStreamingTurn,
  projectWorkspacePath,
  threadCwd,
  onOpenTurnDiffReview,
  onOpenTurnDiffFileInSidePanel,
  onOpenThread,
  onOpenMcpAppSidePanel,
  turnDiffHoverPreviewDisabled,
}: ThreadSpecialBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (block.type !== "pendingMcpToolCalls") return null;
  const activeEntry = isLatestTurn && isStreamingTurn && block.status === "inProgress"
    ? getPendingMcpActiveEntry(block)
    : null;
  const iconEntry = activeEntry?.entry ?? block.entries.at(-1)?.entry ?? block.entries[0]?.entry;
  const icon = iconEntry ? resolveMcpSourceIcon(iconEntry) : semanticToolIcon("connector");
  const activePayload = activeEntry?.entry.mcpToolCall ?? null;
  const summary = activePayload ? (
    <CodexShimmerText active className="min-w-0 truncate select-none text-token-conversation-summary-leading group-hover/activity-header:text-token-foreground">
      {resolveMcpToolDisplayName(activePayload)}
    </CodexShimmerText>
  ) : (
    <span className="text-token-conversation-summary-leading group-hover/activity-header:text-token-foreground">
      {getPendingMcpCompletedSummary(block)}
    </span>
  );

  const bodyItems = block.entries.map((entry) => ({
    key: entry.entry.mcpToolCall?.callId ?? entry.id,
    node: (
      <ThreadToolSurfaceBlock
        block={entry}
        isLatestTurn={isLatestTurn}
        isStreamingTurn={isStreamingTurn}
        projectWorkspacePath={projectWorkspacePath}
        threadCwd={threadCwd}
        onOpenTurnDiffReview={onOpenTurnDiffReview}
        onOpenTurnDiffFileInSidePanel={onOpenTurnDiffFileInSidePanel}
        onOpenThread={onOpenThread}
        onOpenMcpAppSidePanel={onOpenMcpAppSidePanel}
        turnDiffHoverPreviewDisabled={turnDiffHoverPreviewDisabled}
        nestedInCollapsedActivity
      />
    ),
  }));

  return (
    <ThreadActivityShell
      body={(
        <div
          className="pt-0 text-token-conversation-body [&_*]:text-token-non-assistant-body-descendant"
          data-testid="pending-mcp-tool-calls-body"
          data-thread-find-skip={isExpanded ? undefined : true}
        >
          <div className="-mx-2.5">
            <ThreadActivityList
              autoScrollToBottom={false}
              className="text-size-chat rounded-none border-0 px-2.5 font-sans text-token-description-foreground/80 [&_*]:text-token-description-foreground/80"
              contentClassName="pt-1"
              items={bodyItems}
              maxHeightByState={THREAD_ACTIVITY_LIST_7_TO_20_REM_MAX_HEIGHT_BY_STATE}
              viewState={isExpanded ? "expanded" : "collapsed"}
            />
          </div>
        </div>
      )}
      className="pt-0 text-token-conversation-body"
      header={(
        <ThreadActivityHeader
          disclosure={{
            expanded: isExpanded,
            onToggle: () => {
              setIsExpanded((value) => !value);
            },
          }}
        >
          <ToolActivityIcon descriptor={icon} />
          <span className="text-token-conversation-summary-trailing group-hover/activity-header:text-token-foreground min-w-0 shrink truncate">
            {summary}
          </span>
        </ThreadActivityHeader>
      )}
    />
  );
}

type DynamicToolCallGroupEntry = Extract<ThreadBlockModel, { type: "dynamicToolCallGroup" }>["entries"][number];

interface DynamicToolCallGroupSummaryPart {
  key: string;
  item: NonNullable<DynamicToolCallGroupEntry["entry"]["dynamicToolCall"]>;
  count: number;
}

function buildDynamicToolCallGroupSummaryViewParts(
  entries: DynamicToolCallGroupEntry[],
): DynamicToolCallGroupSummaryPart[] {
  const parts: DynamicToolCallGroupSummaryPart[] = [];
  for (const entry of entries) {
    const call = entry.entry.dynamicToolCall;
    if (!call) continue;

    const key = buildDynamicToolCallSummaryPartKey(call);
    const existing = parts.find((part) => part.key === key);
    if (existing) {
      existing.count += 1;
      continue;
    }

    parts.push({ key, item: call, count: 1 });
  }
  return parts;
}

function getDynamicToolCallGroupActiveEntry(
  entries: DynamicToolCallGroupEntry[],
): DynamicToolCallGroupEntry | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.entry.dynamicToolCall && !entry.entry.dynamicToolCall.completed) return entry;
  }
  return null;
}

function isDynamicToolCallGroupActive(
  entries: DynamicToolCallGroupEntry[],
  isActiveTurn: boolean,
): boolean {
  if (!isActiveTurn) return false;
  if (entries.some((entry) => entry.entry.dynamicToolCall && !entry.entry.dynamicToolCall.completed)) return true;
  const lastCall = entries.at(-1)?.entry.dynamicToolCall;
  return continuesCodexAppLiveActivityBetweenCalls(lastCall);
}

function DynamicToolCallGroupSummary({
  entries,
}: {
  entries: DynamicToolCallGroupEntry[];
}) {
  const parts = buildDynamicToolCallGroupSummaryViewParts(entries);
  const firstPart = parts[0];
  if (!firstPart) return null;

  if (parts.length === 1) {
    return (
      <DynamicToolCallGroupSummaryPartLabel
        item={firstPart.item}
        count={firstPart.count}
        variant="summary"
      />
    );
  }

  const allCodexApp = entries.every((entry) => entry.entry.dynamicToolCall?.namespace === "codex_app");
  const icon = allCodexApp ? semanticToolIcon("plugin") : semanticToolIcon("connector");

  return (
    <span className="text-size-chat inline-flex min-w-0 items-center gap-2">
      <ToolActivityIcon descriptor={icon} className="icon-xs shrink-0 text-token-text-secondary" />
      <span className="truncate text-token-conversation-summary-trailing group-hover/activity-header:text-token-foreground">
        {parts.map((part, index) => (
          <span key={part.key}>
            {index > 0 ? " · " : null}
            <DynamicToolCallGroupSummaryPartLabel
              item={part.item}
              count={part.count}
              variant="summary-text"
            />
          </span>
        ))}
      </span>
    </span>
  );
}

function DynamicToolCallGroupSummaryPartLabel({
  item,
  count,
  variant,
}: {
  item: NonNullable<DynamicToolCallGroupEntry["entry"]["dynamicToolCall"]>;
  count: number;
  variant: "summary" | "summary-text";
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <DynamicToolCallSummary call={item} variant={variant} />
      {count > 1 ? (
        <span className="shrink-0 text-token-conversation-summary-trailing group-hover/activity-header:text-token-foreground">
          {` ${count} times`}
        </span>
      ) : null}
    </span>
  );
}

export function ThreadDynamicToolCallGroupBlock({
  block,
  isLatestTurn,
  isStreamingTurn,
  projectWorkspacePath,
  threadCwd,
  onOpenTurnDiffReview,
  onOpenTurnDiffFileInSidePanel,
  onOpenThread,
  onOpenMcpAppSidePanel,
  turnDiffHoverPreviewDisabled,
}: ThreadSpecialBlockProps) {
  if (block.type !== "dynamicToolCallGroup") return null;
  const canExpand = block.canExpand ?? true;
  const isActiveGroup = isDynamicToolCallGroupActive(block.entries, isLatestTurn && isStreamingTurn);
  const activeEntry = isActiveGroup ? getDynamicToolCallGroupActiveEntry(block.entries) : null;
  const activeCall = activeEntry?.entry.dynamicToolCall ?? null;
  const lastCall = block.entries.at(-1)?.entry.dynamicToolCall ?? null;
  const summaryKey = activeCall
    ? `active:${activeCall.callId}`
    : `completed:${lastCall?.callId ?? block.id}:${block.entries.length}`;
  const summaryTransition: ThreadActivitySummaryTransition = isLatestTurn && isStreamingTurn
    ? activeCall ? "deferred" : "immediate"
    : "static";
  const summary = activeCall
    ? (
      <DynamicToolCallSummary
        call={{
          ...activeCall,
          completed: false,
        }}
        variant="summary"
      />
    )
    : <DynamicToolCallGroupSummary entries={block.entries} />;
  const bodyItems = block.entries.map((entry) => ({
    key: entry.entry.dynamicToolCall?.callId ?? entry.id,
    node: (
      <ThreadToolSurfaceBlock
        block={entry}
        isLatestTurn={isLatestTurn}
        isStreamingTurn={isStreamingTurn}
        projectWorkspacePath={projectWorkspacePath}
        threadCwd={threadCwd}
        onOpenTurnDiffReview={onOpenTurnDiffReview}
        onOpenTurnDiffFileInSidePanel={onOpenTurnDiffFileInSidePanel}
        onOpenThread={onOpenThread}
        onOpenMcpAppSidePanel={onOpenMcpAppSidePanel}
        turnDiffHoverPreviewDisabled={turnDiffHoverPreviewDisabled}
        nestedInCollapsedActivity
      />
    ),
  }));

  return (
    <ThreadActivityDisclosure
      canExpand={canExpand}
      className="pt-0 text-token-conversation-body"
      shouldAnimateInitialCollapse={isLatestTurn && isStreamingTurn && canExpand}
      summary={summary}
      summaryClassName={canExpand
        ? "shrink overflow-hidden [mask-image:linear-gradient(to_right,black_calc(100%_-_0.25rem),transparent)] [mask-repeat:no-repeat] pr-1 group-hover/activity-header:text-token-foreground"
        : undefined}
      summaryKey={summaryKey}
      summaryTransition={summaryTransition}
    >
      <div
        className="-mx-2.5 mt-1 text-token-conversation-body [&_*]:text-token-non-assistant-body-descendant"
        data-testid="dynamic-tool-call-group-body"
      >
        <ThreadActivityList
          autoScrollToBottom={false}
          className="text-size-chat rounded-none border-0 px-2.5 font-sans text-token-description-foreground/80 [&_*]:text-token-description-foreground/80"
          items={bodyItems}
          maxHeightByState={THREAD_ACTIVITY_LIST_20_REM_MAX_HEIGHT_BY_STATE}
          viewState="expanded"
        />
      </div>
    </ThreadActivityDisclosure>
  );
}

function renderCollapsedActivityEntry({
  entry,
  isLatestTurn,
  isStreamingTurn,
  projectWorkspacePath,
  threadCwd,
  onOpenTurnDiffReview,
  onOpenTurnDiffFileInSidePanel,
  onOpenThread,
  onOpenMcpAppSidePanel,
  turnDiffHoverPreviewDisabled,
}: {
  entry: Extract<ThreadBlockModel, { type: "collapsedToolActivity" }>["entries"][number];
  isLatestTurn: boolean;
  isStreamingTurn: boolean;
  projectWorkspacePath?: string | null;
  threadCwd?: string | null;
  onOpenTurnDiffReview?: (target: CodexTurnDiffReviewTarget) => void;
  onOpenTurnDiffFileInSidePanel?: ThreadStageActions["onOpenTurnDiffFileInSidePanel"];
  onOpenThread?: ThreadStageActions["onOpenThread"];
  onOpenMcpAppSidePanel?: ThreadStageActions["onOpenMcpAppSidePanel"];
  turnDiffHoverPreviewDisabled?: boolean;
}) {
  const sharedProps = {
    isLatestTurn,
    isStreamingTurn,
    projectWorkspacePath,
    threadCwd,
    onOpenTurnDiffReview,
    onOpenTurnDiffFileInSidePanel,
    onOpenThread,
    onOpenMcpAppSidePanel,
    turnDiffHoverPreviewDisabled,
  };

  if (entry.type === "explorationGroup") return <ThreadExplorationBodyOnly entries={entry.entries} />;
  if (entry.type === "webSearchGroup") {
    return <WebSearchToolCallGroup items={entry.entries.map((item) => item.entry)} hideHeader />;
  }
  if (entry.type === "automaticApprovalReview") return <ThreadAutomaticApprovalReviewBlock block={entry as ThreadTranscriptBlockModel} {...sharedProps} />;
  if (entry.type === "streamError") return <ThreadStreamErrorBlock block={entry as ThreadTranscriptBlockModel} {...sharedProps} />;
  if (entry.type === "systemError") return <ThreadSystemErrorBlock block={entry as ThreadTranscriptBlockModel} {...sharedProps} />;
  if (entry.type === "contextCompaction") return <ThreadContextCompactionBlock block={entry as ThreadTranscriptBlockModel} {...sharedProps} />;
  if (entry.type === "exec" || entry.type === "fileChange" || entry.type === "mcpToolCall" || entry.type === "webSearch") {
    return <ThreadToolSurfaceBlock block={entry as ThreadTranscriptBlockModel} {...sharedProps} nestedInCollapsedActivity />;
  }
  if (entry.type === "hook") {
    return <ThreadHookBlock block={entry as ThreadTranscriptBlockModel} {...sharedProps} nestedInCollapsedActivity />;
  }

  return null;
}

function isEverydayWorkMode(threadDetailLevel: ReturnType<typeof resolveCodexThreadDetailLevel>): boolean {
  return threadDetailLevel === "STEPS_PROSE";
}

function shouldShimmerCollapsedActivitySummary(
  stats: Extract<ThreadBlockModel, { type: "collapsedToolActivity" }>["summaryStats"],
): boolean {
  if (!stats) return false;
  return stats.runningCreatedFileCount > 0
    || stats.runningEditedFileCount > 0
    || stats.runningDeletedFileCount > 0
    || stats.runningExploredFileCount > 0
    || stats.runningLoadedToolCount > 0
    || stats.runningSearchCount > 0
    || stats.runningListCount > 0
    || stats.runningHookCount > 0
    || stats.runningCommandCount > 0
    || stats.runningFolderCreationCommandCount > 0
    || stats.runningWebSearchCommandCount > 0
    || stats.runningMcpToolCallCount > 0
    || stats.runningWebSearchCount > 0;
}

function CollapsedActivitySummaryText({
  summary,
  shimmer,
}: {
  summary: string;
  shimmer: boolean;
}) {
  if (!shimmer) return summary;

  const writingMatch = summary.match(/ • writing (?:a line|\d+ lines?)/i);
  if (!writingMatch || writingMatch.index === undefined) {
    return <CodexShimmerText>{summary}</CodexShimmerText>;
  }

  const start = writingMatch.index;
  const writingText = writingMatch[0];
  const before = summary.slice(0, start);
  const after = summary.slice(start + writingText.length);
  return (
    <>
      {before.length > 0 ? <CodexShimmerText>{before}</CodexShimmerText> : null}
      <span>{writingText}</span>
      {after.length > 0 ? <CodexShimmerText>{after}</CodexShimmerText> : null}
    </>
  );
}

function CollapsedActivityActiveSummaryText({
  summary,
}: {
  summary: ThreadCollapsedToolActivityActiveSummary;
}) {
  if (summary.kind === "fileChange") {
    return (
      <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
        <CodexShimmerText
          className="shrink-0 whitespace-nowrap"
        >
          {summary.label}
        </CodexShimmerText>
        <span
          className="max-w-full truncate text-token-text-link-foreground select-text"
          style={{ WebkitTextFillColor: "currentColor" }}
        >
          {summary.displayPath}
        </span>
        <AnimatedDiffStats additions={summary.additions} deletions={summary.deletions} />
      </span>
    );
  }

  return <CodexShimmerText>{summary.label}</CodexShimmerText>;
}

function buildCollapsedActivityAggregateSummaryKey(
  stats: Extract<ThreadBlockModel, { type: "collapsedToolActivity" }>["summaryStats"],
  fallbackSummary: string,
): string {
  if (!stats) return `summary:${fallbackSummary}`;

  return [
    "completed",
    stats.createdFileCount,
    stats.stoppedCreatedFileCount,
    stats.changedLineCount,
    stats.editedFileCount,
    stats.deletedFileCount,
    stats.exploredFileCount,
    stats.loadedToolCount,
    stats.searchCount,
    stats.listCount,
    stats.deniedRequestCount,
    stats.timedOutRequestCount,
    stats.commandCount,
    stats.completedWebSearchCommandCount,
    stats.mcpToolCallCount,
    stats.webSearchCount,
    stats.mcpToolCallSources.map((source) => `${source.key}:${source.count}`).join(","),
  ].join(":");
}

export function ThreadCollapsedToolActivityBlock({
  block,
  isLatestTurn,
  isStreamingTurn,
  projectWorkspacePath,
  threadCwd,
  onOpenTurnDiffReview,
  onOpenTurnDiffFileInSidePanel,
  onOpenThread,
  onOpenMcpAppSidePanel,
  turnDiffHoverPreviewDisabled,
}: ThreadSpecialBlockProps) {
  const { settings } = useCodexThreadSettings();

  if (block.type !== "collapsedToolActivity") return null;
  const threadDetailLevel = resolveCodexThreadDetailLevel(settings.detailLevel);
  const showFileChangeLineCount = isEverydayWorkMode(threadDetailLevel);
  const showRunningCommandSummary = isEverydayWorkMode(threadDetailLevel);
  const icon = resolveCollapsedToolActivityIcon(block.entries);
  const runningSummary = isLatestTurn
    && isStreamingTurn
    && shouldDisplayCollapsedToolActivityActiveSummary(block.runningSummary, threadDetailLevel)
    ? block.runningSummary
    : null;
  const aggregateSummary = block.summaryStats
    ? buildCollapsedToolActivitySummary(block.summaryStats, {
      showFileChangeLineCount,
      showRunningCommandSummary,
    })?.summary ?? block.summary
    : block.summary;
  const shouldShimmerAggregate = !runningSummary
    && isLatestTurn
    && isStreamingTurn
    && shouldShimmerCollapsedActivitySummary(block.summaryStats);
  const shouldAnimateSummaryChanges = isLatestTurn && isStreamingTurn;
  const summaryKey = runningSummary?.key ?? buildCollapsedActivityAggregateSummaryKey(block.summaryStats, aggregateSummary);
  const summaryTransition: ThreadActivitySummaryTransition = runningSummary
    ? shouldAnimateSummaryChanges ? "deferred" : "static"
    : shouldAnimateSummaryChanges ? shouldShimmerAggregate ? "deferred" : "immediate" : "static";
  const canExpand = block.entries.length > 0 || (isLatestTurn && isStreamingTurn);
  const summary = (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden">
      {icon ? <ToolActivityIcon descriptor={icon} /> : null}
      <span className="min-w-0 flex-1 truncate">
        {runningSummary ? (
          <CollapsedActivityActiveSummaryText summary={runningSummary} />
        ) : (
          <CollapsedActivitySummaryText summary={aggregateSummary} shimmer={shouldShimmerAggregate} />
        )}
      </span>
    </span>
  );
  const body = (
    <div
      className="flex flex-col"
      style={{ "--conversation-patch-file-gap": "4px" } as CSSProperties}
    >
      {block.entries.map((entry) => (
        <div key={entry.id}>
          <div style={{ height: "var(--conversation-patch-file-gap)" }} />
          {renderCollapsedActivityEntry({
            entry,
            isLatestTurn,
            isStreamingTurn,
            projectWorkspacePath,
            threadCwd,
            onOpenTurnDiffReview,
            onOpenTurnDiffFileInSidePanel,
            onOpenThread,
            onOpenMcpAppSidePanel,
            turnDiffHoverPreviewDisabled,
          })}
        </div>
      ))}
    </div>
  );

  return (
    <ThreadActivityDisclosure
      bodyTestId="collapsed-tool-activity-body"
      canExpand={canExpand}
      shouldAnimateInitialCollapse={isLatestTurn && isStreamingTurn && summaryKey !== "thinking"}
      summary={summary}
      summaryKey={summaryKey}
      summaryTransition={summaryTransition}
    >
      {body}
    </ThreadActivityDisclosure>
  );
}

export function ThreadThinkingPlaceholderBlock({ block }: ThreadSpecialBlockProps) {
  if (block.type !== "thinkingPlaceholder") return null;

  return (
    <div className="min-w-0 py-0">
      <div className="flex items-center gap-1.5">
        <CodexShimmerText className="text-size-chat truncate text-token-foreground/30">
          Thinking
        </CodexShimmerText>
      </div>
    </div>
  );
}

export function ThreadToolSurfaceBlock({
  block,
  isStreamingTurn,
  projectWorkspacePath,
  threadCwd,
  onOpenThread,
  onOpenMcpAppSidePanel,
  nestedInCollapsedActivity = false,
}: ThreadLeafBlockProps) {
  const { settings } = useCodexThreadSettings();
  const item = block.entry;
  const threadDetailLevel = resolveCodexThreadDetailLevel(settings.detailLevel);
  if (item.semanticKind === "mcpToolCall" && threadDetailLevel === "STEPS_PROSE") {
    return null;
  }

  const ToolComponent = getToolComponent(item);
  if (!ToolComponent) return null;

  return (
    <ToolComponent
      item={item}
      projectWorkspacePath={projectWorkspacePath ?? undefined}
      threadCwd={threadCwd ?? undefined}
      isTurnCancelled={block.isTurnCancelled === true}
      isStreamingTurn={isStreamingTurn}
      automaticApprovalReviews={block.automaticApprovalReviews ?? []}
      execSummaryTone={nestedInCollapsedActivity ? "muted" : "default"}
      hideHeader={nestedInCollapsedActivity && block.type === "webSearch"}
      showExecSummaryIcon={!nestedInCollapsedActivity}
      onOpenThread={onOpenThread}
      onOpenMcpAppSidePanel={onOpenMcpAppSidePanel}
    />
  );
}

export function ThreadTurnDiffBlock({
  block,
  isLatestTurn,
  isStreamingTurn,
  projectWorkspacePath,
  threadCwd,
  onOpenTurnDiffReview,
  onOpenTurnDiffFileInSidePanel,
  allowInProgressTurnDiff = false,
  turnDiffHoverPreviewDisabled = false,
}: ThreadLeafBlockProps) {
  const { settings } = useCodexThreadSettings();
  const threadDetailLevel = resolveCodexThreadDetailLevel(settings.detailLevel);
  if (isStreamingTurn && !allowInProgressTurnDiff) return null;
  if (isStreamingTurn && threadDetailLevel === "STEPS_PROSE") return null;

  return (
    <TurnDiffSurface
      item={block.entry}
      isInProgress={isStreamingTurn}
      projectWorkspacePath={projectWorkspacePath ?? undefined}
      threadCwd={threadCwd ?? undefined}
      reviewSource={isLatestTurn ? "last-turn" : "selected-turn"}
      onOpenReview={onOpenTurnDiffReview}
      onOpenFileInSidePanel={onOpenTurnDiffFileInSidePanel}
      disableHoverPreview={turnDiffHoverPreviewDisabled}
    />
  );
}

export function ThreadAutomaticApprovalReviewBlock({ block }: ThreadLeafBlockProps) {
  if (block.type !== "automaticApprovalReview") return null;
  return <AutomaticApprovalReviewSurface item={block.entry} />;
}

export function ThreadMultiAgentActionBlock({ block, onOpenThread }: ThreadLeafBlockProps) {
  if (block.type !== "multiAgentAction") return null;
  return <MultiAgentActionSurface items={[block.entry]} onOpenThread={onOpenThread} />;
}

const SUBAGENT_ACTIVITY_VISIBLE_CHIP_COUNT = 3;

function resolveSubagentActivityStatusLabel(rows: readonly ThreadSubagentActivityInlineRowModel[]): string {
  if (rows.some((row) => row.activityStatus === "interrupted")) return "interrupted";
  if (rows.some((row) => row.activityStatus === "updated")) return "updated";
  if (rows.length > 0 && rows.every((row) => row.activityStatus === "done" || row.status === "done")) return "finished";
  return "started working";
}

function SubagentActivityChipAvatar({ displayName }: { displayName: string }) {
  const initial = displayName.trim().charAt(0).toUpperCase() || "A";
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-token-foreground/8 text-[0.625rem] leading-none text-token-description-foreground"
    >
      {initial}
    </span>
  );
}

function SubagentActivityInlineChip({
  animateEntrance,
  onAnimationEnd,
  onClick,
  row,
}: {
  animateEntrance: boolean;
  onAnimationEnd: () => void;
  onClick?: () => void;
  row: ThreadSubagentActivityInlineRowModel;
}) {
  const content = (
    <>
      <SubagentActivityChipAvatar displayName={row.displayName} />
      <span className="min-w-0 truncate text-base">{row.displayName}</span>
    </>
  );
  const className = cn(
    "subagent-activity-chip inline-flex h-7 max-w-48 min-w-0 items-center gap-1.5 rounded-full border border-token-border-light bg-token-main-surface-secondary pr-2 pl-1.5 text-token-conversation-summary-leading",
    onClick && "cursor-interaction hover:border-token-border-default hover:bg-token-list-hover-background hover:text-token-foreground focus-visible:outline-2 focus-visible:outline-offset-2 active:bg-token-bg-secondary",
  );

  if (!onClick) {
    return (
      <span
        className={className}
        data-animate-entrance={animateEntrance ? "" : undefined}
        onAnimationEnd={animateEntrance ? onAnimationEnd : undefined}
      >
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-label={`Open ${row.displayName} subagent`}
      className={className}
      data-animate-entrance={animateEntrance ? "" : undefined}
      onAnimationEnd={animateEntrance ? onAnimationEnd : undefined}
      onClick={onClick}
    >
      {content}
    </button>
  );
}

export function ThreadSubagentActivityInlineGroupBlock({ block, onOpenThread }: ThreadLeafBlockProps) {
  const rows = block.type === "subagentActivityInlineGroup" ? block.subagentActivityRows ?? [] : [];
  const [animatedConversationIds, setAnimatedConversationIds] = useState<ReadonlySet<string>>(
    () => new Set(rows.map((row) => row.conversationId)),
  );
  const clearAnimation = useCallback((conversationId: string) => {
    setAnimatedConversationIds((current) => {
      if (!current.has(conversationId)) return current;
      const next = new Set(current);
      next.delete(conversationId);
      return next;
    });
  }, []);

  if (block.type !== "subagentActivityInlineGroup" || rows.length === 0) return null;

  const visibleRows = rows.slice(0, SUBAGENT_ACTIVITY_VISIBLE_CHIP_COUNT);
  const hiddenCount = rows.length - visibleRows.length;
  const statusLabel = block.subagentActivityStatusLabel ?? resolveSubagentActivityStatusLabel(rows);

  return (
    <div className="-ml-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-sm leading-5" data-testid="subagent-activity-inline-group">
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        {visibleRows.map((row) => (
          <SubagentActivityInlineChip
            key={row.conversationId}
            row={row}
            animateEntrance={animatedConversationIds.has(row.conversationId)}
            onAnimationEnd={() => clearAnimation(row.conversationId)}
            onClick={onOpenThread
              ? () => {
                  void onOpenThread(row.conversationId, {
                    subagent: {
                      agentRole: row.agentRole,
                      conversationId: row.conversationId,
                      diffStats: row.diffStats,
                      displayName: row.displayName,
                      showInlineActivity: true,
                      spawnModel: row.spawnModel,
                      status: row.status,
                      statusSummary: row.statusSummary,
                    },
                  });
                }
              : undefined}
          />
        ))}
      </span>
      <span className="text-base text-token-conversation-summary-leading">
        {hiddenCount > 0 ? `and ${hiddenCount} other ${hiddenCount === 1 ? "subagent" : "subagents"} ` : null}
        {statusLabel}
      </span>
    </div>
  );
}

export function ThreadUserAttachmentStripBlock({ block }: ThreadSpecialBlockProps) {
  if (block.type !== "userAttachmentStrip") return null;
  return <UserAttachmentStrip attachments={block.attachments} />;
}

export function UserMessageBubble({
  block,
  isSearchMatch = false,
  isActiveSearchMatch = false,
  onEditLastUserTurn,
}: ThreadLeafBlockProps) {
  const content = block.entry.markdownText ?? "";
  const userActions = block.userMessageActions;
  const canEdit = userActions?.canEdit ?? false;
  const steeringStatusLabel = resolveSteeringStatusLabel(block.entry.steeringStatus);
  const isGoalMessage = block.entry.goal === true;
  const hasMessageContent = content.trim().length > 0;
  const shouldRenderFooter = hasMessageContent || isGoalMessage;
  const [isEditing, setIsEditing] = useState(false);
  const [draftMessage, setDraftMessage] = useState(content);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  const openInlineEditor = useCallback(() => {
    setDraftMessage(content);
    setIsEditing(true);
  }, [content]);

  const cancelInlineEditor = useCallback(() => {
    setDraftMessage(content);
    setIsEditing(false);
  }, [content]);

  const handleEditSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onEditLastUserTurn || isSubmittingEdit) return;

    setIsSubmittingEdit(true);
    try {
      await onEditLastUserTurn({
        threadId: block.entry.threadId,
        turnId: block.turnId,
        message: draftMessage.trim(),
      });
      setIsEditing(false);
    } finally {
      setIsSubmittingEdit(false);
    }
  }, [block.entry.threadId, block.turnId, draftMessage, isSubmittingEdit, onEditLastUserTurn]);

  const handleDraftMessageInput = useCallback((element: HTMLTextAreaElement) => {
    resizeEditMessageTextarea(element);
    setDraftMessage(element.value);
  }, []);

  return (
    <div
      className={cn(
        "flex flex-col items-end gap-2",
        isSearchMatch && THREAD_VISUAL_TOKENS.searchUnitMatched,
        isActiveSearchMatch && THREAD_VISUAL_TOKENS.searchUnitActive,
      )}
      data-content-search-unit-key={block.searchUnitKey}
    >
      <div className="group flex w-full flex-col items-end justify-end gap-1">
        {steeringStatusLabel ? (
          <div className="ms-1 mr-1 flex items-center gap-2">
            <SteeringStatusIcon />
            <span className="text-token-description-foreground text-xs">{steeringStatusLabel}</span>
          </div>
        ) : null}
        {isEditing ? (
          <form
            className="flex w-full flex-col gap-4 rounded-2xl bg-token-foreground/5 px-3 py-2.5"
            onSubmit={(event) => {
              void handleEditSubmit(event).catch(() => {});
            }}
          >
            <textarea
              aria-label="Edit message"
              autoFocus
              className="w-full resize-none bg-transparent p-0 text-sm leading-relaxed text-token-foreground outline-none placeholder:text-token-description-foreground"
              rows={EDIT_MESSAGE_MIN_ROWS}
              value={draftMessage}
              onChange={(event) => {
                handleDraftMessageInput(event.currentTarget);
              }}
              onInput={(event) => {
                handleDraftMessageInput(event.currentTarget as HTMLTextAreaElement);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !event.metaKey) return;
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }}
              ref={(element) => {
                if (!element) return;
                resizeEditMessageTextarea(element);
              }}
            />
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                disabled={isSubmittingEdit}
                className="border-token-border user-select-none no-drag cursor-interaction flex items-center gap-1 border focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-lg border-token-border text-token-button-tertiary-foreground bg-token-bg-fog enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background border h-token-button-composer px-2 py-0 text-base leading-[18px]"
                onClick={cancelInlineEditor}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmittingEdit}
                className="border-token-border user-select-none no-drag cursor-interaction flex items-center gap-1 border focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-lg bg-token-foreground enabled:hover:bg-token-foreground/80 data-[state=open]:bg-token-foreground/80 text-token-dropdown-background h-token-button-composer px-2 py-0 text-base leading-[18px]"
              >
                Send
              </button>
            </div>
          </form>
        ) : (
          <div
            data-user-message-bubble="true"
            data-thread-selected-text-target="true"
            className={THREAD_VISUAL_TOKENS.userBubble}
          >
            <UserMessageText text={content} />
          </div>
        )}
        {shouldRenderFooter ? (
          <div className="flex flex-row-reverse items-center gap-1">
            {isGoalMessage ? <UserMessageGoalStatus /> : null}
            {isEditing || !hasMessageContent ? null : (
              <ThreadMessageActionRow align="end">
                <MessageTimestamp sentAtMs={userActions?.sentAtMs ?? null} />
                <div className="flex items-center gap-1">
                  <CopyMessageActionButton
                    text={content}
                    feedbackMs={USER_COPY_FEEDBACK_MS}
                    disabledWhenCopied
                  />
                  {canEdit ? (
                    <ThreadActionIconButton
                      label="Edit message"
                      tooltip="Edit"
                      onClick={openInlineEditor}
                    >
                      <EditMessageIcon />
                    </ThreadActionIconButton>
                  ) : null}
                </div>
              </ThreadMessageActionRow>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ThreadUserBubbleBlock(props: ThreadLeafBlockProps) {
  return <UserMessageBubble {...props} />;
}

export function ThreadSteeredDividerBlock({
  block,
  isSearchMatch = false,
  isActiveSearchMatch = false,
}: ThreadLeafBlockProps) {
  return (
    <div
      className={cn(
        "relative overflow-visible py-0 min-w-0 text-size-chat",
        isSearchMatch && THREAD_VISUAL_TOKENS.searchUnitMatched,
        isActiveSearchMatch && THREAD_VISUAL_TOKENS.searchUnitActive,
      )}
      data-content-search-unit-key={block.searchUnitKey}
    >
      <span className="block truncate text-token-foreground/40">Steered conversation</span>
    </div>
  );
}

export function ThreadReasoningBlock({
  block,
  isLatestTurn,
  isStreamingTurn,
}: ThreadLeafBlockProps) {
  const item = block.entry;

  return (
    <ReasoningSurface
      item={item}
      parseIncompleteMarkdown={isStreamingTurn && (item.status === "inProgress" || isLatestTurn)}
    />
  );
}

export function ThreadPlanCardBlock({
  block,
  isLatestTurn,
  isStreamingTurn,
  threadCwd,
  onOpenPlanInSidePanel,
  onClosePlanSidePanel,
  planSidePanelState,
}: ThreadLeafBlockProps) {
  const item = block.entry;
  const isInProgress = item.status === "inProgress";
  const shouldParseIncompleteMarkdown = isStreamingTurn && (isInProgress || isLatestTurn);
  const planKey = item.turnId || item.itemId;
  const isSidePanelActive = Boolean(
    block.type === "proposedPlan"
    && !isInProgress
    && planSidePanelState?.rightPanelEnabled
    && planSidePanelState.activePlanKey === planKey
    && planSidePanelState.activeRightPanelTabId === "plan",
  );

  return (
    block.type === "todoList" ? (
      <TodoListSurface item={item} />
    ) : (
      <PlanMessage
        content={item.markdownText ?? ""}
        completed={!isInProgress}
        parseIncompleteMarkdown={shouldParseIncompleteMarkdown}
        isSidePanelActive={isSidePanelActive}
        onOpenInSidePanel={
          !isInProgress && planSidePanelState?.rightPanelEnabled && onOpenPlanInSidePanel
            ? () =>
                onOpenPlanInSidePanel({
                  planKey,
                  threadId: item.threadId,
                  turnId: item.turnId,
                  itemId: item.itemId,
                  content: item.markdownText ?? "",
                  cwd: item.cwd ?? threadCwd ?? null,
                  hideCodeBlocks: false,
                })
            : undefined
        }
        onCloseSidePanel={
          isSidePanelActive && onClosePlanSidePanel
            ? () => onClosePlanSidePanel({ planKey })
            : undefined
        }
      />
    )
  );
}

function humanizeHookEventName(value: string | null | undefined): string {
  switch (value) {
    case "preToolUse":
      return "PreToolUse";
    case "postToolUse":
      return "PostToolUse";
    case "sessionStart":
      return "SessionStart";
    case "userPromptSubmit":
      return "UserPromptSubmit";
    case "stop":
      return "Stop";
    default:
      return "Hook";
  }
}

function resolveHookSummary(entry: CodexConversationItem): {
  summary: string;
  status: string;
  details: Array<{ kind: string; text: string }>;
} {
  const raw = asRecord(entry.rawItem);
  const run = asRecord(raw?.run);
  const eventName = typeof run?.eventName === "string" ? run.eventName : null;
  const statusMessage = typeof run?.statusMessage === "string" ? run.statusMessage.trim() : "";
  const status = typeof run?.status === "string" ? run.status : "running";
  const details = Array.isArray(run?.entries)
    ? run.entries.flatMap((candidate) => {
        const parsed = asRecord(candidate);
        if (!parsed || typeof parsed.kind !== "string" || typeof parsed.text !== "string") return [];
        return [{ kind: parsed.kind, text: parsed.text }];
      })
    : [];

  return {
    summary: statusMessage.length > 0
      ? `${humanizeHookEventName(eventName)} - ${statusMessage}`
      : humanizeHookEventName(eventName),
    status,
    details,
  };
}

export function ThreadHookBlock({ block }: ThreadLeafBlockProps) {
  if (block.type !== "hook") return null;

  const [expanded, setExpanded] = useState(false);
  const hook = resolveHookSummary(block.entry);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className="group flex w-full min-w-0 items-center gap-1.5 text-left text-size-chat text-token-description-foreground transition-colors hover:text-token-foreground"
        aria-expanded={expanded}
        onClick={() => {
          setExpanded((current) => !current);
        }}
      >
        <ChevronRightIcon
          className={cn(
            "icon-xs shrink-0 transition-transform duration-300",
            expanded && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate">{hook.summary}</span>
        <span className="shrink-0 pl-4 text-right">{hook.status}</span>
      </button>
      {expanded ? (
        <div className="ml-5 flex flex-col gap-1">
          {hook.details.map((detail, index) => (
            <p
              key={`${detail.kind}:${index}`}
              className="text-size-chat whitespace-pre-wrap text-token-description-foreground"
              data-hook-entry-kind={detail.kind}
            >
              {detail.kind}: {detail.text}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ThreadWorkedForBlock({ block }: { block: ThreadWorkedForBlockModel }) {
  const label = useWorkedForLabelText({
    timing: {
      status: block.status,
      startedAtMs: block.startedAtMs,
      completedAtMs: block.completedAtMs,
    },
    durationMs: null,
  });
  if (!label) return null;

  return (
    <div className="min-w-0 text-size-chat relative overflow-visible py-0">
      <motion.div
        initial={CODEX_THREAD_DIVIDER_ENTER_INITIAL}
        animate={CODEX_THREAD_DIVIDER_ENTER_ANIMATE}
        transition={CODEX_THREAD_ACCORDION_TRANSITION}
        style={{ overflow: "hidden" }}
      >
        <div className="text-size-chat flex min-h-0 flex-col items-start gap-2 overflow-hidden text-token-text-secondary">
          <span className="text-token-foreground/60">{label}</span>
          <div className="w-full border-t border-current/20" />
        </div>
      </motion.div>
    </div>
  );
}

function AssistantMessageActionsRow({
  actions,
  threadId,
  turnId,
  isLatestTurn,
  onForkFromTurn,
}: {
  actions: ThreadAssistantMessageActionsModel;
  threadId: string;
  turnId: string;
  isLatestTurn: boolean;
  onForkFromTurn?: (input: { threadId: string; turnId: string; message: string; isLatestTurn: boolean }) => void | Promise<void>;
}) {
  const [selectedRating, setSelectedRating] = useState<AssistantMessageRating | null>(null);
  const shouldShowActions = actions.copyText !== null || actions.canFork;
  if (!shouldShowActions) return null;

  return (
    <ThreadMessageActionRow align="start">
      {actions.copyText !== null ? (
        <>
          <CopyMessageActionButton
            text={actions.copyText}
            label="Copy"
            stopPropagation
          />
          {actions.canRate ? (
            <>
              <AssistantRatingButton
                rating="thumbs_up"
                selectedRating={selectedRating}
                onSelect={setSelectedRating}
              />
              <AssistantRatingButton
                rating="thumbs_down"
                selectedRating={selectedRating}
                onSelect={setSelectedRating}
              />
            </>
          ) : null}
        </>
      ) : null}
      {actions.canFork ? (
        <ThreadActionIconButton
          label="Fork from this point"
          tooltip="Fork"
          onClick={(event) => {
            event.stopPropagation();
            void onForkFromTurn?.({
              threadId,
              turnId,
              message: "",
              isLatestTurn,
            });
          }}
        >
          <ForkMessageIcon />
        </ThreadActionIconButton>
      ) : null}
      <MessageTimestamp sentAtMs={actions.sentAtMs} />
    </ThreadMessageActionRow>
  );
}

export function ThreadAssistantBodyBlock({
  block,
  isLatestTurn,
  isStreamingTurn,
  isSearchMatch = false,
  isActiveSearchMatch = false,
  onForkFromTurn,
  assistantAfter,
}: ThreadLeafBlockProps) {
  const markdownText = block.entry.markdownText ?? "";
  const isAssistantItemStreaming = isStreamingTurn && block.entry.status === "inProgress";
  const assistantActions = block.assistantMessageActions;

  useEffect(() => {
    logAssistantStreamingDebugState(
      "renderer-assistant-block-render",
      `${block.entry.threadId}:${block.turnId}:${block.entry.itemId}`,
      `${isStreamingTurn}:${block.entry.status ?? "null"}:${isAssistantItemStreaming}:${markdownText.length}`,
      {
        threadId: block.entry.threadId,
        turnId: block.turnId,
        itemId: block.entry.itemId,
        itemStatus: block.entry.status ?? null,
        isLatestTurn,
        isStreamingTurn,
        isAssistantItemStreaming,
        markdownLength: markdownText.length,
      },
    );
  }, [
    block.entry.itemId,
    block.entry.status,
    block.entry.threadId,
    block.turnId,
    isAssistantItemStreaming,
    isLatestTurn,
    isStreamingTurn,
    markdownText.length,
  ]);

  return (
    <div
      className={cn(
        isSearchMatch && THREAD_VISUAL_TOKENS.searchUnitMatched,
        isActiveSearchMatch && THREAD_VISUAL_TOKENS.searchUnitActive,
      )}
      data-content-search-unit-key={block.searchUnitKey}
    >
      <div className="group flex min-w-0 flex-col">
        <div
          className={THREAD_VISUAL_TOKENS.assistantBody}
          data-thread-selected-text-target="true"
        >
          <MarkdownRenderer
            content={markdownText}
            parseIncompleteMarkdown={isAssistantItemStreaming}
            animateStreamingText={isAssistantItemStreaming}
          />
        </div>
        {assistantAfter ? (
          <div className="mt-3">
            {assistantAfter}
          </div>
        ) : null}
        {assistantActions ? (
          <AssistantMessageActionsRow
            actions={assistantActions}
            threadId={block.entry.threadId}
            turnId={block.turnId}
            isLatestTurn={isLatestTurn}
            onForkFromTurn={onForkFromTurn}
          />
        ) : null}
      </div>
    </div>
  );
}

export function ThreadAssistantActionsBlock({
  block,
  isLatestTurn,
  onForkFromTurn,
}: ThreadSpecialBlockProps & {
  onForkFromTurn?: (input: { threadId: string; turnId: string; message: string; isLatestTurn: boolean }) => void | Promise<void>;
}) {
  if (block.type !== "assistantActions") return null;

  return (
    <div className="group flex min-w-0 flex-col" data-assistant-actions-anchor={block.entry.itemId}>
      <AssistantMessageActionsRow
        actions={block.actions}
        threadId={block.entry.threadId}
        turnId={block.turnId}
        isLatestTurn={isLatestTurn}
        onForkFromTurn={onForkFromTurn}
      />
    </div>
  );
}

export function ThreadUserInputResponseCard({ block }: ThreadLeafBlockProps) {
  if (block.type !== "userInputResponse") return null;
  return <AnsweredUserInputBlock item={block.entry} />;
}

function resolveMcpServerElicitationSummary(entry: CodexConversationItem): {
  title: string;
  body: string | null;
} {
  const raw = asRecord(entry.rawItem);
  const serverName = typeof raw?.serverName === "string" ? raw.serverName.trim() : "";
  const message = typeof raw?.message === "string" ? raw.message.trim() : "";
  const action = typeof raw?.action === "string" ? raw.action.trim() : "";
  const title = serverName.length > 0 ? `MCP elicitation: ${serverName}` : "MCP elicitation";
  const body = [message, action.length > 0 ? `Action: ${action}` : ""]
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join("\n");

  return {
    title,
    body: body.length > 0 ? body : null,
  };
}

export function ThreadMcpServerElicitationBlock({ block }: ThreadLeafBlockProps) {
  if (block.type !== "mcpServerElicitation") return null;

  const summary = resolveMcpServerElicitationSummary(block.entry);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium tracking-wide text-token-description-foreground uppercase">
        <ToolActivityIcon descriptor={semanticToolIcon("connector")} />
        {summary.title}
      </div>
      {summary.body ? (
        <div className="text-size-chat whitespace-pre-wrap text-token-text-secondary">
          {summary.body}
        </div>
      ) : null}
    </div>
  );
}

export function ThreadPlanImplementationBlock({ block }: ThreadLeafBlockProps) {
  if (block.type !== "planImplementation") return null;

  const content = block.entry.markdownText?.trim() ?? "";
  if (content.length === 0) return null;

  return (
    <PlanMessage
      content={content}
      completed={block.status === "completed"}
      parseIncompleteMarkdown={false}
    />
  );
}

function ContextCompactionIcon({ className }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M12.666 3.50098C13.3549 3.50098 13.9121 3.50133 14.3623 3.53809C14.8202 3.5755 15.2268 3.65483 15.6035 3.84668C16.1988 4.15007 16.6829 4.63424 16.9863 5.22949C17.1782 5.60603 17.2575 6.01205 17.2949 6.46973C17.3317 6.91983 17.3311 7.47721 17.3311 8.16602V15.1377C17.9209 15.3944 18.333 15.9827 18.333 16.667C18.3328 17.5872 17.5872 18.3328 16.667 18.333C15.7466 18.333 15.0002 17.5873 15 16.667C15 15.9832 15.4119 15.3957 16.001 15.1387V8.16602C16.001 7.45532 16.0011 6.96153 15.9697 6.57812C15.939 6.20279 15.8822 5.99093 15.8018 5.83301C15.6258 5.4879 15.3442 5.20711 14.999 5.03125C14.8411 4.95091 14.6291 4.89394 14.2539 4.86328C13.8705 4.83199 13.3767 4.83105 12.666 4.83105H7.5C7.13284 4.83092 6.83496 4.5332 6.83496 4.16602C6.8353 3.79912 7.13305 3.50111 7.5 3.50098H12.666Z"
        fill="currentColor"
      />
      <path
        d="M3.33301 1.66699C4.25337 1.66699 4.99981 2.41269 5 3.33301C5 4.01711 4.58759 4.60453 3.99805 4.86133V11.833C3.99805 12.5438 3.99896 13.0374 4.03027 13.4209C4.06095 13.7963 4.11783 14.008 4.19824 14.166C4.37411 14.5112 4.6549 14.7918 5 14.9678C5.15797 15.0483 5.36958 15.105 5.74512 15.1357C6.12859 15.1671 6.6221 15.168 7.33301 15.168H12.5L12.6338 15.1816C12.9367 15.2437 13.1649 15.5118 13.165 15.833C13.165 16.1543 12.9368 16.4223 12.6338 16.4844L12.5 16.498H7.33301C6.64403 16.498 6.08691 16.4987 5.63672 16.4619C5.17904 16.4245 4.77303 16.3451 4.39648 16.1533C3.8011 15.8499 3.31608 15.365 3.0127 14.7695C2.82102 14.393 2.7415 13.987 2.7041 13.5293C2.66734 13.0791 2.66797 12.5219 2.66797 11.833V4.86035C2.07898 4.60332 1.66699 4.0167 1.66699 3.33301C1.66718 2.41283 2.41284 1.66721 3.33301 1.66699Z"
        fill="currentColor"
      />
      <path
        d="M10.1338 11.0146C10.4366 11.0766 10.6647 11.345 10.665 11.666C10.665 11.9873 10.4367 12.2553 10.1338 12.3174L10 12.3311H7.5C7.13284 12.3309 6.83496 12.0332 6.83496 11.666C6.8353 11.2991 7.13305 11.0011 7.5 11.001H10L10.1338 11.0146Z"
        fill="currentColor"
      />
      <path
        d="M12.6338 7.68164C12.9367 7.74367 13.1649 8.01182 13.165 8.33301C13.165 8.65433 12.9368 8.92232 12.6338 8.98438L12.5 8.99805H7.5C7.13284 8.99791 6.83496 8.7002 6.83496 8.33301C6.83513 7.96596 7.13294 7.6681 7.5 7.66797H12.5L12.6338 7.68164Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ThreadContextCompactionBlock({ block }: ThreadLeafBlockProps) {
  if (block.type !== "contextCompaction") return null;

  const isCompleted = block.status !== "inProgress";

  return (
    <div className="text-size-chat my-2 flex items-center gap-2 text-token-text-secondary">
      <div className="flex-1 border-t border-current/20" />
      <div className="flex items-center gap-1 whitespace-nowrap">
        {isCompleted ? <ContextCompactionIcon className="icon-2xs" /> : null}
        {isCompleted ? (
          <span>Context automatically compacted</span>
        ) : (
          <CodexShimmerText>Automatically compacting context</CodexShimmerText>
        )}
      </div>
      <div className="flex-1 border-t border-current/20" />
    </div>
  );
}

export function ThreadStreamErrorBlock({ block }: ThreadLeafBlockProps) {
  if (block.type !== "streamError") return null;

  const [isExpanded, setIsExpanded] = useState(false);
  const details = block.entry.additionalDetails?.trim() ?? "";
  const hasDetails = details.length > 0;
  const { elementHeightPx, elementRef } = useMeasuredElementHeight();
  const isOpen = hasDetails && isExpanded;

  return (
    <div className="flex min-w-0 flex-col">
      <div
        className={cn(
          "group flex min-w-0 items-start gap-1",
          hasDetails ? "cursor-interaction" : "cursor-default",
        )}
        onClick={() => {
          if (!hasDetails) return;
          setIsExpanded((current) => !current);
        }}
      >
        <div className="text-size-chat min-w-0 whitespace-pre-wrap text-token-description-foreground/80">
          {block.entry.markdownText ?? "Reconnecting..."}
        </div>
        {hasDetails ? (
          <ChevronRightIcon
            className={cn(
              "text-token-input-placeholder-foreground icon-2xs mt-0.5 shrink-0 transition-all duration-300 opacity-0 group-hover:opacity-100",
              isOpen && "rotate-90 opacity-100",
            )}
          />
        ) : null}
      </div>
      <motion.div
        initial={false}
        animate={{
          height: isOpen ? elementHeightPx : 0,
          opacity: isOpen ? 1 : 0,
        }}
        transition={CODEX_THREAD_ACCORDION_TRANSITION}
        className={isOpen ? "overflow-visible" : "overflow-hidden"}
        style={{ pointerEvents: isOpen ? "auto" : "none" }}
      >
        <div ref={elementRef}>
          {isOpen ? (
            <div className="mt-1 flex flex-col gap-1">
              <div className="text-size-chat whitespace-pre-wrap text-token-description-foreground/80">
                {details}
              </div>
            </div>
          ) : null}
        </div>
      </motion.div>
    </div>
  );
}

export function ThreadSystemErrorBlock({ block }: ThreadLeafBlockProps) {
  if (block.type !== "systemError") return null;

  return (
    <div className="text-size-chat flex w-full wrap-anywhere text-token-description-foreground/80">
      {block.entry.markdownText ?? "Thread hit an error"}
    </div>
  );
}

export function ThreadSystemBannerBlock({ block }: ThreadLeafBlockProps) {
  const item = block.entry;
  const label = humanizeBlockType(block.type);

  if (item.markdownText) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="text-[11px] font-medium tracking-wide text-token-description-foreground uppercase">{label}</div>
        <div className="text-size-chat-sm whitespace-pre-wrap text-token-text-secondary">
          {item.markdownText}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[11px] font-medium tracking-wide text-token-description-foreground uppercase">{label}</div>
      <div>
        <JsonBlock value={item.rawItem} />
      </div>
    </div>
  );
}
