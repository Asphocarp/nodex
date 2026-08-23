import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import {
  resolveCodexForkChildThreadTitleFromCatalog,
  resolveCodexForkSourceConversationTitle,
  type CodexForkTitleThread,
} from "../../shared/codex-thread-title";
import type { CodexCanonicalConversationState } from "../../shared/types";
import type { ProjectWorkspaceReadSnapshot } from "../core-client/types";
import { CoreModules } from "../core-runtime/CoreModules";

export interface CodexForkTitleSource {
  readonly threadId: string;
  readonly projectId: string | null;
  readonly forkedFromId: string | null;
  readonly threadName: string | null;
  readonly canonical: CodexCanonicalConversationState;
  readonly pendingForks?: readonly CodexForkTitleThread[];
}

export interface CodexForkTitles {
  readonly sourceTitle: string | null;
  readonly childTitle: string | null;
}

export class CodexForkTitlePolicyError extends Data.TaggedError("CodexForkTitlePolicyError")<{
  readonly threadId: string;
  readonly cause: unknown;
}> {}

export class CodexForkTitlePolicy extends Context.Service<
  CodexForkTitlePolicy,
  {
    readonly derive: (
      source: CodexForkTitleSource,
    ) => Effect.Effect<CodexForkTitles, CodexForkTitlePolicyError>;
  }
>()("nodex/main/codex-application/CodexForkTitlePolicy") {}

/** Derives one fork title against durable and pending siblings from the same source lineage. */
export const make: Effect.Effect<CodexForkTitlePolicy["Service"], never, CoreModules> = Effect.gen(
  function* () {
    const core = yield* CoreModules;

    const derive = Effect.fn("CodexForkTitlePolicy.derive")(function* (
      source: CodexForkTitleSource,
    ) {
      const known: CodexForkTitleThread[] = [];
      const seenCursors = new Set<string>();
      let after: string | null = null;
      do {
        const response: ProjectWorkspaceReadSnapshot = yield* core.workspace
          .read({
            kind: "task_window",
            project_id: source.projectId,
            include_archived: false,
            window: { after, first: 200 },
          })
          .pipe(
            Effect.mapError(
              (cause) => new CodexForkTitlePolicyError({ threadId: source.threadId, cause }),
            ),
          );
        if (response.value.kind !== "task_window") {
          return yield* new CodexForkTitlePolicyError({
            threadId: source.threadId,
            cause: new Error(
              "Core returned a non-task-window read variant for fork title derivation",
            ),
          });
        }
        for (const task of response.value.tasks.items) {
          if (!task.thread) continue;
          known.push({
            conversationId: task.thread.thread_id,
            forkedFromId: task.thread.forked_from_id ?? null,
            title: task.thread.thread_name ?? null,
          });
        }
        const next: string | null = response.value.tasks.next_cursor ?? null;
        if (!next || seenCursors.has(next)) break;
        seenCursors.add(next);
        after = next;
      } while (after);

      return {
        sourceTitle: resolveCodexForkSourceConversationTitle({
          explicitTitle: source.threadName,
          firstTurnInput: source.canonical.turns[0]?.sidecar.params?.input,
          firstTurnCommentAttachments:
            source.canonical.turns[0]?.sidecar.params?.commentAttachments,
        }),
        childTitle: resolveCodexForkChildThreadTitleFromCatalog({
          source: {
            conversationId: source.threadId,
            forkedFromId: source.forkedFromId,
            title: source.threadName,
          },
          storedThreads: known,
          activeThreads: [],
          pendingForks: source.pendingForks ?? [],
        }),
      };
    });

    return CodexForkTitlePolicy.of({ derive });
  },
);
