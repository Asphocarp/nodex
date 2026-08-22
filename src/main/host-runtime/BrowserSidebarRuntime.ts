import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { BrowserSidebarService } from "../browser-sidebar-service";
import {
  makeBrowserHistoryRuntime,
  type BrowserHistoryRuntime,
  type BrowserHistoryStore,
} from "../browser/browser-history-store";
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

export class BrowserSidebarRuntime extends Context.Service<
  BrowserSidebarRuntime,
  {
    readonly browser: BrowserSidebarService;
    readonly history: BrowserHistoryRuntime;
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
  FileSystem.FileSystem | ScopedCallbackRuntime
> =>
  Layer.effect(
    BrowserSidebarRuntime,
    Effect.gen(function* () {
      const callbacks = yield* ScopedCallbackRuntime;
      const localServerThumbnail = yield* makeBrowserLocalServerThumbnailRuntime();
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
      const browser = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new BrowserSidebarService({
              invalidateLocalServerThumbnail: (url) => {
                callbacks.fork(localServerThumbnail.invalidate(url));
              },
              historyStore,
              pageStore,
            }),
        ),
        (service) => Effect.sync(() => service.dispose()),
      );
      return BrowserSidebarRuntime.of({ browser, history, localServerThumbnail, pages });
    }),
  );
