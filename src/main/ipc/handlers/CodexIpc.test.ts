import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { testLayer as mainConfigLayer } from "../../app/MainConfig";
import { layer as scopedCallbackRuntimeLive } from "../../app/ScopedCallbackRuntime";
import { CodexManualCompactionRuntime } from "../../codex-application/CodexManualCompactionRuntime";
import { CodexThreadGoalRuntime } from "../../codex-application/CodexThreadGoalRuntime";
import { CodexThreadSettingsRuntime } from "../../codex-application/CodexThreadSettingsRuntime";
import { CodexThreadCatalog } from "../../codex-application/CodexThreadCatalog";
import { CodexThreadReadState } from "../../codex-application/CodexThreadReadState";
import { AgentImportRuntime } from "../../codex-application/AgentImportRuntime";
import { CodexConversationHistoryRuntime } from "../../codex-application/CodexConversationHistoryRuntime";
import { CodexStructuredThreadTitle } from "../../codex-application/CodexStructuredThreadTitle";
import type { CodexFreshThreadLaunchRuntimeService } from "../../codex-application/CodexFreshThreadLaunchRuntime";
import { CodexThreadTitlePersistence } from "../../codex-application/CodexThreadTitlePersistence";
import { ConversationCommands } from "../../codex-application/ConversationCommands";
import { CodexSidebarSyncRuntime } from "../../codex-application/CodexSidebarSyncRuntime";
import type { CodexService } from "../../codex/codex-service";
import type { RendererClientRuntimeService } from "../../codex/renderer-client-runtime-contracts";
import type { DesktopProjectWorkspacePort } from "../../core-client/project-workspace-adapter";
import { codexIpcLive } from "../../ipc-handlers";
import { live as projectRuntimeLifecycleLive } from "../../host-runtime/ProjectRuntimeLifecycleRuntime";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

it.effect("owns the remaining Codex application ingress with the Main Scope", () =>
  Effect.gen(function* () {
    const channels = new Set<string>();
    const ipc = ElectronIpc.of({
      handle: (channel: string) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            channels.add(channel);
          }),
          () => Effect.sync(() => channels.delete(channel)),
        ),
      on: () => Effect.die("unused"),
    } as unknown as ElectronIpc["Service"]);
    const scope = yield* Scope.make();
    yield* Layer.buildWithScope(
      codexIpcLive({
        codexService: {} as CodexService,
        manualCompaction: CodexManualCompactionRuntime.of({
          start: () => Effect.void,
          consumeSource: () => "automatic",
          clear: () => undefined,
        }),
        threadGoals: CodexThreadGoalRuntime.of({
          get: () => Effect.succeed(null),
          set: () => Effect.succeed(null),
          clear: () => Effect.void,
          load: () => Effect.succeed({ ok: true, goal: null }),
        }),
        threadSettings: CodexThreadSettingsRuntime.of({
          update: () => Effect.die(new Error("Unexpected Thread settings operation")),
          awaitCurrent: () => Effect.void,
          remoteUpdateSupport: () => "unknown",
          recordRemoteUpdateSupported: () => undefined,
          recordRemoteUpdateUnsupported: () => undefined,
        }),
        threadTitles: CodexThreadTitlePersistence.of({
          set: () => Effect.die(new Error("Unexpected Thread title operation")),
          setRequired: () => Effect.die(new Error("Unexpected required Thread title operation")),
        }),
        threadCatalog: CodexThreadCatalog.of({
          listPinned: Effect.die("unused"),
          listProject: () => Effect.die("unused"),
          listPalette: () => Effect.die("unused"),
          searchPalette: () => Effect.die("unused"),
          setPinned: () => Effect.die("unused"),
          reorderPinned: () => Effect.die("unused"),
          move: () => Effect.die("unused"),
        }),
        sidebarSync: CodexSidebarSyncRuntime.of({
          sync: () => Effect.die("unused"),
          publish: () => Effect.die("unused"),
          invalidate: () => undefined,
          scheduleNotification: () => undefined,
        }),
        threadReadState: CodexThreadReadState.of({
          set: () => Effect.die("unused"),
          persistProjected: () => Effect.die("unused"),
        }),
        agentImport: AgentImportRuntime.of({
          scan: () => Effect.die("unused"),
          apply: () => Effect.die("unused"),
          snapshot: Effect.die("unused"),
        }),
        conversationHistory: CodexConversationHistoryRuntime.of({
          loadPage: () => Effect.die("unused"),
          loadComplete: () => Effect.die("unused"),
          requestRemaining: () => undefined,
          clear: () => undefined,
        }),
        freshThreadLaunch: {
          adopt: () => Effect.die("unused"),
        } as unknown as CodexFreshThreadLaunchRuntimeService,
        structuredThreadTitle: CodexStructuredThreadTitle.of({
          generate: () => Effect.die("unused"),
        }),
        conversationCommands: ConversationCommands.of({
          archive: () => Effect.die("unused"),
          unarchive: () => Effect.die("unused"),
          setMemoryMode: () => Effect.die("unused"),
          startReview: () => Effect.die("unused"),
          uploadFeedback: () => Effect.die("unused"),
          listBackgroundTerminals: () => Effect.die("unused"),
          terminateBackgroundTerminal: () => Effect.die("unused"),
        }),
        projectWorkspace: {} as DesktopProjectWorkspacePort,
        rendererClientRouter: {} as RendererClientRuntimeService,
        terminalRuntime: { runAction: () => Promise.resolve() },
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ElectronIpc, ipc),
            mainConfigLayer(),
            projectRuntimeLifecycleLive,
            scopedCallbackRuntimeLive,
            Layer.succeed(WindowRuntime, {
              has: () => true,
              resolveSessionId: () => "window-session",
            } as unknown as WindowRuntime["Service"]),
          ),
        ),
      ),
      scope,
    );

    assert.isTrue(channels.has("codex:threads:list"));
    assert.isTrue(channels.has("codex:turn:start"));
    assert.isFalse(channels.has("codex:permission:custom-description:get"));
    assert.isFalse(channels.has("worktrees:execution-hosts:update"));

    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(channels.size, 0);
  }),
);
