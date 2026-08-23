import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { BrowserSidebarTabSnapshot } from "../../shared/browser-sidebar";
import { BrowserSidebarService } from "../browser-sidebar-service";
import {
  makeBrowserHistoryRuntime,
  type BrowserHistoryRuntime,
  type BrowserHistoryStore,
} from "../browser/browser-history-store";
import {
  makeBrowserLocalServerRuntime,
  type BrowserLocalServerRuntime,
} from "../browser/browser-local-server-runtime";
import {
  makeBrowserLocalServerThumbnailRuntime,
  type BrowserLocalServerThumbnailRuntime,
} from "../browser/browser-local-server-thumbnail";
import {
  makeBrowserPageRuntime,
  type BrowserPageRuntime,
  type BrowserPageSnapshotStore,
} from "../browser/browser-page-store";
import { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import {
  make as makeBrowserSidebarEventHub,
  type BrowserSidebarEventHubService,
} from "../browser/BrowserSidebarEventHub";
import { makeBrowserRuntimeRegistry } from "../browser/browser-runtime-registry";
import { makeBrowserWebContentsListenerRuntime } from "../browser/BrowserWebContentsListenerRuntime";
import { makeBrowserEarlyPageRestoreRuntime } from "../browser/BrowserEarlyPageRestoreRuntime";
import {
  makeBrowserPageEmulationElectronPort,
  makeBrowserPageEmulationRuntime,
} from "../browser/browser-page-emulation";
import { ElectronNet } from "../platform/electron/ElectronNet";
import { BrowserSiteStatusRuntime } from "./BrowserSiteStatusRuntime";

export class BrowserSidebarRuntime extends Context.Service<
  BrowserSidebarRuntime,
  {
    readonly browser: BrowserSidebarService;
    readonly events: BrowserSidebarEventHubService;
    readonly history: BrowserHistoryRuntime;
    readonly localServers: BrowserLocalServerRuntime;
    readonly localServerThumbnail: BrowserLocalServerThumbnailRuntime;
    readonly pages: BrowserPageRuntime;
  }
>()("nodex/main/host-runtime/BrowserSidebarRuntime") {}

export class BrowserSidebarRuntimeError extends Schema.TaggedError<BrowserSidebarRuntimeError>()(
  "BrowserSidebarRuntimeError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export const live = (
  userDataPath: string,
): Layer.Layer<
  BrowserSidebarRuntime,
  BrowserSidebarRuntimeError,
  BrowserSiteStatusRuntime | ElectronNet | FileSystem.FileSystem | ScopedCallbackRuntime
> =>
  Layer.effect(
    BrowserSidebarRuntime,
    Effect.gen(function* () {
      const callbacks = yield* ScopedCallbackRuntime;
      const siteStatus = yield* BrowserSiteStatusRuntime;
      const electronNet = yield* ElectronNet;
      const events = yield* makeBrowserSidebarEventHub;
      const earlyPageRestores =
        yield* makeBrowserEarlyPageRestoreRuntime<BrowserSidebarTabSnapshot>();
      const pageEmulation = yield* makeBrowserPageEmulationRuntime;
      const pageEmulationPort = makeBrowserPageEmulationElectronPort(pageEmulation, callbacks);
      const runtimeRegistry = makeBrowserRuntimeRegistry();
      const webContentsListeners = yield* makeBrowserWebContentsListenerRuntime;
      const localServerThumbnail = yield* makeBrowserLocalServerThumbnailRuntime();
      const localServers = yield* makeBrowserLocalServerRuntime({
        fetch: electronNet.fetch,
        invalidateThumbnail: localServerThumbnail.invalidate,
      });
      const history = yield* makeBrowserHistoryRuntime(`${userDataPath}/browser-history.json`).pipe(
        Effect.mapError(
          (cause) => new BrowserSidebarRuntimeError({ operation: "initialize-history", cause }),
        ),
      );
      const pages = yield* makeBrowserPageRuntime(
        `${userDataPath}/browser-sidebar-page-states.json`,
      ).pipe(
        Effect.mapError(
          (cause) => new BrowserSidebarRuntimeError({ operation: "initialize-pages", cause }),
        ),
      );
      const historyStore: BrowserHistoryStore = {
        clear: () => callbacks.runPromise(history.clear),
        delete: (id) => callbacks.runPromise(history.delete(id)),
        list: (input) => callbacks.runPromise(history.list(input)),
        record: (input) => callbacks.runPromise(history.record(input)),
      };
      const pageStore: BrowserPageSnapshotStore = {
        clear: () => callbacks.runPromise(pages.clear),
        delete: (browserStorageId) => callbacks.runPromise(pages.delete(browserStorageId)),
        get: (browserStorageId) => callbacks.runPromise(pages.get(browserStorageId)),
        reassociate: (sourceStorageId, targetStorageId) =>
          callbacks.runPromise(pages.reassociate(sourceStorageId, targetStorageId)),
        set: (page) => callbacks.runPromise(pages.set(page)),
      };
      const browser = new BrowserSidebarService({
        earlyPageRestores,
        events,
        historyStore,
        pageEmulation: pageEmulationPort,
        pageStore,
        runtimeRegistry,
        siteStatus,
        webContentsListeners,
      });
      return BrowserSidebarRuntime.of({
        browser,
        events,
        history,
        localServers,
        localServerThumbnail,
        pages,
      });
    }),
  );
