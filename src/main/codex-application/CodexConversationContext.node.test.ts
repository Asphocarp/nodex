import * as Effect from "effect/Effect";
import { assert, it } from "@effect/vitest";
import type {
  CodexCanonicalConversationState,
  CodexConversationSnapshot,
} from "../../shared/types";
import { CoreModuleResponseError } from "../core-client/core-client";
import { CoreModules, type CoreModuleClients } from "../core-runtime/CoreModules";
import { CoreRuntimeError } from "../core-runtime/CoreRuntimeError";
import { make as makeConversationContext } from "./CodexConversationContext";
import type { CodexConversationAggregate } from "./CodexConversationAggregate";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

const notFound = (kind: string) =>
  new CoreRuntimeError({
    message: `Missing ${kind}`,
    operation: `workspace:${kind}`,
    reason: "operation",
    retryable: false,
    cause: new CoreModuleResponseError({
      code: "not_found",
      message: `Missing ${kind}`,
      retryable: false,
      recovery: { kind: "none" },
    }),
  });

it.effect(
  "inherits ephemeral Side Chat lineage and execution context from the live aggregate",
  () =>
    Effect.gen(function* () {
      const childSnapshot = {
        threadId: "side-chat",
        ephemeral: true,
        projectId: "project-a",
        cwd: "/repo/side-chat",
        source: { parentThreadId: "parent-thread" },
      } as unknown as CodexConversationSnapshot;
      const childCanonical = {
        sidecar: {
          hydrationContext: {
            cwd: "/repo/side-chat",
            currentPermissions: { runtimeWorkspaceRoots: ["/repo/side-chat"] },
          },
        },
      } as unknown as CodexCanonicalConversationState;
      const aggregate = (
        snapshot: CodexConversationSnapshot,
        canonical: CodexCanonicalConversationState,
      ) =>
        ({
          readSnapshot: () => snapshot,
          readCanonicalState: () => canonical,
        }) as unknown as CodexConversationAggregate;
      const conversations = ConversationRuntimeMap.of({
        currentConversation: (threadId: string) =>
          threadId === "side-chat"
            ? aggregate(childSnapshot, childCanonical)
            : threadId === "parent-thread"
              ? aggregate(
                  {
                    threadId,
                    ephemeral: false,
                    projectId: "project-a",
                    source: { parentThreadId: null },
                  } as unknown as CodexConversationSnapshot,
                  {} as CodexCanonicalConversationState,
                )
              : null,
      } as unknown as ConversationRuntimeMap["Service"]);
      const workspace: CoreModuleClients["workspace"] = {
        read: (read) => {
          if (read.kind === "thread" && read.thread_id === "parent-thread") {
            return Effect.succeed({
              value: {
                kind: "thread",
                thread: {
                  thread_id: "parent-thread",
                  project_id: "project-a",
                  parent_thread_id: null,
                  cwd: "/repo/parent",
                },
              },
            } as never);
          }
          return Effect.fail(notFound(read.kind));
        },
        apply: () => Effect.die("unused"),
      };
      const context = yield* makeConversationContext.pipe(
        Effect.provideService(ConversationRuntimeMap, conversations),
        Effect.provideService(
          CoreModules,
          CoreModules.of({ workspace } as unknown as CoreModuleClients),
        ),
      );

      assert.deepEqual(yield* context.read("side-chat"), {
        threadId: "side-chat",
        parentThreadId: "parent-thread",
        rootThreadId: "parent-thread",
        projectId: "project-a",
        cwd: "/repo/side-chat",
        writableRoots: ["/repo/side-chat"],
      });
    }),
);
