import { useState } from "react";
import { motion } from "motion/react";
import type { CodexConversationItem } from "../../../../lib/types";
import { cn } from "../../../../lib/utils";
import {
  normalizeMultiAgentActionPayload,
  type CodexMultiAgentActionName,
  type CodexMultiAgentActionPayload,
  type CodexMultiAgentActionStatus,
  type CodexMultiAgentAgentState,
} from "../../../../../shared/codex-transcript-special-items";
import { CODEX_MEASURED_TRANSITION, useMeasuredElementHeight } from "./use-measured-element-height";

function getHeaderLabel(action: CodexMultiAgentActionName, status: CodexMultiAgentActionStatus): string {
  if (action === "spawnAgent") {
    if (status === "inProgress") return "Spawning";
    if (status === "completed") return "Spawned";
    return "Failed to spawn";
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
    return "Failed to message";
  }
  return getHeaderLabel(action, status).replace(/^Failed to /, "Failed ");
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
  payload: CodexMultiAgentActionPayload,
): string {
  const receiverThread = payload.receiverThreads.find((entry) => entry.threadId === threadId)?.thread;
  const nickname = receiverThread?.nickname?.trim();
  if (nickname) return nickname.startsWith("@") ? nickname.slice(1) : nickname;

  const fallback = threadId.trim();
  return fallback.startsWith("@") ? fallback.slice(1) : fallback;
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
      ...payload.receiverThreadIds,
      ...payload.receiverThreads.map((entry) => entry.threadId),
      ...Object.keys(payload.agentsStates),
    ]),
  ).sort();
}

function countTargets(items: CodexMultiAgentActionPayload[]): number {
  const threadIds = new Set(items.flatMap((item) => listTargetThreadIds(item)));
  return threadIds.size > 0 ? threadIds.size : items.length;
}

function renderRows(items: CodexMultiAgentActionPayload[]): string[] {
  const rows: string[] = [];

  for (const item of items) {
    const targetThreadIds = listTargetThreadIds(item);
    const hasPrompt = (item.prompt?.trim().length ?? 0) > 0;
    const isSpawnWithInstructions = item.action === "spawnAgent" && item.status === "completed" && hasPrompt;
    const isSendInputWithPrompt = item.action === "sendInput" && hasPrompt;

    if (targetThreadIds.length === 0) {
      rows.push(getHeaderLabel(item.action, item.status));
      continue;
    }

    for (const threadId of targetThreadIds) {
      const agent = getAgentDisplayName(threadId, item);
      const stateSuffix = item.action === "closeAgent" || item.action === "resumeAgent"
        ? ""
        : getAgentStateSuffix(item.agentsStates[threadId]);

      if (isSpawnWithInstructions) {
        rows.push(`Created ${agent} with the instructions: ${item.prompt?.trim() ?? ""}`);
        continue;
      }

      if (isSendInputWithPrompt) {
        rows.push(`${getRowActionLabel(item.action, item.status)} ${agent}: ${item.prompt?.trim() ?? ""}`);
        continue;
      }

      rows.push(`${getRowActionLabel(item.action, item.status)} ${agent}${stateSuffix}`);
    }

    if (!isSpawnWithInstructions && !isSendInputWithPrompt && hasPrompt) {
      rows.push(`Input: ${item.prompt?.trim() ?? ""}`);
    }
  }

  return rows;
}

export function MultiAgentActionSurface({
  items,
  forceInProgress = false,
}: {
  items: CodexConversationItem[];
  forceInProgress?: boolean;
}) {
  const normalizedItems = items
    .map((item) => normalizeMultiAgentActionPayload(item.rawItem))
    .filter((item): item is CodexMultiAgentActionPayload => item !== null && item.action !== "wait");
  if (normalizedItems.length === 0) return null;

  const primaryItem = normalizedItems[0];
  if (!primaryItem) return null;

  const resolvedStatus = forceInProgress ? "inProgress" : primaryItem.status;
  const isInProgress = resolvedStatus === "inProgress";
  const [expanded, setExpanded] = useState(false);
  const isOpen = isInProgress || expanded;
  const { elementHeightPx, elementRef } = useMeasuredElementHeight();
  const rowText = renderRows(normalizedItems);
  const targetCount = countTargets(normalizedItems);
  const countLabel = targetCount > 0
    ? ` ${targetCount} ${targetCount === 1 ? "agent" : "agents"}`
    : "";

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
            <span className={cn("text-token-description-foreground/90 group-hover:text-token-foreground", isInProgress && "loading-shimmer-pure-text")}>
              {getHeaderLabel(primaryItem.action, resolvedStatus)}
            </span>
            {countLabel ? (
              <span className="text-token-foreground/40 group-hover:text-token-foreground">
                {countLabel}
              </span>
            ) : null}
          </span>
          <svg
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={cn(
              "text-token-input-placeholder-foreground icon-2xs flex-shrink-0 transition-all duration-300 opacity-0 group-hover:opacity-100",
              isOpen && "opacity-100 rotate-90",
            )}
            aria-hidden
          >
            <path
              d="M7.52925 3.7793C7.75652 3.55203 8.10803 3.52383 8.36616 3.69434L8.47065 3.7793L14.2207 9.5293C14.4804 9.789 14.4804 10.211 14.2207 10.4707L8.47065 16.2207C8.21095 16.4804 7.78895 16.4804 7.52925 16.2207C7.26955 15.961 7.26955 15.539 7.52925 15.2793L12.8085 10L7.52925 4.7207L7.44429 4.61621C7.27378 4.35808 7.30198 4.00657 7.52925 3.7793Z"
              fill="currentColor"
            />
          </svg>
        </button>
        <motion.div
          initial={false}
          animate={{
            height: isOpen ? elementHeightPx : 0,
            opacity: isOpen ? 1 : 0,
          }}
          transition={CODEX_MEASURED_TRANSITION}
          className={cn(isOpen ? "overflow-visible" : "overflow-hidden")}
          style={{
            pointerEvents: isOpen ? "auto" : "none",
          }}
        >
          <div ref={elementRef} className="flex flex-col gap-0.5" data-testid="multi-agent-action-rows">
            {rowText.map((row, index) => (
              <div key={`${index}:${row}`} className="min-w-0 truncate text-size-chat text-token-description-foreground/80">
                {row}
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
