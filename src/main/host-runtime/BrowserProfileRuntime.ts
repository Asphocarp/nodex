import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { BROWSER_SIDEBAR_PARTITION } from "../../shared/browser-sidebar";
import type { BrowserDownloadsSnapshot } from "../../shared/browser-download";
import type { BrowserSidebarService } from "../browser-sidebar-service";
import {
  makeBrowserDownloadRuntime,
  makeBrowserDownloadSidebarPort,
  type BrowserDownloadRuntime,
} from "../browser/browser-download-service";
import {
  makeBrowserCredentialRuntime,
  type BrowserCredentialRuntime,
} from "../browser/browser-credential-service";
import { BrowserCredentialVault } from "../browser/browser-credential-vault";
import {
  makeBrowserExtensionsRuntime,
  type BrowserExtensionsRuntime,
} from "../browser/browser-extensions-provider";
import {
  makeBrowserLocalServerPreferencesRuntime,
  type BrowserLocalServerPreferencesRuntime,
} from "../browser/browser-local-server-preferences";
import {
  BrowserProfileHelperPlatform,
  resolveBrowserProfileHelperExecutable,
} from "../browser/browser-profile-helper-client";
import {
  makeBrowserProfileImportRuntime,
  type BrowserProfileImportRuntime,
} from "../browser/browser-profile-importer";
import {
  makeBrowserSiteInfoRuntime,
  type BrowserSiteInfoRuntime,
} from "../browser/browser-site-info-provider";
import {
  makeBrowserUsePolicyRuntime,
  type BrowserUsePolicyRuntime,
} from "../browser-use/browser-use-policy-store";
import {
  makeSiteStatusPolicyPromiseAdapter,
  makeSiteStatusPolicyRuntime,
} from "../browser-use/site-status-policy-service";
import { ChatGptDesktop } from "../codex-application/ChatGptDesktop";
import { DEFAULT_CHATGPT_BASE_URL } from "../codex/chatgpt-base-url";
import { safeBroadcastToWindows } from "../ipc-safe-send";
import { getLogger } from "../logging/logger";
import { ElectronApp } from "../platform/electron/ElectronApp";
import { ElectronDesktop } from "../platform/electron/ElectronDesktop";
import { ElectronSessionHost } from "../platform/electron/ElectronSessionHost";
import { ElectronWindowHost } from "../platform/electron/ElectronWindowHost";
import { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";

export class BrowserProfileRuntimeError extends Schema.TaggedError<BrowserProfileRuntimeError>()(
  "BrowserProfileRuntimeError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export class BrowserProfileRuntime extends Context.Service<
  BrowserProfileRuntime,
  {
    readonly download: BrowserDownloadRuntime;
    readonly credentials: BrowserCredentialRuntime;
    readonly extensions: BrowserExtensionsRuntime;
    readonly localServerPreferences: BrowserLocalServerPreferencesRuntime;
    readonly policy: BrowserUsePolicyRuntime;
    readonly profileImport: BrowserProfileImportRuntime;
    readonly siteInfo: BrowserSiteInfoRuntime;
  }
>()("nodex/main/host-runtime/BrowserProfileRuntime") {}

export interface BrowserProfileRuntimeOptions {
  readonly browserSidebar: BrowserSidebarService;
  readonly environment: Readonly<Record<string, string>>;
  readonly homeDirectory: string;
  readonly isPackaged: boolean;
  readonly nodexHome: string;
  readonly projectRootPath: string;
  readonly platform: string;
  readonly resourcesPath: string;
  readonly userDataPath: string;
}

const downloadKey = (input: {
  readonly browserConversationId: string;
  readonly browserViewScopeId: string;
  readonly browserTabId: string;
}) => `${input.browserConversationId}\0${input.browserViewScopeId}\0${input.browserTabId}`;

const projectDownloadState = (
  browserSidebar: BrowserSidebarService,
  snapshot: BrowserDownloadsSnapshot,
): void => {
  const activeDownloadKeys = new Set(
    snapshot.downloads
      .filter(
        (download) =>
          download.status === "starting" ||
          download.status === "progressing" ||
          download.status === "paused",
      )
      .map(downloadKey),
  );
  for (const tab of browserSidebar.getStateSnapshot().tabs) {
    browserSidebar.setDownloadActive(tab, activeDownloadKeys.has(downloadKey(tab)));
  }
};

export const live = (
  options: BrowserProfileRuntimeOptions,
): Layer.Layer<
  BrowserProfileRuntime,
  BrowserProfileRuntimeError,
  | FileSystem.FileSystem
  | BrowserProfileHelperPlatform
  | ChatGptDesktop
  | ElectronApp
  | ElectronDesktop
  | ElectronSessionHost
  | ElectronWindowHost
  | ScopedCallbackRuntime
> =>
  Layer.effect(
    BrowserProfileRuntime,
    Effect.gen(function* () {
      const app = yield* ElectronApp;
      const callbacks = yield* ScopedCallbackRuntime;
      const chatGpt = yield* ChatGptDesktop;
      const desktop = yield* ElectronDesktop;
      const profileHelperPlatform = yield* BrowserProfileHelperPlatform;
      const sessions = yield* ElectronSessionHost;
      const windows = yield* ElectronWindowHost;
      const downloadsPath = yield* app.downloadsPath;
      const browserSession = yield* sessions.fromPartition(BROWSER_SIDEBAR_PARTITION);
      const logger = getLogger({ component: "browser-profile-runtime" });
      const policy = yield* makeBrowserUsePolicyRuntime(
        `${options.nodexHome}/agent/browser/config.toml`,
      ).pipe(
        Effect.mapError(
          (cause) => new BrowserProfileRuntimeError({ operation: "initialize-policy", cause }),
        ),
      );
      const credentialVault = new BrowserCredentialVault({
        filePath: `${options.nodexHome}/secrets/browser-credentials.v1.json`,
        encryption: {
          isAvailable: () => desktop.safeStorage.isEncryptionAvailable(),
          encryptString: (plaintext) => desktop.safeStorage.encryptString(plaintext),
          decryptString: (ciphertext) => desktop.safeStorage.decryptString(ciphertext),
        },
      });
      const credentials = yield* makeBrowserCredentialRuntime({
        vault: credentialVault,
        resolveGuest: (identity) => options.browserSidebar.getWebContentsForTab(identity),
        resolveGuestIdentity: (webContentsId) =>
          options.browserSidebar.getIdentityForWebContents(webContentsId),
        resolveGuestOwner: (webContentsId) =>
          options.browserSidebar.getOwnerWebContentsIdForGuest(webContentsId),
      });
      const localServerPreferences = yield* makeBrowserLocalServerPreferencesRuntime(
        `${options.userDataPath}/browser-local-server-preferences.json`,
      ).pipe(
        Effect.mapError(
          (cause) =>
            new BrowserProfileRuntimeError({
              operation: "initialize-local-server-preferences",
              cause,
            }),
        ),
      );
      const profileHelper = profileHelperPlatform.make({
        executablePath: resolveBrowserProfileHelperExecutable({
          environment: options.environment,
          isPackaged: options.isPackaged,
          resourcesPath: options.resourcesPath,
          repositoryRoot: options.projectRootPath,
        }),
      });
      const profileImport = yield* makeBrowserProfileImportRuntime({
        cookieStore: browserSession.cookies,
        credentials,
        helper: profileHelper,
        homeDirectory: options.homeDirectory,
        platform: options.platform,
      });
      const extensions = makeBrowserExtensionsRuntime(browserSession.extensions ?? null);
      const siteInfo = makeBrowserSiteInfoRuntime(options.browserSidebar, browserSession.cookies);
      const siteStatusRuntime = yield* makeSiteStatusPolicyRuntime({
        apiBaseUrl: DEFAULT_CHATGPT_BASE_URL,
        logger,
        request: chatGpt.request,
      });
      const siteStatusPolicy = makeSiteStatusPolicyPromiseAdapter(siteStatusRuntime, callbacks);
      options.browserSidebar.setSiteStatusPolicy(siteStatusPolicy);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => options.browserSidebar.setSiteStatusPolicy(null)),
      );

      const download = yield* makeBrowserDownloadRuntime({
        downloadsDirectory: downloadsPath,
        historyFilePath: `${options.userDataPath}/browser-downloads.json`,
        isAgentControlled: (identity) => options.browserSidebar.isBrowserUseIdentity(identity),
        logger,
        onSnapshot: (snapshot) => {
          projectDownloadState(options.browserSidebar, snapshot);
          callbacks.fork(
            windows.all.pipe(
              Effect.tap((all) =>
                Effect.sync(() =>
                  safeBroadcastToWindows(all, "browser-downloads-state", [snapshot]),
                ),
              ),
              Effect.asVoid,
            ),
          );
        },
        resolveIdentity: (webContentsId) =>
          options.browserSidebar.getIdentityForWebContents(webContentsId),
        session: browserSession,
        shell: desktop.shell,
      }).pipe(
        Effect.mapError(
          (cause) => new BrowserProfileRuntimeError({ operation: "initialize-downloads", cause }),
        ),
      );
      options.browserSidebar.setDownloadService(
        makeBrowserDownloadSidebarPort(download, callbacks),
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => options.browserSidebar.setDownloadService(null)),
      );
      return BrowserProfileRuntime.of({
        credentials,
        download,
        extensions,
        localServerPreferences,
        policy,
        profileImport,
        siteInfo,
      });
    }),
  );
