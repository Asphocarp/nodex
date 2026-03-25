import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { MarkdownRenderer } from "../shared/markdown/markdown-renderer";
import { PlanMessage } from "../shared/plan-message";
import { ReasoningSurface } from "../shared/reasoning-surface";
import { TurnDiffSurface } from "../shared/turn-diff-surface";
import {
  CopyMessageActionButton,
  EditMessageIcon,
  ForkMessageIcon,
  ThreadActionIconButton,
  ThreadMessageActionRow,
} from "../shared/thread-message-actions";
import { TodoListSurface } from "../shared/todo-list-surface";
import { getToolComponent } from "../shared/tools/get-tool-component";
import { JsonBlock } from "../shared/tools/tool-primitives";
import { extractCommandActions } from "../shared/tools/command-actions";
import { AnsweredUserInputBlock } from "../composer/request-cards/answered-user-input-block";
import type { CodexCommandAction } from "../../../../lib/types";
import type { CodexConversationItem } from "../../../../lib/types";
import { resolveCodexThreadDetailLevel } from "../../../../lib/codex-thread-settings";
import { useCodexThreadSettings } from "../../../../lib/use-codex-thread-settings";
import { cn } from "../../../../lib/utils";
import type { ThreadBlockModel, ThreadTranscriptBlockModel } from "../../thread-stage-types";
import { THREAD_VISUAL_TOKENS } from "./local-conversation-visual-tokens";

export interface ThreadLeafBlockProps {
  block: ThreadTranscriptBlockModel;
  isLatestTurn: boolean;
  isStreamingTurn: boolean;
  isSearchMatch?: boolean;
  isActiveSearchMatch?: boolean;
  projectWorkspacePath?: string | null;
  threadCwd?: string | null;
  onEditLastUserTurn?: (input: { threadId: string; turnId: string; message: string }) => void | Promise<void>;
  onForkFromTurn?: (input: { threadId: string; turnId: string; message: string; isLatestTurn: boolean }) => void | Promise<void>;
}

export interface ThreadSpecialBlockProps {
  block: ThreadBlockModel;
  isLatestTurn: boolean;
  isStreamingTurn: boolean;
  projectWorkspacePath?: string | null;
  threadCwd?: string | null;
}

interface ExplorationDisplayLine {
  key: string;
  label: string;
}

interface ExplorationAccordionModel {
  lines: ExplorationDisplayLine[];
  uniqueReadFileCount: number;
  searchCount: number;
  listCount: number;
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
  const args = entry.toolCall?.args;
  if (typeof args !== "object" || args === null) return null;
  const cwd = (args as { cwd?: unknown }).cwd;
  return typeof cwd === "string" ? cwd : null;
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
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(
        "inline-chevron icon-2xs ml-1 text-token-input-placeholder-foreground group-hover:text-token-foreground transition-all duration-500 opacity-0 group-hover:opacity-100",
        expanded && "opacity-100 rotate-90",
      )}
      aria-hidden
    >
      <path
        d="M7.52925 3.7793C7.75652 3.55203 8.10803 3.52383 8.36616 3.69434L8.47065 3.7793L14.2207 9.5293C14.4804 9.789 14.4804 10.211 14.2207 10.4707L8.47065 16.2207C8.21095 16.4804 7.78895 16.4804 7.52925 16.2207C7.26955 15.961 7.26955 15.539 7.52925 15.2793L12.8085 10L7.52925 4.7207L7.44429 4.61621C7.27378 4.35808 7.30198 4.00657 7.52925 3.7793Z"
        fill="currentColor"
      />
    </svg>
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

const EXPLORATION_MAX_HEIGHT_BY_STATE: Record<ExplorationViewState, string> = {
  preview: "7rem",
  expanded: "20rem",
  collapsed: "0px",
};

function ThreadExplorationAccordion({ entries, status }: { entries: CodexConversationItem[]; status?: CodexConversationItem["status"] }) {
  const accordionId = useId();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const wasExploringRef = useRef(status === "inProgress");
  const hasAutoScrolledRef = useRef(false);
  const isExploring = status === "inProgress";
  const model = useMemo(() => buildExplorationAccordionModel(entries), [entries]);
  const [viewState, setViewState] = useState<ExplorationViewState>(isExploring ? "preview" : "collapsed");

  useEffect(() => {
    setViewState(isExploring ? "preview" : "collapsed");
    if (!isExploring) {
      hasAutoScrolledRef.current = false;
    }
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
  const bodyClassName = isExpanded ? "overflow-visible" : "overflow-hidden";

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
              <span className="text-token-foreground/40 group-hover:text-token-foreground min-w-0 flex-1 truncate">
                {isExploring ? (
                  <>
                    <span className="loading-shimmer-pure-text text-token-description-foreground/90 group-hover:text-token-foreground">
                      Exploring
                    </span>
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
            <div
              id={accordionId}
              data-testid="exploration-accordion-body"
              className={bodyClassName}
              style={{
                maxHeight: EXPLORATION_MAX_HEIGHT_BY_STATE[viewState],
                opacity: isExpanded ? 1 : 0,
                pointerEvents: isExpanded ? "auto" : "none",
                transition: "max-height 180ms cubic-bezier(0.2, 0, 0, 1), opacity 180ms cubic-bezier(0.2, 0, 0, 1)",
              }}
            >
              <div className="pt-0 text-token-foreground/60 [&_*]:text-token-foreground/50">
                <div className="-mx-2.5 mt-1">
                  <div
                    ref={scrollRef}
                    className="vertical-scroll-fade-mask [--edge-fade-distance:1.5rem] overflow-y-auto scroll-contain text-size-chat rounded-none border-0 px-2.5 font-sans text-token-description-foreground/80 [&_*]:text-token-description-foreground/80"
                    style={{
                      maxHeight: EXPLORATION_MAX_HEIGHT_BY_STATE[viewState],
                    }}
                  >
                    <div className={cn("flex flex-col gap-1", viewState === "preview" && "pb-1")}>
                      {model.lines.map((line) => (
                        <div key={line.key}>
                          <div className="truncate">{line.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
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
      return "Context compacted";
    case "automaticApprovalReview":
      return "Approval review";
    case "mcpServerElicitation":
      return "MCP elicitation";
    case "mcpToolCall":
      return "MCP tool call";
    case "multiAgentAction":
      return "Multi-agent action";
    case "webSearch":
      return "Web search";
    case "workedFor":
      return "Worked for";
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
  projectWorkspacePath,
  threadCwd,
}: ThreadSpecialBlockProps) {
  if (block.type !== "multiAgentGroup") return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] font-medium tracking-wide text-token-description-foreground uppercase">{block.summary}</div>
      <div className="flex flex-col gap-2">
        {block.entries.map((entry) => {
          const ToolComponent = getToolComponent(entry);
          return (
            <ToolComponent
              key={entry.entryId ?? entry.itemId}
              item={entry}
              projectWorkspacePath={projectWorkspacePath ?? undefined}
              threadCwd={threadCwd ?? undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

export function ThreadThinkingPlaceholderBlock({ block }: ThreadSpecialBlockProps) {
  if (block.type !== "thinkingPlaceholder") return null;

  return (
    <div className="min-w-0 py-0">
      <div className="flex items-center gap-1.5">
        <span className="loading-shimmer-pure-text text-size-chat truncate text-token-foreground/30">
          Thinking
        </span>
      </div>
    </div>
  );
}

export function ThreadToolSurfaceBlock({
  block,
  projectWorkspacePath,
  threadCwd,
}: ThreadLeafBlockProps) {
  const item = block.entry;
  const ToolComponent = getToolComponent(item);

  return (
    <ToolComponent
      item={item}
      projectWorkspacePath={projectWorkspacePath ?? undefined}
      threadCwd={threadCwd ?? undefined}
    />
  );
}

export function ThreadTurnDiffBlock({
  block,
  projectWorkspacePath,
  threadCwd,
}: ThreadLeafBlockProps) {
  return (
    <TurnDiffSurface
      item={block.entry}
      projectWorkspacePath={projectWorkspacePath ?? undefined}
      threadCwd={threadCwd ?? undefined}
    />
  );
}

export function ThreadUserBubbleBlock({
  block,
  isLatestTurn,
  isSearchMatch = false,
  isActiveSearchMatch = false,
  onEditLastUserTurn,
  onForkFromTurn,
}: ThreadLeafBlockProps) {
  const content = block.entry.markdownText ?? "";
  const userActions = block.userMessageActions;
  const canFork = userActions?.canFork ?? false;
  const canEdit = userActions?.canEdit ?? false;
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
            <MarkdownRenderer content={content} preserveLineBreaks className="codex-markdown-user text-size-chat" />
          </div>
        )}
        {content.length > 0 ? (
          <div className="flex flex-row-reverse items-center gap-1">
            {isEditing ? null : (
              <ThreadMessageActionRow align="end">
                <CopyMessageActionButton text={content} />
                {canFork ? (
                  <ThreadActionIconButton
                    label="Fork from this message"
                    tooltip="Fork"
                    onClick={() => {
                      void onForkFromTurn?.({
                        threadId: block.entry.threadId,
                        turnId: block.turnId,
                        message: content,
                        isLatestTurn,
                      });
                    }}
                  >
                    <ForkMessageIcon />
                  </ThreadActionIconButton>
                ) : null}
                {canEdit ? (
                  <ThreadActionIconButton
                    label="Edit message"
                    tooltip="Edit"
                    onClick={openInlineEditor}
                  >
                    <EditMessageIcon />
                  </ThreadActionIconButton>
                ) : null}
              </ThreadMessageActionRow>
            )}
          </div>
        ) : null}
      </div>
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

  return (
    <div className="flex flex-col gap-2">
      {block.type === "todoList" ? (
        <TodoListSurface item={item} />
      ) : (
        <>
          <div className="text-[11px] font-medium tracking-wide text-token-description-foreground uppercase">
            Proposed plan
          </div>
          <PlanMessage
            content={item.markdownText ?? ""}
            parseIncompleteMarkdown={isStreamingTurn && (item.status === "inProgress" || isLatestTurn)}
            defaultExpanded={Boolean(isStreamingTurn || item.status === "inProgress")}
          />
        </>
      )}
    </div>
  );
}

export function ThreadWorkedForBlock({ block }: ThreadLeafBlockProps) {
  const timeLabel = block.entry.timeLabel?.trim();
  if (!timeLabel) return null;

  return (
    <div className="flex items-center gap-2 overflow-hidden text-size-chat text-token-text-secondary">
      <div className="flex-1 border-t border-current/20" />
      <span>Worked for {timeLabel}</span>
      <div className="flex-1 border-t border-current/20" />
    </div>
  );
}

export function ThreadAssistantBodyBlock({
  block,
  isLatestTurn,
  isStreamingTurn,
  isSearchMatch = false,
  isActiveSearchMatch = false,
}: ThreadLeafBlockProps) {
  const markdownText = block.entry.markdownText ?? "";

  return (
    <div
      className={cn(
        isSearchMatch && THREAD_VISUAL_TOKENS.searchUnitMatched,
        isActiveSearchMatch && THREAD_VISUAL_TOKENS.searchUnitActive,
      )}
      data-content-search-unit-key={block.searchUnitKey}
    >
      <div className="group flex flex-col gap-1">
        <div className={THREAD_VISUAL_TOKENS.assistantBody}>
          <MarkdownRenderer
            content={markdownText}
            parseIncompleteMarkdown={isStreamingTurn && (block.entry.status === "inProgress" || isLatestTurn)}
          />
        </div>
        {block.showAssistantMessageActions ? (
          <div className={THREAD_VISUAL_TOKENS.actionRow}>
            <ThreadMessageActionRow align="start">
              <CopyMessageActionButton text={markdownText} />
            </ThreadMessageActionRow>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ThreadAnsweredUserInputCard({ block }: ThreadLeafBlockProps) {
  return <AnsweredUserInputBlock item={block.entry} />;
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
