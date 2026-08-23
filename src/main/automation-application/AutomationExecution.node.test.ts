import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { describe, expect, test } from "vite-plus/test";
import type { CodexTranscriptEntry } from "../../shared/types";
import { testLayer as mainConfigLayer } from "../app/MainConfig";
import { AgentProviderRuntime } from "../codex-application/AgentProviderRuntime";
import { CodexApplicationEventHub } from "../codex-application/CodexApplicationEventHub";
import { CodexGitProbe } from "../codex-application/CodexGitProbe";
import { CodexHeartbeatTurnCompletion } from "../codex-application/CodexHeartbeatTurnCompletion";
import { CodexPermissions } from "../codex-application/CodexPermissions";
import { CodexRendererConversationRegistry } from "../codex-application/CodexRendererConversationRegistry";
import { CodexThreadDirectory } from "../codex-application/CodexThreadDirectory";
import { CodexThreadSettingsRuntime } from "../codex-application/CodexThreadSettingsRuntime";
import { CodexThreadTitlePersistence } from "../codex-application/CodexThreadTitlePersistence";
import { CodexTurnAuthority } from "../codex-application/CodexTurnAuthority";
import { CodexTurnCommands } from "../codex-application/CodexTurnCommands";
import { ComposerCatalog } from "../codex-application/ComposerCatalog";
import { ConversationRuntimeMap } from "../codex-application/ConversationRuntimeMap";
import { ExecutionHostRuntime } from "../codex-application/ExecutionHostRuntime";
import { ManagedWorktreeRetentionRuntime } from "../codex-application/ManagedWorktreeRetentionRuntime";
import { ManagedWorktreeRuntime } from "../codex-application/ManagedWorktreeRuntime";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { DesktopToolRuntime } from "../host-runtime/DesktopToolRuntime";
import { ProjectWorkspace } from "../project-application/ProjectWorkspace";
import { AutomationApplication } from "./AutomationApplication";
import {
  AutomationExecution,
  live,
  resolveAutomationArchiveMessagesFromTranscript,
} from "./AutomationExecution";

const entry = (
  itemId: string,
  kind: "userMessage" | "assistantMessage",
  input: Partial<CodexTranscriptEntry>,
): CodexTranscriptEntry =>
  ({
    threadId: "thread-automation",
    turnId: "turn-automation",
    itemId,
    type: kind,
    kind,
    source: "live",
    createdAt: 1,
    ...input,
  }) as CodexTranscriptEntry;

describe("Automation archive projection", () => {
  test("captures the latest semantic exchange and removes app-only directives", () => {
    const messages = resolveAutomationArchiveMessagesFromTranscript([
      entry("user-old", "userMessage", { markdownText: "old request" }),
      entry("assistant-old", "assistantMessage", { markdownText: "old response" }),
      entry("user-latest", "userMessage", {
        markdownText: "fallback text",
        rawItem: {
          content: [
            { type: "text", text: "latest request" },
            { type: "skill", name: "research", path: "/skills/research" },
          ],
        },
      }),
      entry("assistant-latest", "assistantMessage", {
        markdownText: "latest response\n::automation-result{status=complete}",
      }),
    ]);

    expect(messages).toEqual({
      archivedUserMessage: "latest request\nskill: research (/skills/research)",
      archivedAssistantMessage: "latest response",
    });
  });
});

it.effect("run-now enters the scoped execution capability after runtime readiness", () =>
  Effect.gen(function* () {
    let gatewayReady = 0;
    let providerReady = 0;
    const scope = yield* Scope.make();
    const definition = {
      id: "automation-run-now",
      definitionRevision: 1,
      kind: "cron",
      status: "ACTIVE",
      targetThreadId: null,
      name: "Run now",
      prompt: "Run.",
      rrule: "FREQ=DAILY",
      model: null,
      modelProvider: null,
      harnessId: null,
      reasoningEffort: null,
      serviceTier: null,
      cwds: [],
      executionEnvironment: "local",
      localEnvironmentConfigPath: null,
      nextRunAt: null,
      lastRunAt: null,
      createdAt: 1,
      updatedAt: 1,
    } as const;
    const context = yield* Layer.buildWithScope(
      live({ runtimeStateHome: "/tmp/nodex-test", runtimeVersion: "test" }).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(AgentProviderRuntime, {
              ensureRuntimeReady: Effect.sync(() => {
                providerReady += 1;
              }),
            } as unknown as AgentProviderRuntime["Service"]),
            Layer.succeed(AutomationApplication, {
              definitions: { get: () => Effect.succeed(definition) },
            } as unknown as AutomationApplication["Service"]),
            Layer.succeed(CodexApplicationEventHub, {} as CodexApplicationEventHub["Service"]),
            Layer.succeed(CodexGateway, {
              localHostId: "local",
              awaitReady: () =>
                Effect.sync(() => {
                  gatewayReady += 1;
                }),
            } as unknown as CodexGateway["Service"]),
            Layer.succeed(CodexGitProbe, {} as CodexGitProbe["Service"]),
            Layer.succeed(
              CodexHeartbeatTurnCompletion,
              {} as CodexHeartbeatTurnCompletion["Service"],
            ),
            Layer.succeed(CodexPermissions, {} as CodexPermissions["Service"]),
            Layer.succeed(
              CodexRendererConversationRegistry,
              {} as CodexRendererConversationRegistry["Service"],
            ),
            Layer.succeed(CodexThreadDirectory, {} as CodexThreadDirectory["Service"]),
            Layer.succeed(CodexThreadSettingsRuntime, {} as CodexThreadSettingsRuntime["Service"]),
            Layer.succeed(
              CodexThreadTitlePersistence,
              {} as CodexThreadTitlePersistence["Service"],
            ),
            Layer.succeed(CodexTurnAuthority, {} as CodexTurnAuthority["Service"]),
            Layer.succeed(CodexTurnCommands, {} as CodexTurnCommands["Service"]),
            Layer.succeed(ComposerCatalog, {} as ComposerCatalog["Service"]),
            Layer.succeed(ConversationRuntimeMap, {} as ConversationRuntimeMap["Service"]),
            Layer.succeed(DesktopToolRuntime, {} as DesktopToolRuntime["Service"]),
            Layer.succeed(ExecutionHostRuntime, {} as ExecutionHostRuntime["Service"]),
            mainConfigLayer(),
            Layer.succeed(
              ManagedWorktreeRetentionRuntime,
              {} as ManagedWorktreeRetentionRuntime["Service"],
            ),
            Layer.succeed(ManagedWorktreeRuntime, {} as ManagedWorktreeRuntime["Service"]),
            Layer.succeed(ProjectWorkspace, {} as ProjectWorkspace["Service"]),
          ),
        ),
      ),
      scope,
    );

    yield* Context.get(context, AutomationExecution).runNow({ id: definition.id });
    assert.strictEqual(gatewayReady, 1);
    assert.strictEqual(providerReady, 1);
    yield* Scope.close(scope, Exit.void);
  }),
);
