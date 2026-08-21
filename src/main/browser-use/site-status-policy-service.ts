import { z } from "zod";
import {
  requestChatGptDesktop,
  type ChatGptDesktopRequestDependencies,
} from "../codex/chatgpt-desktop-request";

export const BROWSER_USE_SITE_STATUS_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

const SiteStatusResponseSchema = z.strictObject({
  feature_status: z.record(z.string(), z.boolean()),
});

interface SiteStatusLogger {
  warn: (message: string, fields?: Record<string, unknown>) => void;
}

export interface SiteStatusPolicyService {
  cachedCommentModeBlocked(url: string): boolean | null;
  isCommentModeBlocked(url: string): Promise<boolean>;
}

export interface SiteStatusPolicyServiceDependencies extends ChatGptDesktopRequestDependencies {
  apiBaseUrl: string;
  logger: SiteStatusLogger;
  now?: () => number;
}

interface SiteStatusCacheEntry {
  blocked: boolean;
  timestampMs: number;
}

function commentModeCacheKey(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }

    const hostname = parsedUrl.hostname.trim().toLowerCase();
    if (hostname.length === 0) return null;
    return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  } catch {
    return null;
  }
}

function siteStatusPath(url: string): string {
  return `/aura/site_status?${new URLSearchParams({
    site_url: url,
  }).toString()}`;
}

export class BrowserUseSiteStatusPolicyService implements SiteStatusPolicyService {
  private readonly cache = new Map<string, SiteStatusCacheEntry>();
  private readonly inflight = new Map<string, Promise<boolean>>();
  private readonly now: () => number;

  constructor(private readonly deps: SiteStatusPolicyServiceDependencies) {
    this.now = deps.now ?? Date.now;
  }

  cachedCommentModeBlocked(url: string): boolean | null {
    const cacheKey = commentModeCacheKey(url);
    if (!cacheKey) return false;

    const cached = this.cache.get(cacheKey);
    if (!cached) return null;
    if (this.now() - cached.timestampMs < BROWSER_USE_SITE_STATUS_CACHE_TTL_MS) {
      return cached.blocked;
    }

    this.cache.delete(cacheKey);
    return null;
  }

  async isCommentModeBlocked(url: string): Promise<boolean> {
    const cached = this.cachedCommentModeBlocked(url);
    if (cached !== null) return cached;

    const cacheKey = commentModeCacheKey(url);
    if (!cacheKey) return false;

    const existing = this.inflight.get(cacheKey);
    if (existing) return await existing;

    const request = this.loadAndCache(url, cacheKey).finally(() => {
      if (this.inflight.get(cacheKey) === request) {
        this.inflight.delete(cacheKey);
      }
    });
    this.inflight.set(cacheKey, request);
    return await request;
  }

  private async loadAndCache(url: string, cacheKey: string): Promise<boolean> {
    try {
      const response = await requestChatGptDesktop(this.deps, {
        action: "load browser site status",
        baseUrl: this.deps.apiBaseUrl,
        path: siteStatusPath(url),
        method: "GET",
        refreshOn401: true,
      });
      if (!response.ok) {
        this.deps.logger.warn("Browser sidebar comment mode site status request failed", {
          code: "site-status-http-error",
          status: response.status,
        });
        return false;
      }

      const body = SiteStatusResponseSchema.safeParse(JSON.parse(await response.text()));
      if (!body.success) {
        this.deps.logger.warn("Browser sidebar comment mode site status response was invalid", {
          code: "site-status-invalid-response",
        });
        return false;
      }

      const blocked = body.data.feature_status.agent === true;
      this.cache.set(cacheKey, {
        blocked,
        timestampMs: this.now(),
      });
      return blocked;
    } catch {
      this.deps.logger.warn("Failed to load browser sidebar comment mode site status", {
        code: "site-status-request-failed",
      });
      return false;
    }
  }
}
