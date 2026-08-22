import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { IpcMainInvokeEvent } from "electron";
import type { IpcEvents } from "../../../shared/ipc-api";
import type {
  BrowserBrowsingDataKind,
  BrowserSidebarCommand,
  BrowserSidebarCommandResult,
  BrowserSidebarWebviewDestroyed,
  BrowserSidebarWebviewHostCreated,
} from "../../../shared/browser-sidebar";
import { BrowserAnnotationEvidenceCaptureInputSchema } from "../../../shared/browser-annotation";
import {
  BrowserBrowsingDataKindSchema,
  BrowserSidebarLocalServerThumbnailRequestSchema,
  parseBrowserSidebarCommand,
  parseBrowserSidebarWebviewDestroyed,
  parseBrowserSidebarWebviewHostCreated,
} from "../../../shared/browser/browser-schemas";
import {
  BrowserHistoryDeleteInputSchema,
  BrowserHistoryListInputSchema,
} from "../../../shared/browser-profile";
import { MainConfig } from "../../app/MainConfig";
import { ScopedCallbackRuntime } from "../../app/ScopedCallbackRuntime";
import { computeBrowserAnnotationEvidenceCrop } from "../../browser/browser-annotation-evidence";
import { isBrowserLocalServerCommand } from "../../browser/browser-local-server-runtime";
import {
  filterBrowserStateForViewScope,
  filterBrowserUseStateForViewScope,
} from "../../browser/browser-event-routing";
import { BrowserSidebarRuntime } from "../../host-runtime/BrowserSidebarRuntime";
import { safeBroadcastToWindows, safeSendToWebContents } from "../../ipc-safe-send";
import { saveUploadedImage } from "../../local-store/assets";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { ElectronWindowHost } from "../../platform/electron/ElectronWindowHost";
import { WindowSessionCatalog } from "../../window-runtime/WindowSessionCatalog";

export class BrowserSidebarIpcError extends Schema.TaggedError<BrowserSidebarIpcError>()(
  "BrowserSidebarIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

const attempt = <A>(
  operation: string,
  run: () => A | PromiseLike<A>,
): Effect.Effect<A, BrowserSidebarIpcError> =>
  Effect.tryPromise({
    try: async () => await run(),
    catch: (cause) => new BrowserSidebarIpcError({ operation, cause }),
  });

const commandViewScope = (command: BrowserSidebarCommand): string | null => {
  if ("browserViewScopeId" in command) return command.browserViewScopeId;
  if ("tab" in command && "browserViewScopeId" in command.tab) {
    return command.tab.browserViewScopeId;
  }
  if ("cursor" in command && "browserViewScopeId" in command.cursor) {
    return command.cursor.browserViewScopeId;
  }
  if ("event" in command && "browserViewScopeId" in command.event) {
    return command.event.browserViewScopeId;
  }
  if ("result" in command && "browserViewScopeId" in command.result) {
    return command.result.browserViewScopeId;
  }
  return null;
};

export const live: Layer.Layer<
  never,
  never,
  | BrowserSidebarRuntime
  | ElectronIpc
  | ElectronWindowHost
  | MainConfig
  | ScopedCallbackRuntime
  | WindowSessionCatalog
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const { browser, history, localServers, localServerThumbnail } = yield* BrowserSidebarRuntime;
    const callbacks = yield* ScopedCallbackRuntime;
    const config = yield* MainConfig;
    const ipc = yield* ElectronIpc;
    const windows = yield* ElectronWindowHost;
    const windowSessions = yield* WindowSessionCatalog;

    const trusted = (event: IpcMainInvokeEvent, capabilityName: string) =>
      attempt("authorize-renderer", () =>
        requireTrustedAppRendererSender(event, capabilityName, config.rendererUrl),
      );
    const parse = <A>(operation: string, run: () => A) => attempt(operation, run);
    const resolveViewScope = (senderId: number) =>
      windowSessions.resolveForWebContents(senderId).pipe(
        Effect.flatMap((browserViewScopeId) =>
          browserViewScopeId
            ? Effect.succeed(browserViewScopeId)
            : Effect.fail(
                new BrowserSidebarIpcError({
                  operation: "resolve-browser-view-scope",
                  cause: new Error("The requesting window has no assigned Window Session"),
                }),
              ),
        ),
      );
    const requireViewScope = (senderId: number, browserViewScopeId: string) =>
      resolveViewScope(senderId).pipe(
        Effect.flatMap((expectedScopeId) =>
          expectedScopeId === browserViewScopeId
            ? Effect.void
            : Effect.fail(
                new BrowserSidebarIpcError({
                  operation: "authorize-browser-view-scope",
                  cause: new Error("Browser view scope does not belong to the requesting window"),
                }),
              ),
        ),
      );

    yield* ipc.handle("browser-sidebar-command", (event, rawCommand: BrowserSidebarCommand) =>
      trusted(event, "Browser control").pipe(
        Effect.andThen(
          parse("parse-browser-command", () => parseBrowserSidebarCommand(rawCommand)),
        ),
        Effect.tap((command) => {
          const scopeId = commandViewScope(command);
          return scopeId ? requireViewScope(event.sender.id, scopeId) : Effect.void;
        }),
        Effect.flatMap((command) =>
          resolveViewScope(event.sender.id).pipe(
            Effect.flatMap(
              (
                browserViewScopeId,
              ): Effect.Effect<BrowserSidebarCommandResult, BrowserSidebarIpcError> =>
                isBrowserLocalServerCommand(command)
                  ? localServers
                      .applyCommand(command)
                      .pipe(Effect.as({ ok: true as const } satisfies BrowserSidebarCommandResult))
                  : attempt("apply-browser-command", () =>
                      browser.handleCommand(command, {
                        browserViewScopeId,
                        ownerWebContentsId: event.sender.id,
                      }),
                    ),
            ),
          ),
        ),
      ),
    );
    yield* ipc.handle("browser-sidebar-runtime-snapshot", (event) =>
      trusted(event, "Browser runtime state").pipe(
        Effect.andThen(resolveViewScope(event.sender.id)),
        Effect.flatMap((browserViewScopeId) =>
          attempt("read-browser-runtime", () => ({
            state: filterBrowserStateForViewScope(browser.getStateSnapshot(), browserViewScopeId),
            browserUseState: filterBrowserUseStateForViewScope(
              browser.getBrowserUseStateSnapshot(),
              browserViewScopeId,
            ),
            presentationRequests:
              browser.listPendingBrowserUsePresentationRequests(browserViewScopeId),
          })),
        ),
      ),
    );
    yield* ipc.handle("browser-browsing-data-clear", (event, rawKind: BrowserBrowsingDataKind) =>
      trusted(event, "Browser data clearing").pipe(
        Effect.andThen(
          parse("parse-browsing-data-kind", () => BrowserBrowsingDataKindSchema.parse(rawKind)),
        ),
        Effect.flatMap((kind) =>
          attempt("clear-browser-data", () => browser.clearBrowsingData(kind)),
        ),
      ),
    );
    yield* ipc.handle(
      "browser-sidebar-webview-host-created",
      (event, rawEvent: BrowserSidebarWebviewHostCreated) =>
        trusted(event, "Browser webview registration").pipe(
          Effect.andThen(
            parse("parse-browser-webview-registration", () =>
              parseBrowserSidebarWebviewHostCreated(rawEvent),
            ),
          ),
          Effect.tap((input) => requireViewScope(event.sender.id, input.browserViewScopeId)),
          Effect.flatMap((input) =>
            attempt("register-browser-webview", () =>
              browser.handleWebviewHostCreated(input, event.sender.id),
            ),
          ),
        ),
    );
    yield* ipc.handle(
      "browser-sidebar-webview-destroyed",
      (event, rawEvent: BrowserSidebarWebviewDestroyed) =>
        trusted(event, "Browser webview teardown").pipe(
          Effect.andThen(
            parse("parse-browser-webview-teardown", () =>
              parseBrowserSidebarWebviewDestroyed(rawEvent),
            ),
          ),
          Effect.tap((input) => requireViewScope(event.sender.id, input.browserViewScopeId)),
          Effect.flatMap((input) =>
            attempt("release-browser-webview", () => browser.handleWebviewDestroyed(input)),
          ),
        ),
    );
    yield* ipc.handle("browser-history-list", (event, rawInput: unknown) =>
      trusted(event, "Browser history").pipe(
        Effect.andThen(
          parse("parse-browser-history-query", () =>
            rawInput === undefined ? {} : BrowserHistoryListInputSchema.parse(rawInput),
          ),
        ),
        Effect.flatMap((input) => history.list(input)),
      ),
    );
    yield* ipc.handle("browser-history-delete", (event, historyId: unknown) =>
      trusted(event, "Browser history removal").pipe(
        Effect.andThen(
          parse("parse-browser-history-removal", () =>
            BrowserHistoryDeleteInputSchema.parse({ id: historyId }),
          ),
        ),
        Effect.flatMap(({ id }) =>
          history
            .delete(id)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new BrowserSidebarIpcError({ operation: "remove-browser-history", cause }),
              ),
            ),
        ),
        Effect.as({ ok: true as const }),
      ),
    );
    yield* ipc.handle("browser-annotation-capture-evidence", (event, rawInput: unknown) =>
      trusted(event, "Browser annotation evidence").pipe(
        Effect.andThen(
          parse("parse-browser-annotation-evidence", () =>
            BrowserAnnotationEvidenceCaptureInputSchema.parse(rawInput),
          ),
        ),
        Effect.tap((input) => requireViewScope(event.sender.id, input.browserViewScopeId)),
        Effect.flatMap((input) =>
          attempt("capture-browser-annotation-evidence", async () => {
            const contents = browser.getWebContentsForTab(input);
            const snapshot = browser.getTabSnapshot(input);
            if (!contents || !snapshot || contents.isDestroyed()) {
              throw new Error("Browser annotation page is unavailable");
            }
            const image = await contents.capturePage();
            const crop = computeBrowserAnnotationEvidenceCrop({
              anchors: input.anchors,
              imageSize: image.getSize(),
              viewport: snapshot.viewport,
            });
            if (!crop) throw new Error("Browser annotation evidence is outside the page");
            let evidenceImage = image.crop(crop);
            const croppedSize = evidenceImage.getSize();
            const longestSide = Math.max(croppedSize.width, croppedSize.height);
            if (longestSide > 2_048) {
              const ratio = 2_048 / longestSide;
              evidenceImage = evidenceImage.resize({
                width: Math.max(1, Math.round(croppedSize.width * ratio)),
                height: Math.max(1, Math.round(croppedSize.height * ratio)),
                quality: "best",
              });
            }
            const saved = saveUploadedImage({
              name: `browser-annotation-${Date.now()}.png`,
              mimeType: "image/png",
              bytes: evidenceImage.toPNG(),
            });
            const finalSize = evidenceImage.getSize();
            return {
              attachmentId: saved.fileName,
              source: saved.source,
              mimeType: "image/png" as const,
              width: finalSize.width,
              height: finalSize.height,
            };
          }),
        ),
      ),
    );
    yield* ipc.handle("browser-local-server-thumbnail", (event, rawInput: unknown) =>
      trusted(event, "Local server preview").pipe(
        Effect.andThen(
          parse("parse-local-server-thumbnail", () =>
            BrowserSidebarLocalServerThumbnailRequestSchema.parse(rawInput),
          ),
        ),
        Effect.tap((input) => requireViewScope(event.sender.id, input.browserViewScopeId)),
        Effect.flatMap((input) => {
          const admission = browser.admitLocalServerThumbnail(input);
          if (admission._tag === "Denied") return Effect.succeed(admission.result);
          return localServers.isDiscovered(input.projectId, admission.url).pipe(
            Effect.flatMap((discovered) =>
              discovered
                ? localServerThumbnail.get(admission.url)
                : Effect.succeed({
                    status: "unavailable" as const,
                    message: "Local server preview was not discovered for this project",
                  }),
            ),
          );
        }),
      ),
    );

    const sendToScope = (channel: keyof IpcEvents, browserViewScopeId: string, payload: unknown) =>
      windows.all.pipe(
        Effect.flatMap((all) =>
          Effect.forEach(
            all,
            (window) =>
              windowSessions
                .resolveForWebContents(window.webContents.id)
                .pipe(
                  Effect.tap((scopeId) =>
                    scopeId === browserViewScopeId
                      ? Effect.sync(() =>
                          safeSendToWebContents(window.webContents, channel, [payload]),
                        )
                      : Effect.void,
                  ),
                ),
            { discard: true },
          ),
        ),
      );
    const sendFilteredState = (snapshot: ReturnType<typeof browser.getStateSnapshot>) =>
      windows.all.pipe(
        Effect.flatMap((all) =>
          Effect.forEach(
            all,
            (window) =>
              windowSessions
                .resolveForWebContents(window.webContents.id)
                .pipe(
                  Effect.tap((scopeId) =>
                    scopeId
                      ? Effect.sync(() =>
                          safeSendToWebContents(window.webContents, "browser-sidebar-state", [
                            filterBrowserStateForViewScope(snapshot, scopeId),
                          ]),
                        )
                      : Effect.void,
                  ),
                ),
            { discard: true },
          ),
        ),
      );
    const sendFilteredBrowserUseState = (
      snapshot: ReturnType<typeof browser.getBrowserUseStateSnapshot>,
    ) =>
      windows.all.pipe(
        Effect.flatMap((all) =>
          Effect.forEach(
            all,
            (window) =>
              windowSessions
                .resolveForWebContents(window.webContents.id)
                .pipe(
                  Effect.tap((scopeId) =>
                    scopeId
                      ? Effect.sync(() =>
                          safeSendToWebContents(
                            window.webContents,
                            "browser-sidebar-browser-use-state",
                            [filterBrowserUseStateForViewScope(snapshot, scopeId)],
                          ),
                        )
                      : Effect.void,
                  ),
                ),
            { discard: true },
          ),
        ),
      );

    const stateListener = (snapshot: ReturnType<typeof browser.getStateSnapshot>) => {
      callbacks.fork(sendFilteredState(snapshot));
    };
    yield* localServers.updates.pipe(
      Stream.runForEach((snapshot) =>
        windows.all.pipe(
          Effect.tap((all) =>
            Effect.sync(() =>
              safeBroadcastToWindows(all, "browser-sidebar-local-servers", [snapshot]),
            ),
          ),
          Effect.asVoid,
        ),
      ),
      Effect.forkScoped,
    );
    const browserUseStateListener = (
      snapshot: ReturnType<typeof browser.getBrowserUseStateSnapshot>,
    ) => {
      callbacks.fork(sendFilteredBrowserUseState(snapshot));
    };
    const browserUseViewportListener = (event: IpcEvents["browser-sidebar-browser-use-viewport"]) =>
      callbacks.fork(
        sendToScope("browser-sidebar-browser-use-viewport", event.browserViewScopeId, event),
      );
    const browserUseCaptureSurfaceListener = (
      event: IpcEvents["browser-sidebar-browser-use-capture-surface"],
    ) =>
      callbacks.fork(
        sendToScope("browser-sidebar-browser-use-capture-surface", event.browserViewScopeId, event),
      );
    const browserUseCursorListener = (
      event: IpcEvents["browser-sidebar-browser-use-cursor-state"],
    ) =>
      callbacks.fork(
        sendToScope("browser-sidebar-browser-use-cursor-state", event.browserViewScopeId, event),
      );
    const pageReleasedListener = (event: IpcEvents["browser-sidebar-browser-use-page-released"]) =>
      callbacks.fork(
        sendToScope("browser-sidebar-browser-use-page-released", event.browserViewScopeId, event),
      );
    const pageClosedListener = (event: IpcEvents["browser-sidebar-browser-use-page-closed"]) =>
      callbacks.fork(
        sendToScope("browser-sidebar-browser-use-page-closed", event.browserViewScopeId, event),
      );
    const presentationListener = (
      event: IpcEvents["browser-sidebar-browser-use-presentation-request"],
    ) =>
      callbacks.fork(
        sendToScope(
          "browser-sidebar-browser-use-presentation-request",
          event.browserViewScopeId,
          event,
        ),
      );
    const openNewTabListener = (event: IpcEvents["browser-sidebar-open-new-tab"]) =>
      callbacks.fork(sendToScope("browser-sidebar-open-new-tab", event.browserViewScopeId, event));
    const contextMenuListener = (event: IpcEvents["browser-sidebar-context-menu-action"]) =>
      callbacks.fork(
        sendToScope("browser-sidebar-context-menu-action", event.browserViewScopeId, event),
      );
    const imageDragListener = (event: IpcEvents["browser-sidebar-image-drag-state"]) =>
      callbacks.fork(
        sendToScope("browser-sidebar-image-drag-state", event.browserViewScopeId, event),
      );
    const webviewAttachedListener = (event: IpcEvents["browser-sidebar-webview-attached"]) =>
      callbacks.fork(
        sendToScope("browser-sidebar-webview-attached", event.browserViewScopeId, event),
      );
    const destroyWebviewListener = (event: IpcEvents["browser-sidebar-destroy-webview"]) =>
      callbacks.fork(
        sendToScope("browser-sidebar-destroy-webview", event.browserViewScopeId, event),
      );

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        browser.on("state", stateListener);
        browser.on("browserUseState", browserUseStateListener);
        browser.on("browserUseViewport", browserUseViewportListener);
        browser.on("browserUseCaptureSurface", browserUseCaptureSurfaceListener);
        browser.on("browserUseCursor", browserUseCursorListener);
        browser.on("pageReleased", pageReleasedListener);
        browser.on("pageClosed", pageClosedListener);
        browser.on("browserUsePresentationRequest", presentationListener);
        browser.on("openNewTab", openNewTabListener);
        browser.on("contextMenuAction", contextMenuListener);
        browser.on("imageDragState", imageDragListener);
        browser.on("webviewAttached", webviewAttachedListener);
        browser.on("destroyWebview", destroyWebviewListener);
      }),
      () =>
        Effect.sync(() => {
          browser.removeListener("state", stateListener);
          browser.removeListener("browserUseState", browserUseStateListener);
          browser.removeListener("browserUseViewport", browserUseViewportListener);
          browser.removeListener("browserUseCaptureSurface", browserUseCaptureSurfaceListener);
          browser.removeListener("browserUseCursor", browserUseCursorListener);
          browser.removeListener("pageReleased", pageReleasedListener);
          browser.removeListener("pageClosed", pageClosedListener);
          browser.removeListener("browserUsePresentationRequest", presentationListener);
          browser.removeListener("openNewTab", openNewTabListener);
          browser.removeListener("contextMenuAction", contextMenuListener);
          browser.removeListener("imageDragState", imageDragListener);
          browser.removeListener("webviewAttached", webviewAttachedListener);
          browser.removeListener("destroyWebview", destroyWebviewListener);
        }),
    ).pipe(Effect.asVoid);
  }),
);
