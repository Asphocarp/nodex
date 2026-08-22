import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { BrowserSidebarService } from "../browser-sidebar-service";
import { FileBrowserHistoryStore } from "../browser/browser-history-store";
import {
  makeBrowserLocalServerThumbnailRuntime,
  type BrowserLocalServerThumbnailRuntime,
} from "../browser/browser-local-server-thumbnail";
import { FileBrowserPageSnapshotStore } from "../browser/browser-page-store";
import { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";

export class BrowserSidebarRuntime extends Context.Service<
  BrowserSidebarRuntime,
  {
    readonly browser: BrowserSidebarService;
    readonly localServerThumbnail: BrowserLocalServerThumbnailRuntime;
  }
>()("nodex/main/host-runtime/BrowserSidebarRuntime") {}

export const live = (
  userDataPath: string,
): Layer.Layer<BrowserSidebarRuntime, never, ScopedCallbackRuntime> =>
  Layer.effect(
    BrowserSidebarRuntime,
    Effect.gen(function* () {
      const callbacks = yield* ScopedCallbackRuntime;
      const localServerThumbnail = yield* makeBrowserLocalServerThumbnailRuntime();
      const browser = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new BrowserSidebarService({
              invalidateLocalServerThumbnail: (url) => {
                callbacks.fork(localServerThumbnail.invalidate(url));
              },
              historyStore: new FileBrowserHistoryStore({
                filePath: `${userDataPath}/browser-history.json`,
              }),
              pageStore: new FileBrowserPageSnapshotStore({
                filePath: `${userDataPath}/browser-sidebar-page-states.json`,
              }),
            }),
        ),
        (service) => Effect.sync(() => service.dispose()),
      );
      return BrowserSidebarRuntime.of({ browser, localServerThumbnail });
    }),
  );
