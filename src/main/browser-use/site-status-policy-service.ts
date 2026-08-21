import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FiberMap from "effect/FiberMap";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { z } from "zod";
import type { ChatGptDesktopError } from "../codex-application/ChatGptDesktop";
import type { ChatGptDesktopRequestInput } from "../codex/chatgpt-desktop-request";

export const BROWSER_USE_SITE_STATUS_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

const SiteStatusResponseSchema = z.strictObject({
  feature_status: z.record(z.string(), z.boolean()),
});

interface SiteStatusLogger {
  readonly warn: (message: string, fields?: Record<string, unknown>) => void;
}

export interface SiteStatusPolicyRuntime {
  readonly cachedCommentModeBlocked: (url: string) => boolean | null;
  readonly isCommentModeBlocked: (url: string) => Effect.Effect<boolean>;
}

export interface SiteStatusPolicyRuntimeDependencies {
  readonly apiBaseUrl: string;
  readonly logger: SiteStatusLogger;
  readonly now?: () => number;
  readonly request: (
    input: ChatGptDesktopRequestInput,
  ) => Effect.Effect<Response, ChatGptDesktopError>;
}

interface SiteStatusCacheEntry {
  readonly blocked: boolean;
  readonly expiresAtMs: number;
}

interface SiteStatusDecision {
  readonly blocked: boolean;
  readonly cache: boolean;
}

type SiteStatusAdmission =
  | { readonly _tag: "Cached"; readonly blocked: boolean }
  | { readonly _tag: "Running"; readonly fiber: Fiber.Fiber<SiteStatusDecision> };

class SiteStatusResponseError extends Schema.TaggedError<SiteStatusResponseError>()(
  "SiteStatusResponseError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

const commentModeCacheKey = (url: string): string | null => {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return null;
    const hostname = parsedUrl.hostname.trim().toLowerCase();
    if (hostname.length === 0) return null;
    return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  } catch {
    return null;
  }
};

const siteStatusPath = (url: string): string =>
  `/aura/site_status?${new URLSearchParams({ site_url: url }).toString()}`;

export const makeSiteStatusPolicyRuntime = (
  deps: SiteStatusPolicyRuntimeDependencies,
): Effect.Effect<SiteStatusPolicyRuntime, never, import("effect/Scope").Scope> =>
  Effect.gen(function* () {
    const now = deps.now ?? Date.now;
    const decisions = yield* Ref.make<ReadonlyMap<string, SiteStatusCacheEntry>>(new Map());
    const inflight = yield* FiberMap.make<string, SiteStatusDecision, never>();
    const admission = yield* Semaphore.make(1);

    const failed = (message: string, fields: Record<string, unknown>): SiteStatusDecision => {
      deps.logger.warn(message, fields);
      return { blocked: false, cache: false };
    };
    const load = (url: string): Effect.Effect<SiteStatusDecision> =>
      deps
        .request({
          action: "load browser site status",
          baseUrl: deps.apiBaseUrl,
          path: siteStatusPath(url),
          method: "GET",
          refreshOn401: true,
        })
        .pipe(
          Effect.flatMap((response) => {
            if (!response.ok) {
              return Effect.succeed(
                failed("Browser sidebar comment mode site status request failed", {
                  code: "site-status-http-error",
                  status: response.status,
                }),
              );
            }
            return Effect.tryPromise({
              try: () => response.text(),
              catch: (cause) => new SiteStatusResponseError({ operation: "read-response", cause }),
            }).pipe(
              Effect.flatMap((text) =>
                Effect.try({
                  try: () => JSON.parse(text) as unknown,
                  catch: (cause) =>
                    new SiteStatusResponseError({ operation: "parse-response", cause }),
                }),
              ),
              Effect.map((body) => {
                const parsed = SiteStatusResponseSchema.safeParse(body);
                if (!parsed.success) {
                  return failed("Browser sidebar comment mode site status response was invalid", {
                    code: "site-status-invalid-response",
                  });
                }
                return {
                  blocked: parsed.data.feature_status.agent === true,
                  cache: true,
                };
              }),
            );
          }),
          Effect.catch(() =>
            Effect.succeed(
              failed("Failed to load browser sidebar comment mode site status", {
                code: "site-status-request-failed",
              }),
            ),
          ),
        );

    const cachedCommentModeBlocked = (url: string): boolean | null => {
      const cacheKey = commentModeCacheKey(url);
      if (cacheKey === null) return false;
      const cached = Ref.getUnsafe(decisions).get(cacheKey);
      return cached !== undefined && cached.expiresAtMs > now() ? cached.blocked : null;
    };

    const isCommentModeBlocked = Effect.fn("SiteStatusPolicyRuntime.isCommentModeBlocked")((
      url: string,
    ) => {
      const cached = cachedCommentModeBlocked(url);
      if (cached !== null) return Effect.succeed(cached);
      const cacheKey = commentModeCacheKey(url);
      if (cacheKey === null) return Effect.succeed(false);
      const admitted: Effect.Effect<SiteStatusAdmission> = admission.withPermits(1)(
        Effect.gen(function* () {
          const latest = Ref.getUnsafe(decisions).get(cacheKey);
          if (latest !== undefined && latest.expiresAtMs > now()) {
            return { _tag: "Cached", blocked: latest.blocked } as const;
          }
          const existing = yield* FiberMap.get(inflight, cacheKey);
          if (Option.isSome(existing)) {
            return { _tag: "Running", fiber: existing.value } as const;
          }
          const fiber = yield* FiberMap.run(inflight, cacheKey, { startImmediately: true })(
            load(url).pipe(
              Effect.tap((decision) =>
                decision.cache
                  ? Ref.update(decisions, (current) =>
                      new Map(current).set(cacheKey, {
                        blocked: decision.blocked,
                        expiresAtMs: now() + BROWSER_USE_SITE_STATUS_CACHE_TTL_MS,
                      }),
                    )
                  : Effect.void,
              ),
            ),
          );
          return { _tag: "Running", fiber } as const;
        }),
      );
      return admitted.pipe(
        Effect.flatMap((result) =>
          result._tag === "Cached"
            ? Effect.succeed(result.blocked)
            : Fiber.join(result.fiber).pipe(Effect.map((decision) => decision.blocked)),
        ),
      );
    });

    return { cachedCommentModeBlocked, isCommentModeBlocked };
  });
