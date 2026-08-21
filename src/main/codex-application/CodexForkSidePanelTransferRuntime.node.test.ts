import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import type { CodexForkBrowserSidePanelSnapshot } from "../../shared/codex-fork-browser-transfer";
import { BrowserApplication } from "../browser-application/BrowserApplication";
import type { BrowserForkTransfer } from "../browser-application/BrowserForkTransfer";
import { ProjectWorkspace } from "../project-application/ProjectWorkspace";
import { CodexClientThreadIdentity } from "./CodexClientThreadIdentity";
import { make } from "./CodexForkSidePanelTransferRuntime";

const snapshot = (browserConversationId: string): CodexForkBrowserSidePanelSnapshot => ({
  bottomPanelOpen: false,
  focusArea: "main",
  rightPanelFullWidth: false,
  rightPanelOpen: false,
  sourceBrowserConversationId: browserConversationId,
  sourceBrowserViewScopeId: `headless:${browserConversationId}`,
  tabs: [],
  targetBrowserConversationId: browserConversationId,
  targetBrowserViewScopeId: `headless:${browserConversationId}`,
});

const makeFixture = Effect.gen(function* () {
  const scope = yield* Scope.make();
  const forkTransfer: BrowserForkTransfer = {
    capture: (browserConversationId) => Effect.succeed(snapshot(browserConversationId)),
    rebase: (captured, targetBrowserConversationId) =>
      Effect.succeed({ ...captured, targetBrowserConversationId }),
    apply: (captured, input) =>
      Effect.succeed({
        ...captured,
        targetBrowserViewScopeId: input.targetBrowserViewScopeId,
      }),
  };
  const browser = BrowserApplication.of({
    forkTransfer,
  } as unknown as BrowserApplication["Service"]);
  const resolveBrowserConversationId: CodexClientThreadIdentity["Service"]["resolveBrowserConversationId"] =
    (conversationId) =>
      Effect.succeed(
        conversationId.startsWith("thread-")
          ? `session-${conversationId.slice("thread-".length)}`
          : conversationId,
      );
  const identities = CodexClientThreadIdentity.of({
    resolveBrowserConversationId,
  } as unknown as CodexClientThreadIdentity["Service"]);
  const getProjectSession: ProjectWorkspace["Service"]["getProjectSession"] = (sessionId) =>
    Effect.succeed({ id: sessionId, projectId: "project" } as never);
  const workspace = ProjectWorkspace.of({
    getProjectSession,
  } as unknown as ProjectWorkspace["Service"]);
  const runtime = yield* make.pipe(
    Effect.provideService(BrowserApplication, browser),
    Effect.provideService(CodexClientThreadIdentity, identities),
    Effect.provideService(ProjectWorkspace, workspace),
    Effect.provideService(Scope.Scope, scope),
  );
  return { runtime, scope };
});

it.effect("keeps pending and target fork state atomic through promotion and consumption", () =>
  Effect.gen(function* () {
    const { runtime } = yield* makeFixture;
    yield* runtime.capturePending({
      pendingWorktreeId: "pending",
      sourceConversationId: "thread-source",
      sourceWorkspaceRoot: "/source",
    });
    yield* runtime.stageDirect({
      sourceConversationId: "thread-direct",
      targetConversationId: "thread-shared",
    });

    assert.strictEqual(
      (yield* runtime.getPendingSnapshot("pending"))?.sourceBrowserConversationId,
      "session-source",
    );
    assert.strictEqual(
      (yield* runtime.getTargetSnapshot("thread-shared"))?.targetBrowserConversationId,
      "session-shared",
    );
    assert.isTrue(
      yield* runtime.promotePending({
        pendingWorktreeId: "pending",
        targetConversationId: "thread-target",
        targetWorkspaceRoot: "/target",
      }),
    );
    assert.isNull(yield* runtime.getPendingSnapshot("pending"));

    const applied = yield* runtime.consumeTarget({
      routeKind: "local-thread",
      targetConversationId: "thread-target",
      targetProjectSessionId: "session-target",
      targetBrowserViewScopeId: "window-target",
    });
    assert.strictEqual(applied?.targetBrowserConversationId, "session-target");
    assert.strictEqual(applied?.targetBrowserViewScopeId, "window-target");
    assert.isNull(yield* runtime.getTargetSnapshot("thread-target"));
  }),
);

it.effect("closes admission and clears every fork transfer with the owning Main Scope", () =>
  Effect.gen(function* () {
    const { runtime, scope } = yield* makeFixture;
    yield* runtime.stageDirect({
      sourceConversationId: "thread-source",
      targetConversationId: "thread-target",
    });

    yield* Scope.close(scope, Exit.void);

    assert.isNull(yield* runtime.getTargetSnapshot("thread-target"));
    const error = yield* Effect.flip(runtime.discardPending("pending"));
    assert.strictEqual(error.operation, "admission");
  }),
);
