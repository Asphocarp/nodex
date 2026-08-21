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

interface SkybridgeCacheEntry {
  expiresAt: number;
  prewarm?: Promise<void>;
  response: Promise<CachedSkybridgeResponse>;
  state: Exclude<McpAppSandboxCacheState, "cold">;
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

/** One coordinator-scoped Skybridge response cache and prewarm lifecycle. */
export class McpAppSandboxProtocolCache {
  readonly #abortController = new AbortController();
  readonly #entries = new Map<string, SkybridgeCacheEntry>();
  readonly #fetch: Net["fetch"];
  #closed = false;

  constructor(fetch: Net["fetch"]) {
    this.#fetch = fetch;
  }

  getState(sourceUrl: string): McpAppSandboxCacheState {
    if (this.#closed) return "cold";
    const upstreamUrl = resolveUpstreamUrl(new Request(sourceUrl));
    if (!upstreamUrl) return "cold";
    const entry = this.#entries.get(upstreamUrl);
    if (!entry || entry.expiresAt <= Date.now()) return "cold";
    return entry.state;
  }

  prewarm(locale: string): Promise<void> {
    if (this.#closed) return Promise.resolve();
    const rootUrl = rootUpstreamUrl(locale);
    const existing = this.#entries.get(rootUrl);
    if (existing?.expiresAt && existing.expiresAt > Date.now() && existing.prewarm) {
      return existing.prewarm;
    }

    const rootResponse = this.#load(new Request(rootUrl));
    const entry = this.#entries.get(rootUrl);
    if (!entry) return rootResponse.then(() => undefined);

    const prewarm = (async () => {
      const response = await rootResponse;
      if (!response?.ok) return;
      const entryAssets = [...new Set((await response.text()).match(ENTRY_ASSET_PATH) ?? [])].slice(
        0,
        SKYBRIDGE_PREWARM_ASSET_LIMIT,
      );
      const assetResponses = await Promise.all(
        entryAssets.map((asset) =>
          this.#load(new Request(`https://${MCP_APP_SANDBOX_REMOTE_HOST}${asset}`)),
        ),
      );
      if (assetResponses.some((asset) => !asset?.ok)) {
        throw new Error("MCP App sandbox startup asset failed to prewarm");
      }
      const mainScript = entryAssets.find((asset) => asset.endsWith(".js"));
      if (mainScript) {
        const script = await this.#load(
          new Request(`https://${MCP_APP_SANDBOX_REMOTE_HOST}${mainScript}`),
        );
        if (!script?.ok) {
          throw new Error("MCP App sandbox main script failed to prewarm");
        }
        const runtimeAssets = [
          ...new Set((await script.text()).match(RUNTIME_ASSET_PATH) ?? []),
        ].slice(0, SKYBRIDGE_PREWARM_ASSET_LIMIT);
        const runtimeResponses = await Promise.all(
          runtimeAssets.map((asset) =>
            this.#load(new Request(`https://${MCP_APP_SANDBOX_REMOTE_HOST}/${asset}`)),
          ),
        );
        if (runtimeResponses.some((asset) => !asset?.ok)) {
          throw new Error("MCP App sandbox runtime asset failed to prewarm");
        }
      }
      if (this.#entries.get(rootUrl) === entry) entry.state = "warm";
    })().catch((error: unknown) => {
      if (this.#entries.get(rootUrl) === entry) this.#entries.delete(rootUrl);
      if (this.#closed) return;
      throw error;
    });
    entry.prewarm = prewarm;
    return prewarm;
  }

  createHandler(): (request: Request) => Promise<Response> {
    return async (request) => {
      try {
        const upstream = await this.#load(request);
        if (!upstream) return new Response(null, { status: 404 });
        return new Response(await upstream.arrayBuffer(), {
          headers: {
            "Content-Security-Policy": upstream.headers.get("Content-Security-Policy") ?? "",
            "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
            "Permissions-Policy": upstream.headers.get("Permissions-Policy") ?? "",
            "X-Content-Type-Options": "nosniff",
          },
          status: upstream.status,
        });
      } catch (error) {
        if (this.#closed) return new Response(null, { status: 404 });
        throw error;
      }
    };
  }

  dispose(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#abortController.abort();
    this.#entries.clear();
  }

  async #load(request: Request): Promise<Response | null> {
    if (this.#closed) return null;
    const upstreamUrl = resolveUpstreamUrl(request);
    if (!upstreamUrl) return null;

    const now = Date.now();
    let entry = this.#entries.get(upstreamUrl);
    if (entry && entry.expiresAt <= now) {
      this.#entries.delete(upstreamUrl);
      entry = undefined;
    }
    if (!entry) {
      entry = {
        expiresAt: now + SKYBRIDGE_CACHE_TTL_MS,
        response: fetchUpstream(upstreamUrl, this.#fetch, this.#abortController.signal),
        state: hasExactSkybridgeQuery(new URL(upstreamUrl)) ? "warming" : "warm",
      };
      this.#entries.set(upstreamUrl, entry);
      while (this.#entries.size > SKYBRIDGE_CACHE_MAX_ENTRIES) {
        const oldest = this.#entries.keys().next().value;
        if (typeof oldest !== "string") break;
        this.#entries.delete(oldest);
      }
    }

    try {
      const response = await entry.response;
      if (response.status < 200 || response.status >= 300) {
        if (this.#entries.get(upstreamUrl) === entry) this.#entries.delete(upstreamUrl);
      }
      return cloneCachedResponse(response);
    } catch (error) {
      if (this.#entries.get(upstreamUrl) === entry) this.#entries.delete(upstreamUrl);
      throw error;
    }
  }
}
