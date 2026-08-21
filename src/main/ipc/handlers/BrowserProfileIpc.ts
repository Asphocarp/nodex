import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";
import type { BrowserSidebarService } from "../../browser-sidebar-service";
import { BrowserProfileRuntime } from "../../host-runtime/BrowserProfileRuntime";
import { safeBroadcastToWindows, safeSendToWebContents } from "../../ipc-safe-send";
import { MainConfig } from "../../app/MainConfig";
import { ElectronDesktop } from "../../platform/electron/ElectronDesktop";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { ElectronWindowHost } from "../../platform/electron/ElectronWindowHost";
import { WindowSessionCatalog } from "../../window-runtime/WindowSessionCatalog";
import {
  BrowserAnnotationAnchorUpdateEventSchema,
  BrowserAnnotationSelectionEventSchema,
} from "../../../shared/browser-annotation";
import { BrowserDownloadActionRequestSchema } from "../../../shared/browser/browser-download-schemas";
import {
  BrowserGuestImageDragStartedSchema,
  BrowserLocalServerPreferencesUpdateSchema,
} from "../../../shared/browser/browser-schemas";
import {
  BrowserContactInfoFillInputSchema,
  BrowserContactInfoRemoveInputSchema,
  BrowserContactInfoUpsertInputSchema,
  BrowserCredentialCandidateActionInputSchema,
  BrowserCredentialFillInputSchema,
  BrowserCredentialGenerateInputSchema,
  BrowserCredentialGuestCandidateSchema,
  BrowserCredentialListInputSchema,
  BrowserExtensionRemoveInputSchema,
  BrowserHistoryDeleteInputSchema,
  BrowserProfileImportInputSchema,
  BrowserSiteInfoInputSchema,
} from "../../../shared/browser-profile";
import {
  BrowserUseOriginRuleUpdateSchema,
  BrowserUsePolicyModesUpdateSchema,
} from "../../../shared/browser-use-policy";

export class BrowserProfileIpcError extends Schema.TaggedError<BrowserProfileIpcError>()(
  "BrowserProfileIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export interface BrowserProfileIpcOptions {
  readonly browserSidebar: BrowserSidebarService;
}

const attempt = <A>(
  operation: string,
  run: () => A | PromiseLike<A>,
): Effect.Effect<A, BrowserProfileIpcError> =>
  Effect.tryPromise({
    try: async () => await run(),
    catch: (cause) => new BrowserProfileIpcError({ operation, cause }),
  });

const ownerForGuest = (
  browserSidebar: BrowserSidebarService,
  event: IpcMainEvent,
): WebContents | null => {
  if (!browserSidebar.isAuthorizedGuestWebContents(event.sender.id)) return null;
  const owner = event.sender.hostWebContents;
  if (!owner) return null;
  if (browserSidebar.getOwnerWebContentsIdForGuest(event.sender.id) !== owner.id) return null;
  return owner;
};

export const live = (
  options: BrowserProfileIpcOptions,
): Layer.Layer<
  never,
  never,
  | BrowserProfileRuntime
  | ElectronDesktop
  | ElectronIpc
  | ElectronWindowHost
  | MainConfig
  | WindowSessionCatalog
> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const browserProfile = yield* BrowserProfileRuntime;
      const desktop = yield* ElectronDesktop;
      const ipc = yield* ElectronIpc;
      const windows = yield* ElectronWindowHost;
      const config = yield* MainConfig;
      const windowSessions = yield* WindowSessionCatalog;
      const { browserSidebar } = options;
      const { download, services } = browserProfile;

      const trusted = (event: IpcMainInvokeEvent, capabilityName: string) =>
        attempt("authorize-renderer", () =>
          requireTrustedAppRendererSender(event, capabilityName, config.rendererUrl),
        );
      const requireViewScope = (senderId: number, browserViewScopeId: string) =>
        windowSessions.resolveForWebContents(senderId).pipe(
          Effect.flatMap((expectedScopeId) =>
            expectedScopeId === browserViewScopeId
              ? Effect.void
              : Effect.fail(
                  new BrowserProfileIpcError({
                    operation: "authorize-browser-view-scope",
                    cause: new Error("Browser view scope does not belong to the requesting window"),
                  }),
                ),
          ),
        );
      const parse = <A>(operation: string, run: () => A) => attempt(operation, run);

      yield* ipc.handle("browser-downloads-list", (event) =>
        trusted(event, "Browser download history").pipe(
          Effect.andThen(attempt("read-download-history", () => download.snapshot())),
        ),
      );
      yield* ipc.handle("browser-download-action", (event, rawRequest: unknown) =>
        trusted(event, "Browser download action").pipe(
          Effect.andThen(
            parse("parse-download-action", () =>
              BrowserDownloadActionRequestSchema.parse(rawRequest),
            ),
          ),
          Effect.flatMap((request) =>
            attempt("apply-download-action", () => download.handleAction(request)),
          ),
        ),
      );
      yield* ipc.handle("browser-download-history-clear", (event) =>
        trusted(event, "Browser download history clearing").pipe(
          Effect.andThen(attempt("clear-download-history", () => download.clearHistory())),
          Effect.as({ ok: true as const }),
        ),
      );
      yield* ipc.handle("browser-profile-capabilities", (event) =>
        trusted(event, "Browser Profile capabilities").pipe(
          Effect.andThen(
            attempt("read-browser-profile-capabilities", () => ({
              credentialVault: services.credentialService.capability(),
              contactInfo: services.credentialService.capability(),
              profileImport: services.profileImporter.capability(),
              siteInfo: { available: true as const, provider: "electron-public-api" as const },
              history: { available: true as const, provider: "electron-public-api" as const },
              extensions: services.extensionsProvider.capability(),
            })),
          ),
        ),
      );
      yield* ipc.handle("browser-profile-import-profiles", (event) =>
        trusted(event, "Browser Profile discovery").pipe(
          Effect.andThen(
            attempt("list-importable-profiles", () => services.profileImporter.listProfiles()),
          ),
        ),
      );
      yield* ipc.handle("browser-profile-import", (event, rawInput: unknown) =>
        trusted(event, "Browser Profile import").pipe(
          Effect.andThen(
            parse("parse-profile-import", () => BrowserProfileImportInputSchema.parse(rawInput)),
          ),
          Effect.flatMap((input) =>
            attempt("import-browser-profile", () => services.profileImporter.import(input)),
          ),
        ),
      );
      yield* ipc.handle("browser-credentials-list", (event, rawInput: unknown) =>
        trusted(event, "Browser credential listing").pipe(
          Effect.andThen(
            parse("parse-credential-list", () => BrowserCredentialListInputSchema.parse(rawInput)),
          ),
          Effect.tap((input) => requireViewScope(event.sender.id, input.browserViewScopeId)),
          Effect.flatMap((input) =>
            attempt("list-browser-credentials", () => services.credentialService.listForTab(input)),
          ),
        ),
      );
      yield* ipc.handle("browser-credentials-list-all", (event) =>
        trusted(event, "Browser credential listing").pipe(
          Effect.andThen(
            attempt("list-all-browser-credentials", () => services.credentialService.listAll()),
          ),
        ),
      );
      yield* ipc.handle("browser-credential-fill", (event, rawInput: unknown) =>
        trusted(event, "Browser credential fill").pipe(
          Effect.andThen(
            parse("parse-credential-fill", () => BrowserCredentialFillInputSchema.parse(rawInput)),
          ),
          Effect.tap((input) => requireViewScope(event.sender.id, input.browserViewScopeId)),
          Effect.flatMap((input) =>
            attempt("fill-browser-credential", () => services.credentialService.fill(input)),
          ),
        ),
      );
      yield* ipc.handle("browser-credential-generate-fill", (event, rawInput: unknown) =>
        trusted(event, "Browser password generation").pipe(
          Effect.andThen(
            parse("parse-credential-generation", () =>
              BrowserCredentialGenerateInputSchema.parse(rawInput),
            ),
          ),
          Effect.tap((input) => requireViewScope(event.sender.id, input.browserViewScopeId)),
          Effect.flatMap((input) =>
            attempt("generate-browser-credential", () =>
              services.credentialService.generateAndFill(input),
            ),
          ),
        ),
      );
      yield* ipc.handle("browser-credential-candidate-action", (event, rawInput: unknown) =>
        trusted(event, "Browser credential save").pipe(
          Effect.andThen(
            parse("parse-credential-candidate-action", () =>
              BrowserCredentialCandidateActionInputSchema.parse(rawInput),
            ),
          ),
          Effect.flatMap((input) =>
            attempt("apply-credential-candidate-action", () =>
              services.credentialService.actOnCandidate(event.sender.id, input),
            ),
          ),
        ),
      );
      yield* ipc.handle("browser-credential-remove", (event, credentialId: unknown) =>
        trusted(event, "Browser credential removal").pipe(
          Effect.andThen(
            parse("parse-credential-removal", () =>
              BrowserHistoryDeleteInputSchema.parse({ id: credentialId }),
            ),
          ),
          Effect.flatMap(({ id }) =>
            attempt("remove-browser-credential", () => services.credentialService.remove(id)),
          ),
        ),
      );
      yield* ipc.handle("browser-contact-info-list", (event) =>
        trusted(event, "Browser contact info listing").pipe(
          Effect.andThen(
            attempt("list-browser-contact-info", () =>
              services.credentialService.listContactInfo(),
            ),
          ),
        ),
      );
      yield* ipc.handle("browser-contact-info-upsert", (event, rawInput: unknown) =>
        trusted(event, "Browser contact info save").pipe(
          Effect.andThen(
            parse("parse-contact-info", () => BrowserContactInfoUpsertInputSchema.parse(rawInput)),
          ),
          Effect.flatMap((input) =>
            attempt("save-browser-contact-info", () =>
              services.credentialService.saveContactInfo(input),
            ),
          ),
        ),
      );
      yield* ipc.handle("browser-contact-info-remove", (event, contactInfoId: unknown) =>
        trusted(event, "Browser contact info removal").pipe(
          Effect.andThen(
            parse("parse-contact-info-removal", () =>
              BrowserContactInfoRemoveInputSchema.parse({ contactInfoId }),
            ),
          ),
          Effect.flatMap((input) =>
            attempt("remove-browser-contact-info", () =>
              services.credentialService.removeContactInfo(input.contactInfoId),
            ),
          ),
        ),
      );
      yield* ipc.handle("browser-contact-info-fill", (event, rawInput: unknown) =>
        trusted(event, "Browser contact info fill").pipe(
          Effect.andThen(
            parse("parse-contact-info-fill", () =>
              BrowserContactInfoFillInputSchema.parse(rawInput),
            ),
          ),
          Effect.tap((input) => requireViewScope(event.sender.id, input.browserViewScopeId)),
          Effect.flatMap((input) =>
            attempt("fill-browser-contact-info", () =>
              services.credentialService.fillContactInfo(input),
            ),
          ),
        ),
      );
      yield* ipc.handle("browser-site-info", (event, rawInput: unknown) =>
        trusted(event, "Browser site information").pipe(
          Effect.andThen(
            parse("parse-site-info", () => BrowserSiteInfoInputSchema.parse(rawInput)),
          ),
          Effect.tap((input) => requireViewScope(event.sender.id, input.browserViewScopeId)),
          Effect.flatMap((input) =>
            attempt("read-browser-site-info", () => services.siteInfoProvider.get(input)),
          ),
        ),
      );
      yield* ipc.handle("browser-extensions-list", (event) =>
        trusted(event, "Browser extensions").pipe(
          Effect.andThen(
            attempt("list-browser-extensions", () => services.extensionsProvider.snapshot()),
          ),
        ),
      );
      yield* ipc.handle("browser-extension-load", (event) =>
        Effect.gen(function* () {
          yield* trusted(event, "Browser extension loading");
          const window = yield* windows.fromWebContents(event.sender);
          const result = yield* attempt("pick-browser-extension", () =>
            window
              ? desktop.dialog.showOpenDialog(window, {
                  title: "Load unpacked Browser extension",
                  properties: ["openDirectory"],
                })
              : desktop.dialog.showOpenDialog({
                  title: "Load unpacked Browser extension",
                  properties: ["openDirectory"],
                }),
          );
          const extensionPath = result.canceled ? undefined : result.filePaths[0];
          if (!extensionPath) return null;
          return yield* attempt("load-browser-extension", () =>
            services.extensionsProvider.load(extensionPath),
          );
        }),
      );
      yield* ipc.handle("browser-extension-remove", (event, extensionId: unknown) =>
        trusted(event, "Browser extension removal").pipe(
          Effect.andThen(
            parse("parse-extension-removal", () =>
              BrowserExtensionRemoveInputSchema.parse({ extensionId }),
            ),
          ),
          Effect.flatMap((input) =>
            attempt("remove-browser-extension", () =>
              services.extensionsProvider.remove(input.extensionId),
            ).pipe(
              Effect.as({ ok: true as const }),
              Effect.catch((error) =>
                Effect.succeed({
                  ok: false as const,
                  message:
                    error.cause instanceof Error
                      ? error.cause.message
                      : "Browser extension removal failed",
                }),
              ),
            ),
          ),
        ),
      );
      yield* ipc.handle("browser-use-policy-get", (event) =>
        trusted(event, "Browser Use policy").pipe(
          Effect.andThen(
            attempt("read-browser-use-policy", () => services.usePolicyStore.snapshot()),
          ),
        ),
      );
      yield* ipc.handle("browser-use-policy-update-modes", (event, rawInput: unknown) =>
        trusted(event, "Browser Use policy update").pipe(
          Effect.andThen(
            parse("parse-browser-use-policy-modes", () =>
              BrowserUsePolicyModesUpdateSchema.parse(rawInput),
            ),
          ),
          Effect.flatMap((input) =>
            attempt("update-browser-use-policy-modes", () =>
              services.usePolicyStore.updateModes(input),
            ),
          ),
        ),
      );
      yield* ipc.handle("browser-use-policy-update-origin-rule", (event, rawInput: unknown) =>
        trusted(event, "Browser Use origin policy update").pipe(
          Effect.andThen(
            parse("parse-browser-use-origin-rule", () =>
              BrowserUseOriginRuleUpdateSchema.parse(rawInput),
            ),
          ),
          Effect.flatMap((input) =>
            attempt("update-browser-use-origin-rule", () =>
              services.usePolicyStore.updateOriginRule(input),
            ),
          ),
        ),
      );
      yield* ipc.handle("browser-local-server-preferences-get", (event) =>
        trusted(event, "Local server preferences").pipe(
          Effect.andThen(
            attempt("read-local-server-preferences", () =>
              services.localServerPreferencesStore.snapshot(),
            ),
          ),
        ),
      );
      yield* ipc.handle("browser-local-server-preferences-update", (event, rawInput: unknown) =>
        trusted(event, "Local server preferences update").pipe(
          Effect.andThen(
            parse("parse-local-server-preferences", () =>
              BrowserLocalServerPreferencesUpdateSchema.parse(rawInput),
            ),
          ),
          Effect.flatMap((input) =>
            attempt("update-local-server-preferences", () =>
              services.localServerPreferencesStore.update(input),
            ),
          ),
          Effect.tap((preferences) =>
            windows.all.pipe(
              Effect.tap((all) =>
                Effect.sync(() =>
                  safeBroadcastToWindows(all, "browser-local-server-preferences-changed", [
                    preferences,
                  ]),
                ),
              ),
            ),
          ),
        ),
      );

      yield* ipc.on("browser-image-drag-started", (event, rawInput: unknown) =>
        Effect.sync(() => {
          if (!ownerForGuest(browserSidebar, event)) return;
          const input = BrowserGuestImageDragStartedSchema.safeParse(rawInput);
          if (!input.success) return;
          browserSidebar.startBrowserImageDrag(event.sender.id, input.data.sourceUrl);
        }),
      );
      yield* ipc.on("browser-image-drag-ended", (event) =>
        Effect.sync(() => {
          if (!browserSidebar.isAuthorizedGuestWebContents(event.sender.id)) return;
          browserSidebar.endBrowserImageDrag(event.sender.id);
        }),
      );
      yield* ipc.on("browser-credential-save-candidate", (event, rawInput: unknown) => {
        const owner = ownerForGuest(browserSidebar, event);
        if (!owner) return Effect.void;
        const input = BrowserCredentialGuestCandidateSchema.safeParse(rawInput);
        if (!input.success) return Effect.void;
        return attempt("capture-guest-credential-candidate", () =>
          services.credentialService.captureGuestCandidate(event.sender.id, input.data),
        ).pipe(
          Effect.tap((candidate) =>
            candidate
              ? Effect.sync(() =>
                  safeSendToWebContents(owner, "browser-credential-save-candidate", [candidate]),
                )
              : Effect.void,
          ),
          Effect.catch(() => Effect.void),
          Effect.asVoid,
        );
      });
      yield* ipc.on("browser-annotation-selection", (event, rawInput: unknown) =>
        Effect.sync(() => {
          const owner = ownerForGuest(browserSidebar, event);
          if (!owner) return;
          const selection = BrowserAnnotationSelectionEventSchema.safeParse(rawInput);
          if (!selection.success || selection.data.anchor.pageUrl !== event.sender.getURL()) return;
          const identity = browserSidebar.getIdentityForWebContents(event.sender.id);
          if (!identity) return;
          safeSendToWebContents(owner, "browser-annotation-selection", [
            { ...identity, selection: selection.data },
          ]);
        }),
      );
      yield* ipc.on("browser-annotation-anchor-update", (event, rawInput: unknown) =>
        Effect.sync(() => {
          const owner = ownerForGuest(browserSidebar, event);
          if (!owner) return;
          const update = BrowserAnnotationAnchorUpdateEventSchema.safeParse(rawInput);
          if (!update.success || update.data.anchor.pageUrl !== event.sender.getURL()) return;
          const identity = browserSidebar.getIdentityForWebContents(event.sender.id);
          if (!identity) return;
          safeSendToWebContents(owner, "browser-annotation-anchor-update", [
            { ...identity, update: update.data },
          ]);
        }),
      );
      yield* ipc.on("browser-navigation-button", (event, rawDirection: unknown) => {
        const owner = ownerForGuest(browserSidebar, event);
        const identity = browserSidebar.getIdentityForWebContents(event.sender.id);
        const direction =
          rawDirection === "back" ? "go-back" : rawDirection === "forward" ? "go-forward" : null;
        if (!owner || !identity || !direction) return Effect.void;
        return attempt("apply-guest-navigation", () =>
          browserSidebar.handleCommand(
            { type: direction, ...identity },
            { ownerWebContentsId: owner.id },
          ),
        ).pipe(
          Effect.catch(() => Effect.void),
          Effect.asVoid,
        );
      });
    }),
  );
