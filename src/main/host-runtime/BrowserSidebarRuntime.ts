import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { BrowserSidebarService } from "../browser-sidebar-service";
import { FileBrowserHistoryStore } from "../browser/browser-history-store";
import { FileBrowserPageSnapshotStore } from "../browser/browser-page-store";

export class BrowserSidebarRuntime extends Context.Service<
  BrowserSidebarRuntime,
  { readonly browser: BrowserSidebarService }
>()("nodex/main/host-runtime/BrowserSidebarRuntime") {}

export const live = (userDataPath: string): Layer.Layer<BrowserSidebarRuntime> =>
  Layer.effect(
    BrowserSidebarRuntime,
    Effect.acquireRelease(
      Effect.sync(
        () =>
          new BrowserSidebarService({
            historyStore: new FileBrowserHistoryStore({
              filePath: `${userDataPath}/browser-history.json`,
            }),
            pageStore: new FileBrowserPageSnapshotStore({
              filePath: `${userDataPath}/browser-sidebar-page-states.json`,
            }),
          }),
      ),
      (browser) => Effect.sync(() => browser.dispose()),
    ).pipe(Effect.map((browser) => BrowserSidebarRuntime.of({ browser }))),
  );
