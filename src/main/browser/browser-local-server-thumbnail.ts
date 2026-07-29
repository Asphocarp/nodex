import {
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  type NativeImage,
} from "electron";
import {
  BROWSER_SIDEBAR_PARTITION,
  type BrowserSidebarLocalServerThumbnailResult,
} from "../../shared/browser-sidebar";

const THUMBNAIL_CAPTURE_WIDTH = 336;
const THUMBNAIL_CAPTURE_HEIGHT = 208;
const THUMBNAIL_OUTPUT_WIDTH = 168;
const THUMBNAIL_OUTPUT_HEIGHT = 104;
const THUMBNAIL_CAPTURE_TIMEOUT_MS = 8_000;
const THUMBNAIL_CACHE_TTL_MS = 30_000;
const THUMBNAIL_FAILURE_TTL_MS = 5_000;
const MAX_THUMBNAIL_CACHE_ENTRIES = 64;
const MAX_THUMBNAIL_DATA_URL_LENGTH = 512 * 1024;

interface BrowserLocalServerThumbnailCapture {
  (url: string): Promise<string>;
}

interface BrowserLocalServerThumbnailServiceOptions {
  capture?: BrowserLocalServerThumbnailCapture;
  maxConcurrency?: number;
  now?: () => number;
}

interface BrowserLocalServerThumbnailCacheEntry {
  dataUrl: string | null;
  expiresAt: number;
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(normalized);
  return Boolean(
    match
    && match.slice(1).every((octet) => Number.parseInt(octet, 10) <= 255),
  );
}

export function normalizeLocalServerThumbnailUrl(rawUrl: string): string | null {
  if (!rawUrl || rawUrl.length > 16_384) return null;
  try {
    const url = new URL(rawUrl);
    if (
      !["http:", "https:"].includes(url.protocol)
      || url.username.length > 0
      || url.password.length > 0
      || !isLocalHostname(url.hostname)
    ) {
      return null;
    }
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function createThumbnailWindowOptions(): BrowserWindowConstructorOptions {
  return {
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
  };
}

async function withTimeout<Value>(
  promise: Promise<Value>,
  timeoutMs: number,
): Promise<Value> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Local server preview timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function imageToBoundedDataUrl(image: NativeImage): string {
  const resized = image.resize({
    width: THUMBNAIL_OUTPUT_WIDTH,
    height: THUMBNAIL_OUTPUT_HEIGHT,
    quality: "good",
  });
  const dataUrl = resized.toDataURL();
  if (
    !dataUrl.startsWith("data:image/png;base64,")
    || dataUrl.length > MAX_THUMBNAIL_DATA_URL_LENGTH
  ) {
    throw new Error("Local server preview exceeded its image budget");
  }
  return dataUrl;
}

async function captureElectronLocalServerThumbnail(url: string): Promise<string> {
  const window = new BrowserWindow(createThumbnailWindowOptions());
  const contents = window.webContents;
  const preventUnsafeNavigation = (
    event: { preventDefault(): void },
    targetUrl: string,
  ) => {
    if (normalizeLocalServerThumbnailUrl(targetUrl)) return;
    event.preventDefault();
  };
  contents.setAudioMuted(true);
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", preventUnsafeNavigation);
  contents.on("will-redirect", preventUnsafeNavigation);

  try {
    await withTimeout(window.loadURL(url), THUMBNAIL_CAPTURE_TIMEOUT_MS);
    if (window.isDestroyed() || contents.isDestroyed()) {
      throw new Error("Local server preview closed before capture");
    }
    const image = await withTimeout(
      contents.capturePage({
        x: 0,
        y: 0,
        width: THUMBNAIL_CAPTURE_WIDTH,
        height: THUMBNAIL_CAPTURE_HEIGHT,
      }),
      THUMBNAIL_CAPTURE_TIMEOUT_MS,
    );
    return imageToBoundedDataUrl(image);
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

export class BrowserLocalServerThumbnailService {
  private readonly cache = new Map<
    string,
    BrowserLocalServerThumbnailCacheEntry
  >();
  private readonly pending = new Map<
    string,
    Promise<BrowserSidebarLocalServerThumbnailResult>
  >();
  private readonly queue: Array<() => void> = [];
  private readonly capture: BrowserLocalServerThumbnailCapture;
  private readonly maxConcurrency: number;
  private readonly now: () => number;
  private activeCaptures = 0;

  constructor(options: BrowserLocalServerThumbnailServiceOptions = {}) {
    this.capture = options.capture ?? captureElectronLocalServerThumbnail;
    this.maxConcurrency = Math.max(
      1,
      Math.min(4, Math.floor(options.maxConcurrency ?? 2)),
    );
    this.now = options.now ?? Date.now;
  }

  async get(rawUrl: string): Promise<BrowserSidebarLocalServerThumbnailResult> {
    const url = normalizeLocalServerThumbnailUrl(rawUrl);
    if (!url) {
      return {
        status: "unavailable",
        message: "Local server preview URL is not allowed",
      };
    }

    const now = this.now();
    const cached = this.cache.get(url);
    if (cached && cached.expiresAt > now) {
      this.touchCacheEntry(url, cached);
      return cached.dataUrl
        ? { status: "ready", dataUrl: cached.dataUrl, capturedAt: now }
        : { status: "unavailable", message: "Local server preview is unavailable" };
    }
    if (cached) this.cache.delete(url);

    const existing = this.pending.get(url);
    if (existing) return await existing;

    const capture = this.enqueue(async () => {
      try {
        const dataUrl = await this.capture(url);
        this.setCacheEntry(url, {
          dataUrl,
          expiresAt: this.now() + THUMBNAIL_CACHE_TTL_MS,
        });
        return {
          status: "ready",
          dataUrl,
          capturedAt: this.now(),
        } satisfies BrowserSidebarLocalServerThumbnailResult;
      } catch {
        this.setCacheEntry(url, {
          dataUrl: null,
          expiresAt: this.now() + THUMBNAIL_FAILURE_TTL_MS,
        });
        return {
          status: "unavailable",
          message: "Local server preview is unavailable",
        } satisfies BrowserSidebarLocalServerThumbnailResult;
      }
    });
    this.pending.set(url, capture);
    try {
      return await capture;
    } finally {
      this.pending.delete(url);
    }
  }

  invalidate(rawUrl?: string): void {
    if (!rawUrl) {
      this.cache.clear();
      return;
    }
    const url = normalizeLocalServerThumbnailUrl(rawUrl);
    if (url) this.cache.delete(url);
  }

  private enqueue<Value>(operation: () => Promise<Value>): Promise<Value> {
    return new Promise<Value>((resolve, reject) => {
      const run = () => {
        this.activeCaptures += 1;
        void operation().then(resolve, reject).finally(() => {
          this.activeCaptures -= 1;
          this.drainQueue();
        });
      };
      this.queue.push(run);
      this.drainQueue();
    });
  }

  private drainQueue(): void {
    while (
      this.activeCaptures < this.maxConcurrency
      && this.queue.length > 0
    ) {
      this.queue.shift()?.();
    }
  }

  private setCacheEntry(
    url: string,
    entry: BrowserLocalServerThumbnailCacheEntry,
  ): void {
    this.cache.delete(url);
    this.cache.set(url, entry);
    while (this.cache.size > MAX_THUMBNAIL_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.cache.delete(oldestKey);
    }
  }

  private touchCacheEntry(
    url: string,
    entry: BrowserLocalServerThumbnailCacheEntry,
  ): void {
    this.cache.delete(url);
    this.cache.set(url, entry);
  }
}
