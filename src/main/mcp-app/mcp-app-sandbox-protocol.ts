import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FiberMap from "effect/FiberMap";
import * as FiberSet from "effect/FiberSet";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type { Net } from "electron";
import {
  MCP_APP_SANDBOX_REMOTE_HOST,
  MCP_APP_SANDBOX_SCHEME,
  buildMcpAppSandboxSourceUrl,
} from "../../shared/mcp-app/mcp-app-sandbox-contract";

const SKYBRIDGE_CACHE_TTL_MS = 5 * 60_000;
const SKYBRIDGE_CACHE_MAX_ENTRIES = 64;
const SKYBRIDGE_PREWARM_ASSET_LIMIT = 8;
const HASHED_ASSET_PATH = /^\/assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.(?:css|js)$/u;
const ENTRY_ASSET_PATH = /\/assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.(?:css|js)/gu;
const RUNTIME_ASSET_PATH = /assets\/(?:run-widget-code|apply-csp|adapter)-[A-Za-z0-9_-]{8,}\.js/gu;

export type McpAppSandboxCacheState = "cold" | "warming" | "warm";

interface CachedSkybridgeResponse {
  body: Uint8Array;
  headers: [string, string][];
  status: number;
  statusText: string;
}

interface SkybridgeCacheStateEntry {
  expiresAt: number;
  state: Exclude<McpAppSandboxCacheState, "cold">;
}

export class McpAppSandboxProtocolError extends Schema.TaggedError<McpAppSandboxProtocolError>()(
  "McpAppSandboxProtocolError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export interface McpAppSandboxProtocolCache {
  readonly createHandler: () => (request: Request) => Promise<Response>;
  readonly getState: (sourceUrl: string) => McpAppSandboxCacheState;
  readonly prewarm: (locale: string) => Promise<void>;
}

function isSkybridgeHost(hostname: string): boolean {
  return (
    hostname === MCP_APP_SANDBOX_REMOTE_HOST || hostname.endsWith(`.${MCP_APP_SANDBOX_REMOTE_HOST}`)
  );
}

function hasExactSkybridgeQuery(url: URL): boolean {
  const expectedKeys = ["app", "locale", "deviceType", "unsafeSkipTargetOriginCheck"];
  const keys = [...url.searchParams.keys()];
  return (
    url.pathname === "/" &&
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => keys.includes(key)) &&
    url.searchParams.get("app") === "skybridge" &&
    Boolean(url.searchParams.get("locale")) &&
    url.searchParams.get("deviceType") === "desktop" &&
    url.searchParams.get("unsafeSkipTargetOriginCheck") === "true"
  );
}

function resolveUpstreamUrl(request: Request): string | null {
  if (request.method.toUpperCase() !== "GET") return null;
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  if (
    (url.protocol !== "https:" && url.protocol !== `${MCP_APP_SANDBOX_SCHEME}:`) ||
    url.port ||
    url.username ||
    url.password ||
    !isSkybridgeHost(url.hostname)
  ) {
    return null;
  }
  const isRoot = hasExactSkybridgeQuery(url);
  const isAsset = !url.search && HASHED_ASSET_PATH.test(url.pathname);
  if (!isRoot && !isAsset) return null;

  const upstream = new URL(`https://${MCP_APP_SANDBOX_REMOTE_HOST}`);
  upstream.pathname = url.pathname;
  upstream.search = url.search;
  return upstream.toString();
}

function cloneCachedResponse(response: CachedSkybridgeResponse): Response {
  return new Response(response.body.slice(), {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

async function fetchUpstream(
  url: string,
  fetch: Net["fetch"],
  signal: AbortSignal,
): Promise<CachedSkybridgeResponse> {
  const response = await fetch(url, {
    credentials: "omit",
    redirect: "error",
    signal,
  });
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  headers.delete("set-cookie2");
  return {
    body: new Uint8Array(await response.arrayBuffer()),
    headers: [...headers.entries()],
    status: response.status,
    statusText: response.statusText,
  };
}

function rootUpstreamUrl(locale: string): string {
  const sourceUrl = buildMcpAppSandboxSourceUrl({
    locale,
    subdomain: "prewarm",
  });
  const source = new URL(sourceUrl);
  const upstream = new URL(`https://${MCP_APP_SANDBOX_REMOTE_HOST}/`);
  upstream.search = source.search;
  return upstream.toString();
}

/** Builds one Scope-owned Skybridge response cache and prewarm runtime. */
export const makeMcpAppSandboxProtocolCache = (
  fetch: Net["fetch"],
): Effect.Effect<McpAppSandboxProtocolCache, never, import("effect/Scope").Scope> =>
  Effect.gen(function* () {
    const closed = yield* Ref.make(false);
    const states = yield* Ref.make<ReadonlyMap<string, SkybridgeCacheStateEntry>>(new Map());
    const prewarms = yield* FiberMap.make<string, void, McpAppSandboxProtocolError>();
    const prewarmLock = yield* Semaphore.make(1);
    const runPromise = yield* FiberSet.makeRuntimePromise<
      never,
      unknown,
      McpAppSandboxProtocolError
    >();
    const responses = yield* Cache.makeWith(
      (upstreamUrl: string) =>
        Effect.tryPromise({
          try: (signal) => fetchUpstream(upstreamUrl, fetch, signal),
          catch: (cause) => new McpAppSandboxProtocolError({ operation: "fetch-upstream", cause }),
        }),
      {
        capacity: SKYBRIDGE_CACHE_MAX_ENTRIES,
        timeToLive: (exit) =>
          Exit.isSuccess(exit) ? Duration.millis(SKYBRIDGE_CACHE_TTL_MS) : Duration.zero,
      },
    );

    const removeState = (upstreamUrl: string) =>
      Ref.update(states, (current) => {
        if (!current.has(upstreamUrl)) return current;
        const next = new Map(current);
        next.delete(upstreamUrl);
        return next;
      });
    const markState = (
      upstreamUrl: string,
      state: Exclude<McpAppSandboxCacheState, "cold">,
      expiresAt: number,
    ) =>
      Ref.update(states, (current) => {
        const next = new Map(current);
        next.delete(upstreamUrl);
        next.set(upstreamUrl, { expiresAt, state });
        while (next.size > SKYBRIDGE_CACHE_MAX_ENTRIES) {
          const oldest = next.keys().next().value;
          if (oldest === undefined) break;
          next.delete(oldest);
        }
        return next;
      });

    const load = Effect.fn("McpAppSandboxProtocolCache.load")((request: Request) =>
      Effect.gen(function* () {
        if (yield* Ref.get(closed)) return null;
        const upstreamUrl = resolveUpstreamUrl(request);
        if (upstreamUrl === null) return null;
        const now = Date.now();
        const current = (yield* Ref.get(states)).get(upstreamUrl);
        if (current === undefined || current.expiresAt <= now) {
          yield* markState(
            upstreamUrl,
            hasExactSkybridgeQuery(new URL(upstreamUrl)) ? "warming" : "warm",
            now + SKYBRIDGE_CACHE_TTL_MS,
          );
        }
        const response = yield* Cache.get(responses, upstreamUrl).pipe(
          Effect.tapError(() => removeState(upstreamUrl)),
        );
        if (response.status < 200 || response.status >= 300) {
          yield* Cache.invalidate(responses, upstreamUrl);
          yield* removeState(upstreamUrl);
        }
        return cloneCachedResponse(response);
      }),
    );
    const readText = (operation: string, response: Response) =>
      Effect.tryPromise({
        try: () => response.text(),
        catch: (cause) => new McpAppSandboxProtocolError({ operation, cause }),
      });
    const requireWarmResponse = (
      response: Response | null,
      message: string,
    ): Effect.Effect<Response, McpAppSandboxProtocolError> =>
      response?.ok
        ? Effect.succeed(response)
        : Effect.fail(
            new McpAppSandboxProtocolError({ operation: "prewarm", cause: new Error(message) }),
          );
    const prewarmEffect = (rootUrl: string) =>
      Effect.gen(function* () {
        const root = yield* load(new Request(rootUrl)).pipe(
          Effect.flatMap((response) =>
            requireWarmResponse(response, "MCP App sandbox root failed to prewarm"),
          ),
        );
        const entryAssets = [
          ...new Set((yield* readText("read-root", root)).match(ENTRY_ASSET_PATH) ?? []),
        ].slice(0, SKYBRIDGE_PREWARM_ASSET_LIMIT);
        const assetResponses = yield* Effect.forEach(
          entryAssets,
          (asset) => load(new Request(`https://${MCP_APP_SANDBOX_REMOTE_HOST}${asset}`)),
          { concurrency: "unbounded" },
        );
        if (assetResponses.some((asset) => !asset?.ok)) {
          return yield* Effect.fail(
            new McpAppSandboxProtocolError({
              operation: "prewarm-assets",
              cause: new Error("MCP App sandbox startup asset failed to prewarm"),
            }),
          );
        }
        const mainScript = entryAssets.find((asset) => asset.endsWith(".js"));
        if (mainScript !== undefined) {
          const script = yield* load(
            new Request(`https://${MCP_APP_SANDBOX_REMOTE_HOST}${mainScript}`),
          ).pipe(
            Effect.flatMap((response) =>
              requireWarmResponse(response, "MCP App sandbox main script failed to prewarm"),
            ),
          );
          const runtimeAssets = [
            ...new Set(
              (yield* readText("read-main-script", script)).match(RUNTIME_ASSET_PATH) ?? [],
            ),
          ].slice(0, SKYBRIDGE_PREWARM_ASSET_LIMIT);
          const runtimeResponses = yield* Effect.forEach(
            runtimeAssets,
            (asset) => load(new Request(`https://${MCP_APP_SANDBOX_REMOTE_HOST}/${asset}`)),
            { concurrency: "unbounded" },
          );
          if (runtimeResponses.some((asset) => !asset?.ok)) {
            return yield* Effect.fail(
              new McpAppSandboxProtocolError({
                operation: "prewarm-runtime-assets",
                cause: new Error("MCP App sandbox runtime asset failed to prewarm"),
              }),
            );
          }
        }
        const now = Date.now();
        yield* markState(rootUrl, "warm", now + SKYBRIDGE_CACHE_TTL_MS);
      }).pipe(Effect.tapError(() => removeState(rootUrl)));

    const prewarm = (locale: string): Effect.Effect<void, McpAppSandboxProtocolError> => {
      const rootUrl = rootUpstreamUrl(locale);
      return prewarmLock
        .withPermits(1)(
          Effect.gen(function* () {
            const existingState = (yield* Ref.get(states)).get(rootUrl);
            const now = Date.now();
            if (existingState?.state === "warm" && existingState.expiresAt > now) {
              return null;
            }
            const existing = yield* FiberMap.get(prewarms, rootUrl);
            if (Option.isSome(existing)) return existing.value;
            return yield* FiberMap.run(prewarms, rootUrl, { startImmediately: true })(
              prewarmEffect(rootUrl),
            );
          }),
        )
        .pipe(Effect.flatMap((fiber) => (fiber === null ? Effect.void : Fiber.join(fiber))));
    };

    yield* Effect.addFinalizer(() =>
      Ref.set(closed, true).pipe(
        Effect.andThen(Cache.invalidateAll(responses)),
        Effect.andThen(Ref.set(states, new Map())),
      ),
    );

    const getState = (sourceUrl: string): McpAppSandboxCacheState => {
      if (Ref.getUnsafe(closed)) return "cold";
      const upstreamUrl = resolveUpstreamUrl(new Request(sourceUrl));
      if (upstreamUrl === null) return "cold";
      const entry = Ref.getUnsafe(states).get(upstreamUrl);
      return entry !== undefined && entry.expiresAt > Date.now() ? entry.state : "cold";
    };
    return {
      createHandler: () => (request) =>
        runPromise(
          load(request).pipe(
            Effect.flatMap((upstream) => {
              if (upstream === null) return Effect.succeed(new Response(null, { status: 404 }));
              return Effect.tryPromise({
                try: () => upstream.arrayBuffer(),
                catch: (cause) =>
                  new McpAppSandboxProtocolError({ operation: "read-response", cause }),
              }).pipe(
                Effect.map(
                  (body) =>
                    new Response(body, {
                      headers: {
                        "Content-Security-Policy":
                          upstream.headers.get("Content-Security-Policy") ?? "",
                        "Content-Type":
                          upstream.headers.get("Content-Type") ?? "application/octet-stream",
                        "Permissions-Policy": upstream.headers.get("Permissions-Policy") ?? "",
                        "X-Content-Type-Options": "nosniff",
                      },
                      status: upstream.status,
                    }),
                ),
              );
            }),
          ),
        ).catch((error: unknown) => {
          if (Ref.getUnsafe(closed)) return new Response(null, { status: 404 });
          throw error;
        }),
      getState,
      prewarm: (locale) => runPromise(prewarm(locale)),
    };
  });
