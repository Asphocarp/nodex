import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { NodexTooltip } from "@/components/ui/tooltip";
import { ChevronRightIcon } from "@/components/shared/icons";
import type { CodexConversationItem } from "../../../../lib/types";
import { cn } from "../../../../lib/utils";
import {
  normalizeMultiAgentActionPayload,
  type CodexMultiAgentActionName,
  type CodexMultiAgentActionPayload,
  type CodexMultiAgentReceiverThread,
  type CodexMultiAgentActionStatus,
  type CodexMultiAgentAgentState,
} from "../../../../../shared/codex-transcript-special-items";
import type { ThreadOpenSubagentPayload, ThreadOpenThreadContext } from "../../thread-stage-types";
import { CODEX_THREAD_ACCORDION_TRANSITION } from "./thread-motion";
import { useMeasuredElementHeight } from "./use-measured-element-height";
import { CodexShimmerText } from "./codex-shimmer-text";

function getHeaderLabel(action: CodexMultiAgentActionName, status: CodexMultiAgentActionStatus): string {
  if (action === "spawnAgent") {
    if (status === "inProgress") return "Creating";
    if (status === "completed") return "Created";
    return "Failed to create";
  }
  if (action === "sendInput") {
    if (status === "inProgress") return "Messaging";
    if (status === "completed") return "Messaged";
    return "Failed to message";
  }
  if (action === "resumeAgent") {
    if (status === "inProgress") return "Resuming";
    if (status === "completed") return "Resumed";
    return "Failed to resume";
  }
  if (action === "closeAgent") {
    if (status === "inProgress") return "Closing";
    if (status === "completed") return "Closed";
    return "Failed to close";
  }
  return "Waiting";
}

function getRowActionLabel(action: CodexMultiAgentActionName, status: CodexMultiAgentActionStatus): string {
  if (action === "sendInput") {
    if (status === "inProgress") return "Messaging";
    if (status === "completed") return "Messaged";
    return "Failed messaging";
  }
  if (action === "spawnAgent") {
    if (status === "inProgress") return "Creating";
    if (status === "completed") return "Created";
    return "Failed creating";
  }
  if (action === "resumeAgent") {
    if (status === "inProgress") return "Resuming";
    if (status === "completed") return "Resumed";
    return "Failed resuming";
  }
  if (action === "closeAgent") {
    if (status === "inProgress") return "Closing";
    if (status === "completed") return "Closed";
    return "Failed closing";
  }
  return "Waiting";
}

function getPromptSendInputActionLabel(status: CodexMultiAgentActionStatus): string {
  if (status === "inProgress") return "Messaging";
  if (status === "completed") return "Messaged";
  return "Failed to message";
}

function getAgentStateLabel(status: CodexMultiAgentAgentState["status"]): string {
  switch (status) {
    case "pendingInit":
      return "pending init";
    case "running":
      return "running";
    case "interrupted":
      return "interrupted";
    case "shutdown":
      return "shutdown";
    case "completed":
      return "completed";
    case "errored":
      return "errored";
    case "notFound":
      return "not found";
  }
}

function getAgentDisplayName(
  threadId: string,
  receiverThread: CodexMultiAgentReceiverThread | undefined,
): string {
  const nickname = receiverThread?.thread?.nickname?.trim();
  if (nickname) return nickname.startsWith("@") ? nickname.slice(1) : nickname;

  const fallback = threadId.trim();
  return fallback.startsWith("@") ? fallback.slice(1) : fallback;
}

function getAgentRole(receiverThread: CodexMultiAgentReceiverThread | undefined): string | null {
  const role = receiverThread?.thread?.agentRole?.trim();
  if (!role || role === "default") return null;
  return role;
}

function getAgentOpenStatus(state: CodexMultiAgentAgentState | undefined): ThreadOpenSubagentPayload["status"] {
  if (!state) return "done";
  if (state.status === "pendingInit") return "waiting";
  if (state.status === "running") return "active";
  return "done";
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function getAgentStateSuffix(state: CodexMultiAgentAgentState | undefined): string {
  if (!state) return "";
  const stateLabel = getAgentStateLabel(state.status);
  const message = state.message?.trim() ?? "";
  if (message.length === 0) return ` (${stateLabel})`;
  return ` (${stateLabel}: ${message})`;
}

function listTargetThreadIds(payload: CodexMultiAgentActionPayload): string[] {
  return Array.from(
    new Set([
      ...payload.receiverThreads.map((entry) => entry.threadId),
      ...Object.keys(payload.agentsStates),
    ]),
  ).sort();
}

function countTargets(items: CodexMultiAgentActionPayload[]): number {
  const threadIds = new Set(items.flatMap((item) => listTargetThreadIds(item)));
  return threadIds.size > 0 ? threadIds.size : items.length;
}

function getCountLabel(count: number): string {
  if (count <= 0) return "";
  if (count === 1) return " an agent";
  return ` ${count} agents`;
}

function resolveGroupStatus(items: CodexMultiAgentActionPayload[]): CodexMultiAgentActionStatus {
  if (items.some((item) => item.status === "inProgress")) return "inProgress";
  if (items.some((item) => item.status === "failed")) return "failed";
  return "completed";
}

interface MultiAgentRenderedRow {
  key: string;
  node: ReactNode;
}

type OpenMultiAgentThread = (threadId: string, context?: ThreadOpenThreadContext) => void | Promise<void>;

function getSpawnModelByThreadId(items: CodexMultiAgentActionPayload[]): Map<string, string> {
  const models = new Map<string, string>();
  for (const item of items) {
    const model = normalizeNullableText(item.model);
    if (item.action !== "spawnAgent" || !model) continue;

    for (const targetThreadId of listTargetThreadIds(item)) {
      const threadId = targetThreadId.trim();
      if (threadId.length === 0) continue;
      models.set(threadId, model);
    }
  }
  return models;
}

function AgentLabel({
  onOpenThread,
  spawnModel,
  state,
  threadId,
  receiverThread,
}: {
  onOpenThread?: OpenMultiAgentThread;
  spawnModel: string | null;
  state: CodexMultiAgentAgentState | undefined;
  threadId: string;
  receiverThread: CodexMultiAgentReceiverThread | undefined;
}) {
  const displayName = getAgentDisplayName(threadId, receiverThread);
  const role = getAgentRole(receiverThread);
  const label = onOpenThread ? (
    <button
      type="button"
      className="cursor-interaction bg-transparent p-0 align-baseline font-medium"
      data-testid="multi-agent-action-agent-button"
      onClick={() => {
        void onOpenThread(threadId, {
          subagent: {
            agentRole: role,
            conversationId: threadId,
            diffStats: null,
            displayName,
            spawnModel,
            status: getAgentOpenStatus(state),
            statusSummary: normalizeNullableText(state?.message),
          },
        });
      }}
    >
      {displayName}
    </button>
  ) : (
    <span className="font-medium">{displayName}</span>
  );

  return (
    <span data-testid="multi-agent-action-agent">
      {label}
      {role ? <span>{` (${role})`}</span> : null}
    </span>
  );
}

function useElementOverflow(ref: React.RefObject<HTMLElement | null>, key: string): boolean {
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const update = () => {
      setOverflows(element.scrollWidth - element.clientWidth > 1);
    };
    update();

    if (typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [key, ref]);

  return overflows;
}

function InlinePrompt({ prompt }: { prompt: string }) {
  const promptRef = useRef<HTMLSpanElement | null>(null);
  const overflows = useElementOverflow(promptRef, prompt);
  const promptNode = (
    <span
      ref={promptRef}
      className="min-w-0 flex-1 truncate text-token-conversation-summary-trailing"
      data-testid="multi-agent-action-inline-prompt"
    >
      {prompt}
    </span>
  );

  return (
    <NodexTooltip
      tooltipContent={<span className="whitespace-pre-wrap">{prompt}</span>}
      disabled={!overflows}
    >
      {promptNode}
    </NodexTooltip>
  );
}

function InlineRow({ children }: { children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1 overflow-hidden whitespace-nowrap">
      {children}
    </span>
  );
}

function getReceiverThreadMap(payload: CodexMultiAgentActionPayload): Map<string, CodexMultiAgentReceiverThread> {
  return new Map(payload.receiverThreads.map((entry) => [entry.threadId, entry]));
}

function makeRowKey(prefix: string, item: CodexMultiAgentActionPayload, fallbackIndex: number, suffix?: string): string {
  const id = item.id ?? `${item.action}-${fallbackIndex}`;
  return suffix ? `${prefix}-${id}-${suffix}` : `${prefix}-${id}`;
}

function renderRows(
  items: CodexMultiAgentActionPayload[],
  onOpenThread: OpenMultiAgentThread | undefined,
): MultiAgentRenderedRow[] {
  const rows: MultiAgentRenderedRow[] = [];
  const spawnModelByThreadId = getSpawnModelByThreadId(items);

  for (const [itemIndex, item] of items.entries()) {
    const targetThreadIds = listTargetThreadIds(item);
    const rawPrompt = item.prompt ?? "";
    const hasPrompt = rawPrompt.trim().length > 0;
    const isSpawnWithInstructions = item.action === "spawnAgent" && item.status === "completed" && hasPrompt;
    const isSendInputWithPrompt = item.action === "sendInput" && hasPrompt;
    const receiverThreads = getReceiverThreadMap(item);

    if (targetThreadIds.length === 0) {
      rows.push({
        key: makeRowKey("row-generic", item, itemIndex),
        node: getRowActionLabel(item.action, item.status),
      });
      continue;
    }

    for (const threadId of targetThreadIds) {
      const agent = (
        <AgentLabel
          onOpenThread={onOpenThread}
          receiverThread={receiverThreads.get(threadId)}
          spawnModel={spawnModelByThreadId.get(threadId) ?? null}
          state={item.agentsStates[threadId]}
          threadId={threadId}
        />
      );
      const stateSuffix = item.action === "closeAgent" || item.action === "resumeAgent"
        ? ""
        : getAgentStateSuffix(item.agentsStates[threadId]);

      if (isSpawnWithInstructions) {
        rows.push({
          key: makeRowKey("row", item, itemIndex, threadId),
          node: (
            <InlineRow>
              <span>Created</span>
              {" "}
              {agent}
              {" "}
              <span>with the instructions:</span>
              {" "}
              <InlinePrompt prompt={rawPrompt} />
            </InlineRow>
          ),
        });
        continue;
      }

      if (isSendInputWithPrompt) {
        rows.push({
          key: makeRowKey("row", item, itemIndex, threadId),
          node: (
            <InlineRow>
              <span>{getPromptSendInputActionLabel(item.status)}</span>
              {" "}
              <span>
                {agent}
                :{" "}
              </span>
              <InlinePrompt prompt={rawPrompt} />
            </InlineRow>
          ),
        });
        continue;
      }

      rows.push({
        key: makeRowKey("row", item, itemIndex, threadId),
        node: (
          <>
            {getRowActionLabel(item.action, item.status)}
            {" "}
            {agent}
            {stateSuffix}
          </>
        ),
      });
    }

    if (!isSpawnWithInstructions && !isSendInputWithPrompt && hasPrompt) {
      rows.push({
        key: makeRowKey("meta-prompt", item, itemIndex),
        node: (
          <>
            Input:{" "}
            <span className="break-words whitespace-pre-wrap" data-testid="multi-agent-action-meta-prompt">
              {rawPrompt}
            </span>
          </>
        ),
      });
    }
  }

  return rows;
}

export function MultiAgentActionSurface({
  items,
  forceInProgress = false,
  onOpenThread,
}: {
  items: CodexConversationItem[];
  forceInProgress?: boolean;
  onOpenThread?: OpenMultiAgentThread;
}) {
  const normalizedItems = items
    .map((item) => normalizeMultiAgentActionPayload(item.rawItem))
    .filter((item): item is CodexMultiAgentActionPayload => item !== null && item.action !== "wait");
  if (normalizedItems.length === 0) return null;

  const primaryItem = normalizedItems[0];
  if (!primaryItem) return null;

  const resolvedStatus = forceInProgress ? "inProgress" : resolveGroupStatus(normalizedItems);
  const isInProgress = resolvedStatus === "inProgress";
  const [expanded, setExpanded] = useState(false);
  const isOpen = isInProgress || expanded;
  const { elementHeightPx, elementRef } = useMeasuredElementHeight();
  const rowModels = renderRows(normalizedItems, onOpenThread);
  const targetCount = countTargets(normalizedItems);
  const countLabel = getCountLabel(targetCount);

  return (
    <div className="min-w-0 py-0">
      <div className="flex flex-col gap-1">
        <button
          type="button"
          className="group flex cursor-interaction items-center gap-1.5 text-left"
          data-testid="multi-agent-action-header"
          onClick={() => {
            if (isInProgress) return;
            setExpanded((current) => !current);
          }}
        >
          <span className="text-size-chat truncate">
            <CodexShimmerText
              active={isInProgress}
              className="text-token-description-foreground/90 group-hover:text-token-foreground"
            >
              {getHeaderLabel(primaryItem.action, resolvedStatus)}
            </CodexShimmerText>
            {countLabel ? (
              <span className="text-token-foreground/40 group-hover:text-token-foreground">
                {countLabel}
              </span>
            ) : null}
          </span>
          <ChevronRightIcon
            className={cn(
              "text-token-input-placeholder-foreground flex-shrink-0 transition-all duration-300 opacity-0 group-hover:opacity-100",
              isOpen && "opacity-100 rotate-90",
            )}
          />
        </button>
        <motion.div
          initial={false}
          animate={{
            height: isOpen ? elementHeightPx : 0,
            opacity: isOpen ? 1 : 0,
          }}
          transition={CODEX_THREAD_ACCORDION_TRANSITION}
          className={cn(isOpen ? "overflow-visible" : "overflow-hidden")}
          style={{
            pointerEvents: isOpen ? "auto" : "none",
          }}
        >
          <div ref={elementRef} className="flex flex-col gap-0.5" data-testid="multi-agent-action-rows">
            {rowModels.map((row) => (
              <div
                key={row.key}
                className="text-token-conversation-body [&_*]:text-token-non-assistant-body-descendant text-size-chat min-w-0"
              >
                {row.node}
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
