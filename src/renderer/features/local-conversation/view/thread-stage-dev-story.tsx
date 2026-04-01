import { useEffect, useMemo, useRef, useState } from "react";
import { LocalConversationStageScreen } from "./local-conversation-stage-screen";
import {
  StorybookElectronTransportBoundary,
  THREAD_STAGE_STORY_PRESETS,
  buildStoryConversation,
  buildStoryConversationItem,
  buildStoryConversationTurn,
  buildThreadStageStoryModel,
  buildThreadStageStoryScenario,
  type ThreadStageStoryControls,
  type ThreadStageStoryRuntimeState,
} from "./thread-stage-story-fixtures";
import type { ThreadStageActions } from "../thread-stage-types";
import type {
  CodexAccountSnapshot,
  CodexApprovalDecision,
  CodexCollaborationModeKind,
  CodexConversationSnapshot,
  CodexMcpServerElicitationAction,
} from "@/lib/types";

export interface ThreadStageDevStoryPageProps extends ThreadStageStoryControls {
  renderPreview?: boolean;
}

function getNextTimestamp(conversation: CodexConversationSnapshot | null): number {
  if (!conversation) return 100_000;
  const itemTimes = conversation.turns.flatMap((turn) => turn.items.map((item) => item.updatedAt));
  const requestTimes = conversation.requests.map((request) => request.createdAt);
  return Math.max(conversation.updatedAt, 0, ...itemTimes, ...requestTimes) + 1_000;
}

function appendCompletedTurn(
  conversation: CodexConversationSnapshot,
  prompt: string,
  response: string,
): CodexConversationSnapshot {
  const createdAt = getNextTimestamp(conversation);
  const turnId = `turn_story_${conversation.turns.length + 1}`;
  const userItem = buildStoryConversationItem({
    threadId: conversation.threadId,
    turnId,
    itemId: `${turnId}_user`,
    type: "user_message",
    kind: "userMessage",
    semanticKind: "userMessage",
    role: "user",
    markdownText: prompt,
    createdAt,
    updatedAt: createdAt,
  });
  const assistantItem = buildStoryConversationItem({
    threadId: conversation.threadId,
    turnId,
    itemId: `${turnId}_assistant`,
    type: "assistant_message",
    kind: "assistantMessage",
    semanticKind: "assistantMessage",
    role: "assistant",
    assistantPhase: "final_answer",
    markdownText: response,
    createdAt: createdAt + 2_000,
    updatedAt: createdAt + 2_000,
  });

  return {
    ...conversation,
    statusType: "idle",
    statusActiveFlags: [],
    updatedAt: assistantItem.updatedAt,
    turns: [
      ...conversation.turns,
      buildStoryConversationTurn({
        threadId: conversation.threadId,
        turnId,
        status: "completed",
        items: [userItem, assistantItem],
      }),
    ],
    requests: [],
    pendingSteers: [],
  };
}

function appendStreamingTurn(
  conversation: CodexConversationSnapshot,
  prompt: string,
): CodexConversationSnapshot {
  const createdAt = getNextTimestamp(conversation);
  const turnId = `turn_story_${conversation.turns.length + 1}`;
  const userItem = buildStoryConversationItem({
    threadId: conversation.threadId,
    turnId,
    itemId: `${turnId}_user`,
    type: "user_message",
    kind: "userMessage",
    semanticKind: "userMessage",
    role: "user",
    markdownText: prompt,
    createdAt,
    updatedAt: createdAt,
  });
  const reasoningItem = buildStoryConversationItem({
    threadId: conversation.threadId,
    turnId,
    itemId: `${turnId}_reasoning`,
    type: "reasoning",
    kind: "reasoning",
    semanticKind: "reasoning",
    status: "inProgress",
    markdownText: "Turning the prompt into updated stage fixtures.",
    createdAt: createdAt + 1_000,
    updatedAt: createdAt + 1_000,
  });

  return {
    ...conversation,
    statusType: "active",
    statusActiveFlags: [],
    updatedAt: reasoningItem.updatedAt,
    turns: [
      ...conversation.turns,
      buildStoryConversationTurn({
        threadId: conversation.threadId,
        turnId,
        status: "inProgress",
        items: [userItem, reasoningItem],
      }),
    ],
  };
}

function updateConversationForThread(
  runtime: ThreadStageStoryRuntimeState,
  threadId: string,
  updater: (conversation: CodexConversationSnapshot) => CodexConversationSnapshot,
): ThreadStageStoryRuntimeState {
  const activeConversation = runtime.conversation?.threadId === threadId ? runtime.conversation : null;
  const knownConversation = runtime.knownConversationsById[threadId] ?? null;
  const currentConversation = activeConversation ?? knownConversation;
  if (!currentConversation) return runtime;

  const nextConversation = updater(currentConversation);
  const nextKnownConversationsById = {
    ...runtime.knownConversationsById,
    [threadId]: nextConversation,
  };

  return {
    ...runtime,
    conversation: activeConversation ? nextConversation : runtime.conversation,
    activeThreadSummary: runtime.activeThreadId === threadId ? nextConversation : runtime.activeThreadSummary,
    knownConversationsById: nextKnownConversationsById,
  };
}

function removeConversationRequest(
  runtime: ThreadStageStoryRuntimeState,
  requestId: string,
): ThreadStageStoryRuntimeState {
  const threadedRequestConversation = Object.values(runtime.knownConversationsById).find((conversation) =>
    conversation.requests.some((request) => request.requestId === requestId),
  );
  if (!threadedRequestConversation) return runtime;

  return updateConversationForThread(runtime, threadedRequestConversation.threadId, (conversation) => ({
    ...conversation,
    requests: conversation.requests.filter((request) => request.requestId !== requestId),
    statusType: conversation.turns.some((turn) => turn.status === "inProgress") ? "active" : "idle",
    statusActiveFlags: [],
    updatedAt: getNextTimestamp(conversation),
  }));
}

function updateUserMessage(
  conversation: CodexConversationSnapshot,
  turnId: string,
  message: string,
): CodexConversationSnapshot {
  const updatedTurns = conversation.turns.map((turn) => {
    if (turn.turnId !== turnId) return turn;
    const editableItemId = [...turn.items]
      .filter((item) => item.kind === "userMessage")
      .at(-1)?.itemId;
    if (!editableItemId) return turn;

    return {
      ...turn,
      items: turn.items.map((item) => {
        if (item.itemId !== editableItemId) return item;
        return {
          ...item,
          markdownText: message,
          updatedAt: getNextTimestamp(conversation),
        };
      }),
    };
  });

  return {
    ...conversation,
    updatedAt: getNextTimestamp(conversation),
    turns: updatedTurns,
  };
}

function interruptActiveTurn(conversation: CodexConversationSnapshot): CodexConversationSnapshot {
  const latestTurn = conversation.turns[conversation.turns.length - 1];
  if (!latestTurn || latestTurn.status !== "inProgress") return conversation;

  const nextTime = getNextTimestamp(conversation);
  const interruptedTurns = conversation.turns.map((turn) =>
    turn.turnId === latestTurn.turnId
      ? {
          ...turn,
          status: "interrupted" as const,
          items: [
            ...turn.items,
            buildStoryConversationItem({
              threadId: conversation.threadId,
              turnId: turn.turnId,
              itemId: `${turn.turnId}_assistant_final`,
              type: "assistant_message",
              kind: "assistantMessage",
              semanticKind: "assistantMessage",
              role: "assistant",
              assistantPhase: "final_answer",
              markdownText: "Stopped the turn after reaching the current preview checkpoint.",
              createdAt: nextTime,
              updatedAt: nextTime,
            }),
          ],
        }
      : turn,
  );

  return {
    ...conversation,
    statusType: "idle",
    statusActiveFlags: [],
    updatedAt: nextTime,
    turns: interruptedTurns,
    requests: [],
  };
}

function setStoryLog(runtime: ThreadStageStoryRuntimeState, message: string): ThreadStageStoryRuntimeState {
  return {
    ...runtime,
    logs: [message, ...runtime.logs].slice(0, 4),
  };
}

function autoSetTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  textarea.value = value;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

export function ThreadStageDevStoryPage({
  preset,
  permissionMode,
  authenticatedAccount,
  isQueueingEnabled,
  collapseAgentBody,
  renderPreview = true,
}: ThreadStageDevStoryPageProps) {
  const scenario = useMemo(() => buildThreadStageStoryScenario({
    preset,
    permissionMode,
    authenticatedAccount,
    isQueueingEnabled,
    collapseAgentBody,
  }), [
    authenticatedAccount,
    collapseAgentBody,
    isQueueingEnabled,
    permissionMode,
    preset,
  ]);
  const [runtime, setRuntime] = useState<ThreadStageStoryRuntimeState>(scenario.runtime);
  const previewRef = useRef<HTMLDivElement>(null);
  const lastAutoActionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setRuntime(scenario.runtime);
  }, [scenario]);

  const model = useMemo(
    () => buildThreadStageStoryModel(scenario, {
      preset,
      permissionMode,
      authenticatedAccount,
      isQueueingEnabled,
      collapseAgentBody,
    }, runtime),
    [
      authenticatedAccount,
      collapseAgentBody,
      isQueueingEnabled,
      permissionMode,
      preset,
      runtime,
      scenario,
    ],
  );

  const actions = useMemo<ThreadStageActions>(() => ({
    onCollaborationModeChange: () => {},
    onModelChange: () => {},
    onReasoningEffortChange: () => {},
    onPermissionModeChange: () => {},
    onQueueingEnabledChange: () => {},
    onRefreshAccount: async (): Promise<CodexAccountSnapshot> => (
      authenticatedAccount
        ? {
            account: {
              type: "chatgpt",
              email: "asc@example.com",
              planType: "Pro",
            },
            requiresOpenAiAuth: false,
            pendingLogin: null,
            rateLimits: null,
          }
        : {
            account: null,
            requiresOpenAiAuth: true,
            pendingLogin: null,
            rateLimits: null,
          }
    ),
    onStartChatGptLogin: async () => ({ type: "chatgpt", loginId: "storybook-login", authUrl: "https://example.com" }),
    onStartApiKeyLogin: async () => ({ type: "apiKey" }),
    onCancelLogin: async () => {},
    onLogout: async () => {},
    onStartThreadForCard: async ({ prompt }) => {
      setRuntime((current) => {
        const threadId = "thread_story_started";
        const nextConversation = appendStreamingTurn(buildStoryConversation({
          threadId,
          cardId: current.newThreadTarget?.cardId ?? "card-story-new-thread",
          projectId: current.newThreadTarget?.projectId ?? "project-story-new-thread",
          cwd: "/workspace/nodex",
          threadName: "Storybook new thread",
          threadPreview: prompt,
        }), prompt);
        return setStoryLog({
          ...current,
          isNewThreadTab: false,
          newThreadTarget: null,
          activeThreadId: threadId,
          activeThreadSummary: nextConversation,
          conversation: nextConversation,
          knownConversationsById: { [threadId]: nextConversation },
        }, `Started a new story thread from the composer: ${prompt}`);
      });
    },
    onSendPrompt: async (prompt: string, opts?: { collaborationMode?: CodexCollaborationModeKind }) => {
      setRuntime((current) => {
        if (!current.conversation) return current;
        return setStoryLog({
          ...updateConversationForThread(current, current.conversation.threadId, (conversation) => appendStreamingTurn(conversation, prompt)),
          composerIntent: opts?.collaborationMode
            ? {
                prompt: `Follow-up sent in ${opts.collaborationMode} mode`,
                focusNonce: Date.now(),
              }
            : null,
        }, `Sent a follow-up prompt: ${prompt}`);
      });
    },
    onSteerPrompt: async (turnId: string, prompt: string) => {
      setRuntime((current) => {
        if (!current.conversation) return current;
        return setStoryLog(updateConversationForThread(current, current.conversation.threadId, (conversation) => ({
          ...conversation,
          pendingSteers: [
            ...conversation.pendingSteers,
            {
              steerId: `steer_${Date.now()}`,
              threadId: conversation.threadId,
              turnId,
              prompt,
              createdAt: getNextTimestamp(conversation),
            },
          ],
          updatedAt: getNextTimestamp(conversation),
        })), `Queued a steer for ${turnId}: ${prompt}`);
      });
    },
    onInterruptTurn: async () => {
      setRuntime((current) => {
        if (!current.conversation) return current;
        return setStoryLog(updateConversationForThread(current, current.conversation.threadId, interruptActiveTurn), "Interrupted the active story turn.");
      });
    },
    onRespondApproval: async (requestId: string, decision: CodexApprovalDecision) => {
      setRuntime((current) => setStoryLog(removeConversationRequest(current, requestId), `Approval response: ${decision}`));
    },
    onRespondUserInput: async (requestId: string, answers: Record<string, string[]>) => {
      setRuntime((current) => {
        const nextRuntime = removeConversationRequest(current, requestId);
        return setStoryLog(nextRuntime, `Answered user input: ${Object.values(answers).flat().join(", ")}`);
      });
    },
    onRespondMcpElicitation: async (requestId: string, action: CodexMcpServerElicitationAction) => {
      setRuntime((current) => setStoryLog(removeConversationRequest(current, requestId), `MCP elicitation: ${action}`));
    },
    onResolvePlanImplementationRequest: (threadId: string, turnId: string) => {
      setRuntime((current) => ({
        ...current,
        dismissedPlanImplementationTurnIdByThread: {
          ...current.dismissedPlanImplementationTurnIdByThread,
          [threadId]: turnId,
        },
      }));
    },
    onEnqueueQueuedFollowUp: async (threadId: string, prompt: string) => {
      setRuntime((current) => {
        const nextRuntime = updateConversationForThread(current, threadId, (conversation) => ({
          ...conversation,
          queuedFollowUps: [
            ...conversation.queuedFollowUps,
            {
              followUpId: `followup_${Date.now()}`,
              threadId,
              prompt,
              createdAt: getNextTimestamp(conversation),
              collaborationMode: null,
              pausedReason: null,
            },
          ],
          updatedAt: getNextTimestamp(conversation),
        }));
        return setStoryLog(nextRuntime, `Queued follow-up: ${prompt}`);
      });
    },
    onRemoveQueuedFollowUp: async (threadId: string, followUpId: string) => {
      setRuntime((current) => {
        const nextRuntime = updateConversationForThread(current, threadId, (conversation) => ({
          ...conversation,
          queuedFollowUps: conversation.queuedFollowUps.filter((followUp) => followUp.followUpId !== followUpId),
          updatedAt: getNextTimestamp(conversation),
        }));
        return setStoryLog(nextRuntime, `Removed queued follow-up: ${followUpId}`);
      });
    },
    onReorderQueuedFollowUps: async (threadId: string, orderedFollowUpIds: string[]) => {
      setRuntime((current) => {
        const nextRuntime = updateConversationForThread(current, threadId, (conversation) => {
          const byId = new Map(conversation.queuedFollowUps.map((followUp) => [followUp.followUpId, followUp]));
          const ordered = orderedFollowUpIds
            .map((followUpId) => byId.get(followUpId) ?? null)
            .filter((followUp): followUp is (typeof conversation.queuedFollowUps)[number] => followUp !== null);
          const seen = new Set(ordered.map((followUp) => followUp.followUpId));
          return {
            ...conversation,
            queuedFollowUps: [...ordered, ...conversation.queuedFollowUps.filter((followUp) => !seen.has(followUp.followUpId))],
            updatedAt: getNextTimestamp(conversation),
          };
        });
        return setStoryLog(nextRuntime, `Reordered queued follow-ups: ${orderedFollowUpIds.join(", ")}`);
      });
    },
    onSendQueuedFollowUpNow: async (threadId: string, followUpId: string) => {
      setRuntime((current) => {
        const conversation = current.knownConversationsById[threadId];
        const queued = conversation?.queuedFollowUps.find((followUp) => followUp.followUpId === followUpId) ?? null;
        if (!conversation || !queued) return current;

        const nextRuntime = updateConversationForThread(current, threadId, (activeConversation) =>
          appendCompletedTurn({
            ...activeConversation,
            queuedFollowUps: activeConversation.queuedFollowUps.filter((followUp) => followUp.followUpId !== followUpId),
            updatedAt: getNextTimestamp(activeConversation),
          }, queued.prompt, "Queued follow-up sent now inside the story fixture."),
        );
        return setStoryLog(nextRuntime, `Sent queued follow-up now: ${queued.prompt}`);
      });
    },
    onEditQueuedFollowUp: async ({ threadId, followUpId, prompt }) => {
      setRuntime((current) => {
        const nextRuntime = updateConversationForThread(current, threadId, (conversation) => ({
          ...conversation,
          queuedFollowUps: conversation.queuedFollowUps.filter((followUp) => followUp.followUpId !== followUpId),
          updatedAt: getNextTimestamp(conversation),
        }));
        return {
          ...setStoryLog(nextRuntime, `Editing queued follow-up: ${prompt}`),
          composerIntent: {
            prompt,
            focusNonce: Date.now(),
          },
        };
      });
    },
    onEditLastUserTurn: async ({ threadId, turnId, message }) => {
      if (scenario.autoAction === "submitEditFailure") {
        throw new Error("Edit failed");
      }

      setRuntime((current) => {
        const nextRuntime = updateConversationForThread(current, threadId, (conversation) =>
          updateUserMessage(conversation, turnId, message),
        );
        return setStoryLog(nextRuntime, `Edited the latest user message in ${turnId}.`);
      });
    },
    onForkFromTurn: async ({ threadId, turnId, message }) => {
      setRuntime((current) => setStoryLog(current, `Forked from ${turnId}: ${message}`));
      if (threadId === model.conversation?.threadId) {
        setRuntime((current) => ({
          ...current,
          composerIntent: {
            prompt: `Forked from ${turnId}`,
            focusNonce: Date.now(),
          },
        }));
      }
    },
    onOpenTurnDiffReview: (target) => {
      setRuntime((current) => setStoryLog(current, `Opened diff review for ${target.turnId}.`));
    },
    onConsumeComposerIntent: (threadId: string, focusNonce: number) => {
      setRuntime((current) => {
        if (current.composerIntent?.focusNonce !== focusNonce || current.activeThreadId !== threadId) return current;
        return {
          ...current,
          composerIntent: null,
        };
      });
    },
    onOpenThread: () => {},
    onCleanBackgroundTerminals: async () => {},
    onOpenCard: () => {},
  }), [authenticatedAccount, model.conversation?.threadId, scenario.autoAction]);

  useEffect(() => {
    if (!scenario.autoAction || !renderPreview) return;

    const autoActionKey = `${scenario.preset.id}:${scenario.autoAction}`;
    if (lastAutoActionKeyRef.current === autoActionKey) return;
    lastAutoActionKeyRef.current = autoActionKey;

    const runAutoAction = () => {
      const root = previewRef.current;
      if (!root) return;

      if (scenario.autoAction === "openEdit") {
        (root.querySelector('[aria-label="Edit message"]') as HTMLButtonElement | null)?.click();
        return;
      }

      if (scenario.autoAction === "submitEditFailure") {
        (root.querySelector('[aria-label="Edit message"]') as HTMLButtonElement | null)?.click();
        requestAnimationFrame(() => {
          const textarea = root.querySelector('textarea[aria-label="Edit message"]') as HTMLTextAreaElement | null;
          const sendButton = [...root.querySelectorAll("button")].find((element) => element.textContent?.trim() === "Send") as HTMLButtonElement | undefined;
          if (!textarea || !sendButton) return;
          autoSetTextareaValue(textarea, "Trigger the edit failure preview.");
          sendButton.click();
        });
        return;
      }

      if (scenario.autoAction === "openOlderFork") {
        (root.querySelector('[aria-label="Fork from this message"]') as HTMLButtonElement | null)?.click();
        return;
      }

      if (scenario.autoAction === "triggerLatestFork") {
        (root.querySelector('[aria-label="Fork from this message"]') as HTMLButtonElement | null)?.click();
      }
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(runAutoAction);
    });
  }, [renderPreview, scenario]);

  return (
    <div className="min-h-[calc(100vh-3rem)] bg-[linear-gradient(180deg,var(--background),color-mix(in_srgb,var(--background),var(--background-secondary)_42%))] text-(--foreground)">
      <div className="mx-auto flex w-full max-w-[1420px] flex-col gap-4">
        <section className="rounded-[24px] border border-(--border) bg-[color-mix(in_srgb,var(--background-secondary),transparent_10%)] px-5 py-4 shadow-[0_16px_40px_rgba(0,0,0,0.18)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="text-sm font-semibold">{scenario.preset.name}</div>
              <div className="mt-1 text-sm/relaxed text-(--foreground-secondary)">
                {scenario.preset.description}
              </div>
            </div>
            <div className="flex max-w-lg flex-wrap justify-end gap-2">
              <span className="rounded-full border border-(--border) bg-(--background) px-2.5 py-1 text-xs text-(--foreground-secondary)">
                {permissionMode}
              </span>
              <span className="rounded-full border border-(--border) bg-(--background) px-2.5 py-1 text-xs text-(--foreground-secondary)">
                {authenticatedAccount ? "authenticated" : "signed out"}
              </span>
              <span className="rounded-full border border-(--border) bg-(--background) px-2.5 py-1 text-xs text-(--foreground-secondary)">
                {collapseAgentBody ? "agent body collapsed" : "agent body expanded"}
              </span>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full border border-(--border) bg-(--background) px-2.5 py-1 text-xs text-(--foreground-secondary)">
              real `buildThreadStageModel(...)`
            </span>
            <span className="rounded-full border border-(--border) bg-(--background) px-2.5 py-1 text-xs text-(--foreground-secondary)">
              fake Electron bridge
            </span>
            <span className="rounded-full border border-(--border) bg-(--background) px-2.5 py-1 text-xs text-(--foreground-secondary)">
              {THREAD_STAGE_STORY_PRESETS.length} stage presets
            </span>
          </div>
          {runtime.logs.length > 0 ? (
            <div className="mt-3 flex flex-col gap-1.5 rounded-2xl border border-[color-mix(in_srgb,var(--border)_78%,transparent)] bg-token-input-background/60 px-3 py-2.5">
              <div className="text-[11px] font-medium tracking-wide text-(--foreground-tertiary) uppercase">Story actions</div>
              {runtime.logs.map((entry) => (
                <div key={entry} className="text-sm text-(--foreground-secondary)">
                  {entry}
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="overflow-hidden rounded-[20px] border border-(--border) bg-(--background) shadow-[0_24px_64px_rgba(0,0,0,0.28)]">
          {renderPreview ? (
            <StorybookElectronTransportBoundary
              card={scenario.transportCard}
              permissionDescription={scenario.permissionDescription}
            >
              <div ref={previewRef} className="min-h-[760px]">
                <LocalConversationStageScreen
                  model={model}
                  actions={actions}
                  initialUiState={scenario.initialUiState}
                />
              </div>
            </StorybookElectronTransportBoundary>
          ) : (
            <div className="flex min-h-[420px] items-center justify-center px-6 text-sm text-(--foreground-secondary)">
              Preview disabled for tests.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
