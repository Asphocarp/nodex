import type { Thread, ThreadGoal } from "@nodex/codex-app-server-protocol/v2";
import { assert, it } from "@effect/vitest";
import type { CodexConversationSnapshot } from "../../../shared/types";
import { CODEX_PENDING_MANUAL_CONTEXT_COMPACTION_ITEM_ID } from "../../../shared/codex-conversation-state/codex-conversation-reducer";
import { createCodexCanonicalConversationState } from "../../../shared/codex-conversation-state/codex-conversation-state";
import { createCodexQueuedFollowUp } from "../../../shared/codex-queued-follow-up-state";
import { makeConversationEntityStateRegistry } from "./ConversationEntityState";

const threadId = "thread-canonical-projection";

const thread: Thread = {
  id: threadId,
  extra: null,
  sessionId: "session-canonical-projection",
  forkedFromId: null,
  parentThreadId: null,
  preview: "Canonical projection fixture",
  ephemeral: false,
  section: null,
  sectionEnteredAt: null,
  historyMode: "paginated",
  modelProvider: "openai",
  createdAt: 1,
  updatedAt: 2,
  recencyAt: 2,
  status: { type: "idle" },
  path: null,
  cwd: "/workspace/project",
  cliVersion: "fixture",
  source: "unknown",
  canAcceptDirectInput: true,
  threadSource: null,
  agentNickname: null,
  agentRole: null,
  gitInfo: null,
  name: "Initial title",
  turns: [],
};

const snapshot = (): CodexConversationSnapshot =>
  ({
    threadId,
    threadName: "Initial title",
    threadPreview: thread.preview,
    cwd: thread.cwd,
    modelProvider: thread.modelProvider,
    resumeState: "resumed",
    turns: [],
    requests: [],
    queuedFollowUps: {
      status: "ready",
      ledgerRevision: 0,
      projectionRevision: 0,
      entries: [],
      inFlightFollowUpId: null,
      editingFollowUpId: null,
      error: null,
    },
    pendingSteers: [],
  }) as unknown as CodexConversationSnapshot;

const goal: ThreadGoal = {
  threadId,
  objective: "Finish the canonical application kernel",
  status: "active",
  tokenBudget: null,
  tokensUsed: 0,
  timeUsedSeconds: 0,
  createdAt: 1,
  updatedAt: 2,
};

it("projects semantic canonical mutations into both the snapshot and dormant replica", () => {
  const aggregate = makeConversationEntityStateRegistry().acquire(threadId);
  aggregate.acceptCanonicalState(
    createCodexCanonicalConversationState(thread, { turnParamsById: {} }),
  );
  aggregate.acceptReplica({ conversation: snapshot(), revision: 1, ownerEpoch: 0 });

  assert.isTrue(
    aggregate.renameThread({ name: "Canonical title", observedAtMs: 1_000, projectReplica: true }),
  );
  assert.isTrue(
    aggregate.acceptThreadGoal({
      goal,
      appendTranscriptItem: true,
      dismissResumeConfirmation: true,
      projectReplica: true,
    }),
  );
  aggregate.admitManualCompaction({ observedAtMs: 3_000, projectReplica: true });

  const current = aggregate.readSnapshot();
  const replica = aggregate.read().acceptedReplica?.conversation ?? null;
  for (const projected of [current, replica]) {
    assert.strictEqual(projected?.threadName, "Canonical title");
    assert.strictEqual(projected?.threadGoal, goal);
    assert.isTrue(
      projected?.turns.some((turn) =>
        turn.items.some((item) => item.itemId === CODEX_PENDING_MANUAL_CONTEXT_COMPACTION_ITEM_ID),
      ),
    );
  }
  const goalInput = aggregate.readCanonicalState()?.turns[0]?.sidecar.params.input[0];
  assert.strictEqual(goalInput?.type === "text" ? goalInput.text : null, `/goal ${goal.objective}`);
  assert.strictEqual(aggregate.read().revision, 4);

  assert.isTrue(aggregate.rollbackManualCompaction({ observedAtMs: 4_000, projectReplica: true }));
  assert.strictEqual(aggregate.readSnapshot()?.turns.length, 1);
  assert.strictEqual(aggregate.read().acceptedReplica?.conversation.turns.length, 1);
});

it("invalidates generation-bound renderer checkpoints when the endpoint is lost", () => {
  const registry = makeConversationEntityStateRegistry();
  const aggregate = registry.acquire(threadId);
  aggregate.installSnapshot(snapshot());
  aggregate.acceptReplica({ conversation: snapshot(), revision: 4, ownerEpoch: 2 });
  aggregate.setStreamRole("owner");
  aggregate.setStreaming(true);

  assert.deepEqual(registry.markAllNeedsResume(), [threadId]);
  const state = aggregate.read();
  assert.strictEqual(state.resumeState, "needs_resume");
  assert.strictEqual(state.streamRole, null);
  assert.isFalse(state.isStreaming);
  assert.strictEqual(state.acceptedReplica, null);
  assert.strictEqual(state.revision, 0);
  assert.strictEqual(state.checkpoint, null);
  assert.strictEqual(aggregate.readSnapshot()?.resumeState, "needs_resume");
});

it("installs exact Main queue projections without trusting the renderer replica", () => {
  const aggregate = makeConversationEntityStateRegistry().acquire(threadId);
  aggregate.acceptReplica({ conversation: snapshot(), revision: 4, ownerEpoch: 2 });
  const row = createCodexQueuedFollowUp({
    followUpId: "follow-up-1",
    clientUserMessageId: "client-follow-up-1",
    threadId,
    prompt: "Preserve the exact projection.",
    createdAtMs: 5,
  });
  const projection = {
    status: "error" as const,
    ledgerRevision: 9,
    projectionRevision: 12,
    entries: [row],
    inFlightFollowUpId: row.followUpId,
    editingFollowUpId: row.followUpId,
    error: "Awaiting retry",
  };

  assert.isTrue(aggregate.installQueuedFollowUpProjection(projection, true));
  assert.deepEqual(aggregate.readQueuedFollowUpProjection(), projection);
  assert.deepEqual(aggregate.readSnapshot()?.queuedFollowUps, projection);
  assert.deepEqual(aggregate.read().acceptedReplica?.conversation.queuedFollowUps, projection);
  assert.strictEqual(aggregate.read().revision, 5);
  assert.isFalse(aggregate.installQueuedFollowUpProjection(projection, true));

  aggregate.acceptReplica({
    conversation: {
      ...snapshot(),
      queuedFollowUps: {
        status: "ready",
        ledgerRevision: 99,
        projectionRevision: 99,
        entries: [],
        inFlightFollowUpId: null,
        editingFollowUpId: null,
        error: null,
      },
    },
    revision: 6,
    ownerEpoch: 2,
  });
  assert.deepEqual(aggregate.read().acceptedReplica?.conversation.queuedFollowUps, projection);
});
