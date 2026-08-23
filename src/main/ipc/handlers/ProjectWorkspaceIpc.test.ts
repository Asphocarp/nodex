import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { testLayer as mainConfigLayer } from "../../app/MainConfig";
import { layer as scopedCallbackRuntimeLive } from "../../app/ScopedCallbackRuntime";
import { CodexThreadTitlePersistence } from "../../codex-application/CodexThreadTitlePersistence";
import { ConversationCommands } from "../../codex-application/ConversationCommands";
import { CodexBackgroundProcesses } from "../../codex-application/CodexBackgroundProcesses";
import type { CodexService } from "../../codex/codex-service";
import type { DesktopProjectWorkspacePort } from "../../core-client/project-workspace-adapter";
import { ElectronDesktop } from "../../platform/electron/ElectronDesktop";
import { live as projectRuntimeLifecycleLive } from "../../host-runtime/ProjectRuntimeLifecycleRuntime";
import { BrowserSidebarRuntime } from "../../host-runtime/BrowserSidebarRuntime";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";
import { live } from "./ProjectWorkspaceIpc";

it.effect("owns Project and Project Session ingress with the Main Scope", () =>
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
      live({
        codex: {} as CodexService,
        backgroundProcesses: CodexBackgroundProcesses.of({
          list: () => Effect.die("unused"),
          runAction: () => Effect.die("unused"),
        }),
        projects: {} as DesktopProjectWorkspacePort,
        threadTitles: CodexThreadTitlePersistence.of({
          set: () => Effect.die("unused"),
          setRequired: () => Effect.die("unused"),
        }),
        conversationCommands: ConversationCommands.of({
          archive: () => Effect.die("unused"),
          unarchive: () => Effect.die("unused"),
          setMemoryMode: () => Effect.die("unused"),
          startReview: () => Effect.die("unused"),
          uploadFeedback: () => Effect.die("unused"),
          listBackgroundTerminals: () => Effect.die("unused"),
          terminateBackgroundTerminal: () => Effect.die("unused"),
          interrupt: () => Effect.die("unused"),
          cleanBackgroundTerminals: () => Effect.die("unused"),
          cleanBackgroundTerminalsSilently: () => Effect.die("unused"),
        }),
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ElectronIpc, ipc),
            Layer.succeed(BrowserSidebarRuntime, {
              browser: { closeBrowserConversation: () => undefined },
              localServers: { closeProject: () => Effect.void },
            } as unknown as BrowserSidebarRuntime["Service"]),
            mainConfigLayer(),
            projectRuntimeLifecycleLive,
            scopedCallbackRuntimeLive,
            Layer.succeed(ElectronDesktop, { dialog: {} } as unknown as ElectronDesktop["Service"]),
            Layer.succeed(WindowRuntime, {
              has: () => true,
            } as unknown as WindowRuntime["Service"]),
          ),
        ),
      ),
      scope,
    );

    assert.strictEqual(channels.size, 27);
    assert.isTrue(channels.has("projects:create"));
    assert.isTrue(channels.has("project-sessions:fork"));
    assert.isTrue(channels.has("project-session-threads:detach"));

    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(channels.size, 0);
  }),
);
