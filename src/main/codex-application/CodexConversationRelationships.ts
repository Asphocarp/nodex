import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { DEFAULT_CODEX_HOST_ID } from "../../shared/codex-host";
import type {
  CodexConversationChildMembership,
  CodexConversationSnapshot,
} from "../../shared/types";
import type { ProjectWorkspaceReadSnapshot } from "../core-client/types";
import { CoreModules } from "../core-runtime/CoreModules";
import { CodexApplicationEventHub } from "./CodexApplicationEventHub";
import {
  extractCodexConversationRelationshipThreadIds,
  hasFriendlyCodexConversationRelationshipIdentity,
  projectCodexConversationRelationships,
  type CodexConversationRelationshipChild,
  type CodexConversationRelationshipThread,
} from "./CodexConversationRelationshipsProjection";
import { CodexThreadDirectory } from "./CodexThreadDirectory";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

const REPAIR_RETRY = "30 seconds";
const PAGE_SIZE = 200;

type CoreChildThread = Extract<
  ProjectWorkspaceReadSnapshot["value"],
  { readonly kind: "child_thread_window" }
>["threads"]["items"][number];

export class CodexConversationRelationshipsError extends Schema.TaggedError<CodexConversationRelationshipsError>()(
  "CodexConversationRelationshipsError",
  {
    threadId: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class CodexConversationRelationships extends Context.Service<
  CodexConversationRelationships,
  {
    /** Rebuilds and broadcasts one parent's derived relationship projection. */
    readonly refresh: (
      parentThreadId: string,
    ) => Effect.Effect<
      readonly CodexConversationChildMembership[],
      CodexConversationRelationshipsError
    >;
  }
>()("nodex/main/codex-application/CodexConversationRelationships") {}

const projectCoreChild = (thread: CoreChildThread): CodexConversationRelationshipThread => ({
  threadId: thread.thread_id,
  parentThreadId: thread.parent_thread_id ?? null,
  threadName: thread.thread_name ?? null,
  threadPreview: thread.thread_preview,
  modelProvider: thread.model_provider,
  agentNickname: thread.agent_nickname ?? null,
  agentRole: thread.agent_role ?? null,
  agentPath: thread.agent_path ?? null,
  statusType: thread.status.status_type,
  archived: thread.archived,
  createdAt: thread.created_at,
  updatedAt: thread.updated_at,
});

const projectSnapshotChild = (
  parentThreadId: string,
  conversation: CodexConversationSnapshot,
): CodexConversationRelationshipThread => ({
  threadId: conversation.threadId,
  parentThreadId: conversation.source?.parentThreadId ?? parentThreadId,
  threadName: conversation.threadName,
  threadPreview: conversation.threadPreview,
  modelProvider: conversation.modelProvider,
  agentNickname: conversation.agentNickname ?? null,
  agentRole: conversation.agentRole ?? null,
  agentPath: conversation.agentPath ?? null,
  statusType: conversation.statusType,
  archived: conversation.archived,
  createdAt: conversation.createdAt,
  updatedAt: conversation.updatedAt,
});

const provisionalChild = (
  parentThreadId: string,
  childThreadId: string,
): CodexConversationRelationshipThread => ({
  threadId: childThreadId,
  parentThreadId,
  threadName: null,
  threadPreview: "",
  modelProvider: "",
  agentNickname: null,
  agentRole: null,
  agentPath: null,
  statusType: "notLoaded",
  archived: false,
  createdAt: 0,
  updatedAt: 0,
});

export const make: Effect.Effect<
  CodexConversationRelationships["Service"],
  never,
  | CodexApplicationEventHub
  | CodexThreadDirectory
  | ConversationRuntimeMap
  | CoreModules
  | Scope.Scope
> = Effect.gen(function* () {
  const events = yield* CodexApplicationEventHub;
  const directory = yield* CodexThreadDirectory;
  const conversations = yield* ConversationRuntimeMap;
  const core = yield* CoreModules;
  const repairs = yield* FiberMap.make<string, void>();
  const runRepair = yield* FiberMap.runtime(repairs)();
  const repairKeysByChild = new Map<string, Set<string>>();
  const refreshes = yield* FiberMap.make<string, void>();
  const runRefresh = yield* FiberMap.runtime(refreshes)();
  const removedThreadIds = new Set<string>();

  const error = (threadId: string, cause: unknown): CodexConversationRelationshipsError =>
    new CodexConversationRelationshipsError({ threadId, cause });

  const readChildren = Effect.fn("CodexConversationRelationships.readChildren")(function* (
    parentThreadId: string,
  ): Effect.fn.Return<readonly CoreChildThread[], CodexConversationRelationshipsError> {
    const children: CoreChildThread[] = [];
    let after: string | null = null;
    do {
      const response: ProjectWorkspaceReadSnapshot = yield* core.workspace
        .read({
          kind: "child_thread_window",
          parent_thread_id: parentThreadId,
          include_archived: false,
          window: { after, first: PAGE_SIZE },
        })
        .pipe(Effect.mapError((cause) => error(parentThreadId, cause)));
      if (response.value.kind !== "child_thread_window") {
        return yield* error(
          parentThreadId,
          new Error("Core returned the wrong child Thread read variant"),
        );
      }
      children.push(...response.value.threads.items);
      after = response.value.threads.next_cursor ?? null;
    } while (after);
    return children;
  });

  const publish = (
    parentThreadId: string,
    memberships: readonly CodexConversationChildMembership[],
  ): void => {
    events.publish({
      kind: "hostMessage",
      value: {
        type: "sharedObjectUpdated",
        hostId: DEFAULT_CODEX_HOST_ID,
        object: {
          objectType: "conversationChildMemberships",
          objectId: parentThreadId,
          value: { parentThreadId, childMemberships: [...memberships] },
        },
      },
    });
  };

  let refreshPhysical: (
    parentThreadId: string,
  ) => Effect.Effect<
    readonly CodexConversationChildMembership[],
    CodexConversationRelationshipsError
  >;

  const repairOnce = Effect.fn("CodexConversationRelationships.repairOnce")(function* (
    parentThreadId: string,
    childThreadId: string,
    hostId: string,
  ): Effect.fn.Return<boolean> {
    const entry = yield* directory
      .resolve({ threadId: childThreadId, fidelity: "full", hostId })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not refresh Codex child Thread metadata").pipe(
            Effect.annotateLogs({ parentThreadId, childThreadId, cause }),
            Effect.as(null),
          ),
        ),
      );
    if (!entry) return false;
    const actualParentThreadId = entry.durable.parentThreadId;
    if (actualParentThreadId) {
      yield* refreshPhysical(actualParentThreadId).pipe(Effect.ignore);
    }
    if (actualParentThreadId !== parentThreadId) return true;
    return hasFriendlyCodexConversationRelationshipIdentity({
      threadId: entry.durable.threadId,
      parentThreadId: entry.durable.parentThreadId,
      threadName: entry.durable.threadName,
      threadPreview: entry.durable.threadPreview,
      modelProvider: entry.durable.modelProvider,
      agentNickname: entry.durable.agentNickname,
      agentRole: entry.durable.agentRole,
      agentPath: entry.durable.agentPath,
      statusType: entry.durable.statusType,
      archived: entry.durable.archived,
      createdAt: entry.durable.createdAt,
      updatedAt: entry.durable.updatedAt,
    });
  });

  const repairLoop = (
    parentThreadId: string,
    childThreadId: string,
    hostId: string,
  ): Effect.Effect<void> =>
    repairOnce(parentThreadId, childThreadId, hostId).pipe(
      Effect.flatMap((complete) =>
        complete
          ? Effect.void
          : Effect.sleep(REPAIR_RETRY).pipe(
              Effect.andThen(
                Effect.suspend(() => repairLoop(parentThreadId, childThreadId, hostId)),
              ),
            ),
      ),
    );

  refreshPhysical = Effect.fn("CodexConversationRelationships.refresh")(function* (
    rawParentThreadId: string,
  ): Effect.fn.Return<
    readonly CodexConversationChildMembership[],
    CodexConversationRelationshipsError
  > {
    const parentThreadId = rawParentThreadId.trim();
    if (!parentThreadId) return [];
    return yield* conversations.runExclusive(
      parentThreadId,
      Effect.gen(function* () {
        const parentAggregate = conversations.currentConversation(parentThreadId);
        if (!parentAggregate) return [];
        const parent = parentAggregate.readSnapshot();
        if (!parent) return [];
        const parentRecord = yield* core.workspace
          .read({ kind: "thread", thread_id: parentThreadId })
          .pipe(Effect.mapError((cause) => error(parentThreadId, cause)));
        if (parentRecord.value.kind !== "thread") return [];

        const canonicalChildThreadIds = extractCodexConversationRelationshipThreadIds(
          parentAggregate.readCanonicalState(),
        );
        const durableChildren = yield* readChildren(parentThreadId);
        const childrenById = new Map<string, CodexConversationRelationshipThread>(
          durableChildren.map((child) => [child.thread_id, projectCoreChild(child)]),
        );
        const childThreadIds = new Set([
          ...canonicalChildThreadIds,
          ...durableChildren.map((child) => child.thread_id),
        ]);
        const children: CodexConversationRelationshipChild[] = [];
        for (const childThreadId of childThreadIds) {
          if (removedThreadIds.has(childThreadId)) continue;
          const childConversation =
            conversations.currentConversation(childThreadId)?.readSnapshot() ?? null;
          const thread =
            childrenById.get(childThreadId) ??
            (childConversation
              ? projectSnapshotChild(parentThreadId, childConversation)
              : provisionalChild(parentThreadId, childThreadId));
          children.push({ thread, conversation: childConversation });
          if (!hasFriendlyCodexConversationRelationshipIdentity(thread)) {
            const key = JSON.stringify([parentThreadId, childThreadId]);
            if (FiberMap.hasUnsafe(repairs, key)) continue;
            let keys = repairKeysByChild.get(childThreadId);
            if (!keys) {
              keys = new Set();
              repairKeysByChild.set(childThreadId, keys);
            }
            keys.add(key);
            runRepair(
              key,
              repairLoop(
                parentThreadId,
                childThreadId,
                parentRecord.value.thread.execution_host_id,
              ).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    const current = repairKeysByChild.get(childThreadId);
                    current?.delete(key);
                    if (current?.size === 0) repairKeysByChild.delete(childThreadId);
                  }),
                ),
              ),
            );
          }
        }

        const memberships = projectCodexConversationRelationships({
          parent,
          canonicalChildThreadIds,
          children,
        });
        publish(parentThreadId, memberships);
        return memberships;
      }),
    );
  });

  yield* events.events.pipe(
    Stream.runForEach((event) => {
      if (event.kind !== "conversationRelationshipsInvalidated") return Effect.void;
      return Effect.gen(function* () {
        for (const threadId of event.value.removedThreadIds ?? []) {
          const normalized = threadId.trim();
          if (!normalized) continue;
          removedThreadIds.add(normalized);
          for (const key of repairKeysByChild.get(normalized) ?? []) {
            yield* FiberMap.remove(repairs, key);
          }
          repairKeysByChild.delete(normalized);
        }
        for (const threadId of event.value.restoredThreadIds ?? []) {
          removedThreadIds.delete(threadId.trim());
        }
        for (const rawParentThreadId of event.value.parentThreadIds) {
          const parentThreadId = rawParentThreadId.trim();
          if (!parentThreadId) continue;
          runRefresh(
            parentThreadId,
            refreshPhysical(parentThreadId).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Could not refresh Codex conversation relationships").pipe(
                  Effect.annotateLogs({ parentThreadId, cause }),
                ),
              ),
              Effect.asVoid,
            ),
          );
        }
      });
    }),
    Effect.forkScoped,
  );

  return CodexConversationRelationships.of({ refresh: refreshPhysical });
});
