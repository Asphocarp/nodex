import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type {
  BrowserBrowsingDataClearResult,
  BrowserBrowsingDataKind,
  BrowserSidebarCommand,
  BrowserSidebarCommandResult,
} from "../../shared/browser-sidebar";
import type { BrowserSidebarService } from "../browser-sidebar-service";
import { BrowserProfileRuntime } from "./BrowserProfileRuntime";
import { BrowserSidebarRuntime } from "./BrowserSidebarRuntime";
import { BrowserSiteStatusRuntime } from "./BrowserSiteStatusRuntime";
import { BrowserUseRuntime } from "./BrowserUseRuntime";

export class BrowserPresentationRuntimeError extends Schema.TaggedError<BrowserPresentationRuntimeError>()(
  "BrowserPresentationRuntimeError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export interface BrowserPresentationCommandContext {
  readonly browserViewScopeId?: string;
  readonly ownerWebContentsId?: number;
}

export class BrowserPresentationRuntime extends Context.Service<
  BrowserPresentationRuntime,
  {
    readonly browser: BrowserSidebarService;
    readonly sidebar: BrowserSidebarRuntime["Service"];
    readonly applyCommand: (
      command: BrowserSidebarCommand,
      context?: BrowserPresentationCommandContext,
    ) => Effect.Effect<BrowserSidebarCommandResult, BrowserPresentationRuntimeError>;
    readonly clearBrowsingData: (
      kind: BrowserBrowsingDataKind,
    ) => Effect.Effect<BrowserBrowsingDataClearResult, BrowserPresentationRuntimeError>;
  }
>()("nodex/main/host-runtime/BrowserPresentationRuntime") {}

const runtimeError = (operation: string, cause: unknown): BrowserPresentationRuntimeError =>
  new BrowserPresentationRuntimeError({ operation, cause });

const blockedCommentMode: BrowserSidebarCommandResult = {
  ok: false,
  message: "Comment mode is unavailable for this site.",
};

export const live: Layer.Layer<
  BrowserPresentationRuntime,
  never,
  BrowserProfileRuntime | BrowserSidebarRuntime | BrowserSiteStatusRuntime | BrowserUseRuntime
> = Layer.effect(
  BrowserPresentationRuntime,
  Effect.gen(function* () {
    const profile = yield* BrowserProfileRuntime;
    const sidebar = yield* BrowserSidebarRuntime;
    const siteStatus = yield* BrowserSiteStatusRuntime;
    const browserUse = yield* BrowserUseRuntime;
    const { browser } = sidebar;

    const applyBaseCommand = (
      command: BrowserSidebarCommand,
      context: BrowserPresentationCommandContext,
    ): Effect.Effect<BrowserSidebarCommandResult, BrowserPresentationRuntimeError> =>
      Effect.tryPromise({
        try: () => browser.handleCommand(command, context),
        catch: (cause) => runtimeError("apply-command", cause),
      });

    const applyCommand = Effect.fn("BrowserPresentationRuntime.applyCommand")(
      function* (command: BrowserSidebarCommand, context: BrowserPresentationCommandContext = {}) {
        if (command.type === "capture-browser-use-route") {
          if (context.ownerWebContentsId === undefined) {
            return { ok: false, message: "Browser route owner is unavailable" } as const;
          }
          yield* browserUse.captureRoute({
            browserConversationId: command.browserConversationId,
            browserViewScopeId: command.browserViewScopeId,
            codexSessionId: command.codexSessionId,
            ownerWebContentsId: context.ownerWebContentsId,
            projectId: command.projectId,
          });
          return { ok: true } as const;
        }

        const requiresSiteDecision =
          command.type === "quick-annotate" ||
          (command.type === "set-interaction-mode" && command.mode === "comment");
        if (requiresSiteDecision) {
          const tab = browser.getTabSnapshot(command);
          if (tab && (yield* siteStatus.isCommentModeBlocked(tab.url))) {
            return blockedCommentMode;
          }
        }
        return yield* applyBaseCommand(command, context);
      },
      Effect.mapError((cause) =>
        cause instanceof BrowserPresentationRuntimeError
          ? cause
          : runtimeError("apply-command", cause),
      ),
    );

    const clearBrowsingData = Effect.fn("BrowserPresentationRuntime.clearBrowsingData")(
      function* (kind: BrowserBrowsingDataKind) {
        if (kind === "downloads") {
          yield* profile.download.clearHistory;
          return { ok: true } as const;
        }
        return yield* Effect.tryPromise({
          try: () => browser.clearBrowsingData(kind),
          catch: (cause) => runtimeError("clear-browsing-data", cause),
        });
      },
      Effect.mapError((cause) =>
        cause instanceof BrowserPresentationRuntimeError
          ? cause
          : runtimeError("clear-browsing-data", cause),
      ),
    );

    return BrowserPresentationRuntime.of({ applyCommand, browser, clearBrowsingData, sidebar });
  }),
);
