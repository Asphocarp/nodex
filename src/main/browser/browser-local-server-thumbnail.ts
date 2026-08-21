import * as Cache from "effect/Cache";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FiberSet from "effect/FiberSet";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import { BrowserWindow, type BrowserWindowConstructorOptions, type NativeImage } from "electron";
import {
  BROWSER_SIDEBAR_PARTITION,
  type BrowserSidebarLocalServerThumbnailResult,
} from "../../shared/browser-sidebar";

const THUMBNAIL_CAPTURE_WIDTH = 336;
const THUMBNAIL_CAPTURE_HEIGHT = 208;
const THUMBNAIL_OUTPUT_WIDTH = 168;
const THUMBNAIL_OUTPUT_HEIGHT = 104;
const THUMBNAIL_CAPTURE_TIMEOUT = Duration.seconds(8);
const THUMBNAIL_CACHE_TTL = Duration.seconds(30);
const THUMBNAIL_FAILURE_TTL = Duration.seconds(5);
const MAX_THUMBNAIL_CACHE_ENTRIES = 64;
const MAX_THUMBNAIL_DATA_URL_LENGTH = 512 * 1_024;

export interface BrowserLocalServerThumbnailRuntime {
  readonly get: (rawUrl: string) => Effect.Effect<BrowserSidebarLocalServerThumbnailResult>;
  readonly invalidate: (rawUrl?: string) => Effect.Effect<void>;
}

export interface BrowserLocalServerThumbnailRuntimeOptions {
  readonly capture?: (
    url: string,
  ) => Effect.Effect<string, BrowserLocalServerThumbnailCaptureError>;
  readonly maxConcurrency?: number;
}

export class BrowserLocalServerThumbnailCaptureError extends Schema.TaggedError<BrowserLocalServerThumbnailCaptureError>()(
  "BrowserLocalServerThumbnailCaptureError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

const captureError = (operation: string, cause: unknown): BrowserLocalServerThumbnailCaptureError =>
  new BrowserLocalServerThumbnailCaptureError({ operation, cause });

const isLocalHostname = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(normalized);
  return Boolean(match && match.slice(1).every((octet) => Number.parseInt(octet, 10) <= 255));
};

export const normalizeLocalServerThumbnailUrl = (rawUrl: string): string | null => {
  if (!rawUrl || rawUrl.length > 16_384) return null;
  try {
    const url = new URL(rawUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      !isLocalHostname(url.hostname)
    ) {
      return null;
    }
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
};

const createThumbnailWindowOptions = (): BrowserWindowConstructorOptions => ({
  show: false,
  useContentSize: true,
  width: THUMBNAIL_CAPTURE_WIDTH,
  height: THUMBNAIL_CAPTURE_HEIGHT,
  backgroundColor: "#ffffff",
  webPreferences: {
    partition: BROWSER_SIDEBAR_PARTITION,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    backgroundThrottling: false,
    devTools: false,
  },
});

const imageToBoundedDataUrl = (image: NativeImage): string => {
  const resized = image.resize({
    width: THUMBNAIL_OUTPUT_WIDTH,
    height: THUMBNAIL_OUTPUT_HEIGHT,
    quality: "good",
  });
  const dataUrl = resized.toDataURL();
  if (
    !dataUrl.startsWith("data:image/png;base64,") ||
    dataUrl.length > MAX_THUMBNAIL_DATA_URL_LENGTH
  ) {
    throw new TypeError("Local server preview exceeded its image budget");
  }
  return dataUrl;
};

const timeout = <A>(
  effect: Effect.Effect<A, BrowserLocalServerThumbnailCaptureError>,
): Effect.Effect<A, BrowserLocalServerThumbnailCaptureError> =>
  effect.pipe(
    Effect.timeoutOrElse({
      duration: THUMBNAIL_CAPTURE_TIMEOUT,
      orElse: () =>
        Effect.fail(captureError("timeout", new Error("Local server preview capture timed out"))),
    }),
  );

const captureElectronLocalServerThumbnail = (
  url: string,
): Effect.Effect<string, BrowserLocalServerThumbnailCaptureError> =>
  Effect.acquireUseRelease(
    Effect.try({
      try: () => {
        const window = new BrowserWindow(createThumbnailWindowOptions());
        const contents = window.webContents;
        const preventUnsafeNavigation = (event: { preventDefault(): void }, targetUrl: string) => {
          if (normalizeLocalServerThumbnailUrl(targetUrl)) return;
          event.preventDefault();
        };
        contents.setAudioMuted(true);
        contents.setWindowOpenHandler(() => ({ action: "deny" }));
        contents.on("will-navigate", preventUnsafeNavigation);
        contents.on("will-redirect", preventUnsafeNavigation);
        return { contents, preventUnsafeNavigation, window };
      },
      catch: (cause) => captureError("create-window", cause),
    }),
    ({ contents, window }) =>
      Effect.gen(function* () {
        yield* timeout(
          Effect.tryPromise({
            try: () => window.loadURL(url),
            catch: (cause) => captureError("load", cause),
          }),
        );
        if (window.isDestroyed() || contents.isDestroyed()) {
          return yield* Effect.fail(
            captureError("capture", new Error("Local server preview closed before capture")),
          );
        }
        const image = yield* timeout(
          Effect.tryPromise({
            try: () =>
              contents.capturePage({
                x: 0,
                y: 0,
                width: THUMBNAIL_CAPTURE_WIDTH,
                height: THUMBNAIL_CAPTURE_HEIGHT,
              }),
            catch: (cause) => captureError("capture", cause),
          }),
        );
        return yield* Effect.try({
          try: () => imageToBoundedDataUrl(image),
          catch: (cause) => captureError("encode", cause),
        });
      }),
    ({ contents, preventUnsafeNavigation, window }) =>
      Effect.sync(() => {
        contents.removeListener("will-navigate", preventUnsafeNavigation);
        contents.removeListener("will-redirect", preventUnsafeNavigation);
        if (!window.isDestroyed()) window.destroy();
      }),
  );

const isBoundedThumbnail = (value: string): boolean =>
  value.startsWith("data:image/png;base64,") && value.length <= MAX_THUMBNAIL_DATA_URL_LENGTH;

export const makeBrowserLocalServerThumbnailRuntime = (
  options: BrowserLocalServerThumbnailRuntimeOptions = {},
): Effect.Effect<BrowserLocalServerThumbnailRuntime, never, Scope.Scope> =>
  Effect.gen(function* () {
    const capture = options.capture ?? captureElectronLocalServerThumbnail;
    const permits = yield* Semaphore.make(
      Math.max(1, Math.min(4, Math.floor(options.maxConcurrency ?? 2))),
    );
    const captures = yield* FiberSet.make<string, BrowserLocalServerThumbnailCaptureError>();
    const cache = yield* Cache.makeWith<string, BrowserSidebarLocalServerThumbnailResult>(
      (url: string) =>
        FiberSet.run(
          captures,
          // Do not create the BrowserWindow until FiberSet.run has registered
          // the capture, so an immediately closing Browser Scope can see and
          // interrupt every admitted native resource.
          Effect.yieldNow.pipe(Effect.andThen(permits.withPermits(1)(capture(url)))),
        ).pipe(
          Effect.flatMap(Fiber.join),
          Effect.flatMap((dataUrl) =>
            Effect.succeed(dataUrl).pipe(
              Effect.filterOrFail(isBoundedThumbnail, () =>
                captureError(
                  "validate-image",
                  new TypeError("Local server preview exceeded its image budget"),
                ),
              ),
            ),
          ),
          Effect.flatMap((dataUrl) =>
            Clock.currentTimeMillis.pipe(
              Effect.map(
                (capturedAt) =>
                  ({
                    status: "ready",
                    dataUrl,
                    capturedAt,
                  }) satisfies BrowserSidebarLocalServerThumbnailResult,
              ),
            ),
          ),
          Effect.catch(() =>
            Effect.succeed({
              status: "unavailable",
              message: "Local server preview is unavailable",
            } satisfies BrowserSidebarLocalServerThumbnailResult),
          ),
        ),
      {
        capacity: MAX_THUMBNAIL_CACHE_ENTRIES,
        timeToLive: (exit) =>
          Exit.isSuccess(exit) && exit.value.status === "ready"
            ? THUMBNAIL_CACHE_TTL
            : THUMBNAIL_FAILURE_TTL,
      },
    );
    yield* Effect.addFinalizer(() => Cache.invalidateAll(cache));

    return {
      get: (rawUrl) => {
        const url = normalizeLocalServerThumbnailUrl(rawUrl);
        return url === null
          ? Effect.succeed({
              status: "unavailable",
              message: "Local server preview URL is not allowed",
            })
          : Cache.get(cache, url);
      },
      invalidate: (rawUrl) => {
        if (rawUrl === undefined) return Cache.invalidateAll(cache);
        const url = normalizeLocalServerThumbnailUrl(rawUrl);
        return url === null ? Effect.void : Cache.invalidate(cache, url);
      },
    } satisfies BrowserLocalServerThumbnailRuntime;
  });
