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
} from "react";
import { motion } from "motion/react";
import { ChevronRightIcon } from "@/components/shared/icons";
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
import { getWebSearchSummaryDetail } from "../shared/tools/web-search-tool-call";
import { JsonBlock } from "../shared/tools/tool-primitives";
import { extractCommandActions } from "../shared/tools/command-actions";
import {
  ToolActivityIcon,
  resolveCollapsedToolActivityIcon,
  resolveExplorationEntriesIcon,
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
import type { CodexCommandAction } from "../../../../lib/types";
import type { CodexConversationItem, CodexTurnDiffReviewTarget } from "../../../../lib/types";
import { resolveCodexThreadDetailLevel } from "../../../../lib/codex-thread-settings";
import { useCodexThreadSettings } from "../../../../lib/use-codex-thread-settings";
import { cn } from "../../../../lib/utils";
import type {
  ThreadAssistantMessageActionsModel,
  ThreadBlockModel,
  ThreadTranscriptBlockModel,
  ThreadWorkedForAdornmentModel,
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
}

export interface ThreadSpecialBlockProps {
  block: ThreadBlockModel;
  isLatestTurn: boolean;
  isStreamingTurn: boolean;
  projectWorkspacePath?: string | null;
  threadCwd?: string | null;
  onOpenTurnDiffReview?: (target: CodexTurnDiffReviewTarget) => void;
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

function normalizeExplorationPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const isAbsolute = trimmed.startsWith("/");
  const normalizedSegments: string[] = [];
  for (const segment of trimmed.replaceAll("\\", "/").split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      if (normalizedSegments.length > 0 && normalizedSegments[normalizedSegments.length - 1] !== "..") {
        normalizedSegments.pop();
        continue;
      }
      if (!isAbsolute) normalizedSegments.push(segment);
      continue;
    }
    normalizedSegments.push(segment);
  }

  const normalizedPath = normalizedSegments.join("/");
  if (isAbsolute) return normalizedPath.length > 0 ? `/${normalizedPath}` : "/";
  return normalizedPath.length > 0 ? normalizedPath : null;
}

function resolveExplorationPath(path: string | null | undefined, cwd: string | null | undefined): string | null {
  const normalizedPath = normalizeExplorationPath(path);
  if (!normalizedPath) return null;
  if (normalizedPath.startsWith("/")) return normalizedPath;
  const normalizedCwd = normalizeExplorationPath(cwd);
  if (!normalizedCwd) return normalizedPath;
  return normalizeExplorationPath(`${normalizedCwd}/${normalizedPath}`);
}

function formatSkillName(value: string): string {
  return value
    .replaceAll("_", "-")
    .split("-")
    .filter((segment) => segment.length > 0)
    .map((segment) => `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`)
    .join(" ");
}

function resolveExplorationSkill(path: string | null): { skillName: string } | null {
  const normalizedPath = normalizeExplorationPath(path);
  if (!normalizedPath) return null;

  const segments = normalizedPath
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment.length > 0);

  for (let index = 0; index < segments.length; index += 1) {
    const current = segments[index]?.toLowerCase();
    const next = segments[index + 1]?.toLowerCase();
    if ((current !== ".codex" && current !== ".agents") || next !== "skills") continue;

    const candidate = segments[index + 2] ?? null;
    const candidateLower = candidate?.toLowerCase();
    const skillSegment = candidateLower === "_import" || candidateLower === ".system"
      ? segments[index + 3] ?? null
      : candidate;

    if (!skillSegment) continue;
    return { skillName: formatSkillName(skillSegment) };
  }

  return null;
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
  const resolvedSkill = resolveExplorationSkill(resolvedSkillPath);

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
}: ThreadSpecialBlockProps) {
  if (block.type !== "multiAgentGroup") return null;

  return <MultiAgentActionSurface items={block.entries} />;
}

function renderCollapsedActivityEntry({
  entry,
  isLatestTurn,
  isStreamingTurn,
  projectWorkspacePath,
  threadCwd,
  onOpenTurnDiffReview,
}: {
  entry: Extract<ThreadBlockModel, { type: "collapsedToolActivity" }>["entries"][number];
  isLatestTurn: boolean;
  isStreamingTurn: boolean;
  projectWorkspacePath?: string | null;
  threadCwd?: string | null;
  onOpenTurnDiffReview?: (target: CodexTurnDiffReviewTarget) => void;
}) {
  const sharedProps = {
    isLatestTurn,
    isStreamingTurn,
    projectWorkspacePath,
    threadCwd,
    onOpenTurnDiffReview,
  };

  if (entry.type === "explorationGroup") return <ThreadExplorationBodyOnly entries={entry.entries} />;
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

function resolveCollapsedExplorationActiveSummary(entries: CodexConversationItem[]): string | null {
  for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
    const entry = entries[entryIndex];
    if (!entry || entry.status !== "inProgress") continue;
    const actions = extractCommandActions(entry);
    for (let actionIndex = actions.length - 1; actionIndex >= 0; actionIndex -= 1) {
      const action = actions[actionIndex];
      if (!action) continue;
      const label = formatExplorationLine(action, extractCommandCwd(entry));
      if (action.type === "read") return label.replace(/^Read\b/, "Reading");
      if (action.type === "search") return label.replace(/^Searched\b/, "Searching");
      if (action.type === "listFiles") return label.replace(/^Listed\b/, "Listing");
    }
  }
  return null;
}

function resolveCollapsedFileChangeActiveSummary(entry: CodexConversationItem): string | null {
  const change = entry.fileChange?.changes.at(-1);
  if (!change) return null;
  if (change.type === "add") return `Creating ${change.path}`;
  if (change.type === "delete") return `Deleting ${change.path}`;
  return `Editing ${change.path}`;
}

interface CollapsedActivityActiveSummary {
  label: string;
}

function getAutomaticApprovalReviewStatus(entry: CodexConversationItem): string | null {
  const raw = asRecord(entry.rawItem);
  const review = asRecord(raw?.review);
  const status = review?.status ?? raw?.status;
  return typeof status === "string" ? status : null;
}

function resolveCollapsedActivityActiveSummaryPass(
  entries: Extract<ThreadBlockModel, { type: "collapsedToolActivity" }>["entries"],
  inProgressOnly: boolean,
): CollapsedActivityActiveSummary | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry) continue;
    if (inProgressOnly && entry.status !== "inProgress") continue;

    if (entry.type === "explorationGroup") {
      const label = resolveCollapsedExplorationActiveSummary(entry.entries);
      if (label) return { label };
      continue;
    }
    if (entry.type === "fileChange" && entry.status === "inProgress") {
      const label = resolveCollapsedFileChangeActiveSummary(entry.entry);
      if (label) return { label };
      continue;
    }
    if (entry.type === "webSearch") {
      if (entry.status !== "inProgress") continue;
      const detail = getWebSearchSummaryDetail(entry.entry);
      return { label: detail.length > 0 ? `Searching the web for ${detail}` : "Searching the web" };
    }
    if (entry.type === "exec") {
      if (entry.status !== "inProgress") continue;
      const command = entry.entry.command?.trim();
      return { label: command && command.length > 0 ? `Running ${command}` : "Running command" };
    }
    if (entry.type === "automaticApprovalReview" && !inProgressOnly) {
      const status = getAutomaticApprovalReviewStatus(entry.entry) ?? entry.status;
      if (status === "approved") return { label: "Approved request" };
      if (status === "denied") return { label: "Denied request" };
    }
  }
  return null;
}

function resolveCollapsedActivityActiveSummary(
  entries: Extract<ThreadBlockModel, { type: "collapsedToolActivity" }>["entries"],
): CollapsedActivityActiveSummary | null {
  return resolveCollapsedActivityActiveSummaryPass(entries, true)
    ?? resolveCollapsedActivityActiveSummaryPass(entries, false);
}

function shouldShimmerCollapsedActivitySummary(
  stats: Extract<ThreadBlockModel, { type: "collapsedToolActivity" }>["summaryStats"],
): boolean {
  if (!stats) return false;
  return stats.runningCreatedFileCount > 0
    || stats.runningEditedFileCount > 0
    || stats.runningDeletedFileCount > 0
    || stats.runningExploredFileCount > 0
    || stats.runningSearchCount > 0
    || stats.runningListCount > 0
    || stats.runningHookCount > 0
    || stats.runningCommandCount > 0
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

  const writingMatch = summary.match(/ • [^,]*writing \d+ lines?/i);
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

export function ThreadCollapsedToolActivityBlock({
  block,
  isLatestTurn,
  isStreamingTurn,
  projectWorkspacePath,
  threadCwd,
  onOpenTurnDiffReview,
}: ThreadSpecialBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isBodyMounted, setIsBodyMounted] = useState(false);

  if (block.type !== "collapsedToolActivity") return null;
  const icon = resolveCollapsedToolActivityIcon(block.entries);
  const activeSummary = isLatestTurn && isStreamingTurn
    ? resolveCollapsedActivityActiveSummary(block.entries)
    : null;
  const shouldShimmerAggregate = !activeSummary
    && isLatestTurn
    && isStreamingTurn
    && shouldShimmerCollapsedActivitySummary(block.summaryStats);

  const handleToggle = () => {
    if (isExpanded) {
      setIsExpanded(false);
      return;
    }
    if (isBodyMounted) {
      setIsExpanded(true);
      return;
    }
    setIsBodyMounted(true);
    requestAnimationFrame(() => {
      setIsExpanded(true);
    });
  };

  return (
    <div className="flex min-w-0 flex-col">
      <button
        type="button"
        className="group/collapsed-tool-activity group/summary inline-flex w-fit max-w-full cursor-interaction items-center gap-1 self-start text-left"
        aria-expanded={isExpanded}
        onClick={handleToggle}
      >
        <span className="text-token-foreground/40 block min-w-0 max-w-full truncate shrink overflow-hidden [mask-image:linear-gradient(to_right,black_calc(100%_-_0.25rem),transparent)] [mask-repeat:no-repeat] pr-1 group-hover/collapsed-tool-activity:text-token-foreground">
          <span className="inline-flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden">
            {icon ? <ToolActivityIcon descriptor={icon} /> : null}
            <span className="min-w-0 flex-1 truncate">
              {activeSummary ? (
                <CodexShimmerText>{activeSummary.label}</CodexShimmerText>
              ) : (
                <CollapsedActivitySummaryText summary={block.summary} shimmer={shouldShimmerAggregate} />
              )}
            </span>
          </span>
        </span>
        <span
          className={cn(
            "inline-chevron flex-shrink-0 text-token-input-placeholder-foreground opacity-0 group-hover/summary:opacity-100",
            isExpanded && "opacity-100",
          )}
        >
          <ChevronRightIcon
            className={cn(
              "icon-2xs text-current transition-transform duration-300",
              isExpanded && "rotate-90",
            )}
          />
        </span>
      </button>
      {isBodyMounted ? (
        <motion.div
          initial={false}
          animate={isExpanded ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
          transition={CODEX_THREAD_ACCORDION_TRANSITION}
          data-testid="collapsed-tool-activity-body"
          data-thread-find-skip={isExpanded ? undefined : true}
          style={{
            overflow: "hidden",
            pointerEvents: isExpanded ? "auto" : "none",
          }}
          onAnimationComplete={() => {
            if (!isExpanded) setIsBodyMounted(false);
          }}
        >
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
                })}
              </div>
            ))}
          </div>
        </motion.div>
      ) : null}
    </div>
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
  projectWorkspacePath,
  threadCwd,
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
      defaultExpandExecShell={nestedInCollapsedActivity && threadDetailLevel !== "STEPS_PROSE"}
      execSummaryTone={nestedInCollapsedActivity ? "muted" : "default"}
      hideHeader={nestedInCollapsedActivity && block.type === "webSearch"}
      showExecSummaryIcon={!nestedInCollapsedActivity}
    />
  );
}

export function ThreadTurnDiffBlock({
  block,
  isStreamingTurn,
  projectWorkspacePath,
  threadCwd,
  onOpenTurnDiffReview,
}: ThreadLeafBlockProps) {
  return (
    <TurnDiffSurface
      item={block.entry}
      isInProgress={isStreamingTurn}
      projectWorkspacePath={projectWorkspacePath ?? undefined}
      threadCwd={threadCwd ?? undefined}
      onOpenReview={onOpenTurnDiffReview}
    />
  );
}

export function ThreadAutomaticApprovalReviewBlock({ block }: ThreadLeafBlockProps) {
  if (block.type !== "automaticApprovalReview") return null;
  return <AutomaticApprovalReviewSurface item={block.entry} />;
}

export function ThreadMultiAgentActionBlock({ block }: ThreadLeafBlockProps) {
  if (block.type !== "multiAgentAction") return null;
  return <MultiAgentActionSurface items={[block.entry]} />;
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
          <div className={THREAD_VISUAL_TOKENS.userBubble}>
            <UserMessageText text={content} />
          </div>
        )}
        {content.length > 0 ? (
          <div className="flex flex-row-reverse items-center gap-1">
            {isEditing ? null : (
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
}: ThreadLeafBlockProps) {
  const item = block.entry;
  const isInProgress = item.status === "inProgress";
  const shouldParseIncompleteMarkdown = isStreamingTurn && (isInProgress || isLatestTurn);

  return (
    block.type === "todoList" ? (
      <TodoListSurface item={item} />
    ) : (
      <PlanMessage
        content={item.markdownText ?? ""}
        completed={!isInProgress}
        parseIncompleteMarkdown={shouldParseIncompleteMarkdown}
        defaultCollapsed={isInProgress}
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

export function ThreadWorkedForBlock({ adornment }: { adornment: ThreadWorkedForAdornmentModel }) {
  const timeLabel = adornment.timeLabel.trim();
  if (!timeLabel) return null;

  return (
    <motion.div
      initial={CODEX_THREAD_DIVIDER_ENTER_INITIAL}
      animate={CODEX_THREAD_DIVIDER_ENTER_ANIMATE}
      transition={CODEX_THREAD_ACCORDION_TRANSITION}
      style={{ overflow: "hidden" }}
    >
      <div className="flex items-center gap-2 overflow-hidden text-size-chat text-token-text-secondary">
        <div className="flex-1 border-t border-current/20" />
        <span>Worked for {timeLabel}</span>
        <div className="flex-1 border-t border-current/20" />
      </div>
    </motion.div>
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
}: ThreadLeafBlockProps) {
  const markdownText = block.entry.markdownText ?? "";
  const isStreamingAssistantText = isStreamingTurn && (block.entry.status === "inProgress" || isLatestTurn);
  const assistantActions = block.assistantMessageActions;

  return (
    <div
      className={cn(
        isSearchMatch && THREAD_VISUAL_TOKENS.searchUnitMatched,
        isActiveSearchMatch && THREAD_VISUAL_TOKENS.searchUnitActive,
      )}
      data-content-search-unit-key={block.searchUnitKey}
    >
      <div className="group flex min-w-0 flex-col">
        <div className={THREAD_VISUAL_TOKENS.assistantBody}>
          <MarkdownRenderer
            content={markdownText}
            parseIncompleteMarkdown={isStreamingAssistantText}
            animateStreamingText={isStreamingAssistantText}
          />
        </div>
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
      defaultCollapsed={block.status !== "completed"}
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
