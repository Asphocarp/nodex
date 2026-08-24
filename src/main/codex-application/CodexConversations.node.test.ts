import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { CodexCanonicalConversationState } from "../../shared/codex-conversation-state/codex-conversation-state";
import type { CodexConversationSnapshot } from "../../shared/types";
import { CodexConversations, live } from "./CodexConversations";
import {
  ConversationEntityMap,
  live as conversationEntityMapLive,
} from "./internal/ConversationEntityMap";

it.effect("projects private entity state into one immutable cross-subsystem capability", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(live.pipe(Layer.provideMerge(conversationEntityMapLive)));
      const conversations = Context.get(context, CodexConversations);
      const entities = Context.get(context, ConversationEntityMap);
      const entity = entities.entity("thread-a");
      entity.acceptCanonicalState({
        protocol: { name: "Canonical title", status: { type: "idle" } },
        turns: [
          { protocol: { id: "turn-old", status: "completed" }, items: [] },
          { protocol: { id: "turn-current", status: "inProgress" }, items: [] },
        ],
        requests: [],
        sidecar: { threadGoal: null },
      } as unknown as CodexCanonicalConversationState);
      entity.installSnapshot({
        threadId: "thread-a",
        threadName: "Projected title",
        statusType: "idle",
        statusActiveFlags: [],
        turns: [],
        requests: [],
        pendingSteers: [],
        queuedFollowUps: {
          status: "ready",
          ledgerRevision: 0,
          projectionRevision: 0,
          entries: [],
          inFlightFollowUpId: null,
          editingFollowUpId: null,
          error: null,
        },
      } as unknown as CodexConversationSnapshot);

      assert.strictEqual(conversations.latestTurnId("thread-a"), "turn-current");
      assert.deepEqual(conversations.activity("thread-a"), {
        active: true,
        label: "Canonical title",
        pending: false,
      });
      assert.strictEqual(conversations.read("thread-a")?.generation, entity.generation);

      yield* conversations.retire("thread-a");
      assert.isNull(conversations.read("thread-a"));
    }),
  ),
);
