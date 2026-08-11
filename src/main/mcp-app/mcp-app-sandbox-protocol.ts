import type { Net } from "electron";
import {
  MCP_APP_SANDBOX_REMOTE_HOST,
  MCP_APP_SANDBOX_SCHEME,
  buildMcpAppSandboxSourceUrl,
} from "../../shared/mcp-app/mcp-app-sandbox-contract";

const SKYBRIDGE_CACHE_TTL_MS = 5 * 60_000;
const SKYBRIDGE_CACHE_MAX_ENTRIES = 64;
const SKYBRIDGE_PREWARM_ASSET_LIMIT = 8;
const HASHED_ASSET_PATH =
  /^\/assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.(?:css|js)$/u;
const ENTRY_ASSET_PATH =
  /\/assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.(?:css|js)/gu;
const RUNTIME_ASSET_PATH =
  /assets\/(?:run-widget-code|apply-csp|adapter)-[A-Za-z0-9_-]{8,}\.js/gu;

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

const skybridgeResponseCache = new Map<string, SkybridgeCacheEntry>();

function isSkybridgeHost(hostname: string): boolean {
  return hostname === MCP_APP_SANDBOX_REMOTE_HOST
    || hostname.endsWith(`.${MCP_APP_SANDBOX_REMOTE_HOST}`);
}

function hasExactSkybridgeQuery(url: URL): boolean {
  const expectedKeys = [
    "app",
    "locale",
    "deviceType",
    "unsafeSkipTargetOriginCheck",
  ];
  const keys = [...url.searchParams.keys()];
  return url.pathname === "/"
    && keys.length === expectedKeys.length
    && expectedKeys.every((key) => keys.includes(key))
    && url.searchParams.get("app") === "skybridge"
    && Boolean(url.searchParams.get("locale"))
    && url.searchParams.get("deviceType") === "desktop"
    && url.searchParams.get("unsafeSkipTargetOriginCheck") === "true";
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
    (url.protocol !== "https:" && url.protocol !== `${MCP_APP_SANDBOX_SCHEME}:`)
    || url.port
    || url.username
    || url.password
    || !isSkybridgeHost(url.hostname)
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
): Promise<CachedSkybridgeResponse> {
  const response = await fetch(url, {
    credentials: "omit",
    redirect: "error",
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

async function loadCachedResponse(
  request: Request,
  fetch: Net["fetch"],
): Promise<Response | null> {
  const upstreamUrl = resolveUpstreamUrl(request);
  if (!upstreamUrl) return null;

  const now = Date.now();
  let entry = skybridgeResponseCache.get(upstreamUrl);
  if (entry && entry.expiresAt <= now) {
    skybridgeResponseCache.delete(upstreamUrl);
    entry = undefined;
  }
  if (!entry) {
    entry = {
      expiresAt: now + SKYBRIDGE_CACHE_TTL_MS,
      response: fetchUpstream(upstreamUrl, fetch),
      state: hasExactSkybridgeQuery(new URL(upstreamUrl)) ? "warming" : "warm",
    };
    skybridgeResponseCache.set(upstreamUrl, entry);
    while (skybridgeResponseCache.size > SKYBRIDGE_CACHE_MAX_ENTRIES) {
      const oldest = skybridgeResponseCache.keys().next().value;
      if (typeof oldest !== "string") break;
      skybridgeResponseCache.delete(oldest);
    }
  }

  try {
    const response = await entry.response;
    if (response.status < 200 || response.status >= 300) {
      if (skybridgeResponseCache.get(upstreamUrl) === entry) {
        skybridgeResponseCache.delete(upstreamUrl);
      }
    }
    return cloneCachedResponse(response);
  } catch (error) {
    if (skybridgeResponseCache.get(upstreamUrl) === entry) {
      skybridgeResponseCache.delete(upstreamUrl);
    }
    throw error;
  }
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

export function getMcpAppSandboxCacheState(
  sourceUrl: string,
): McpAppSandboxCacheState {
  const upstreamUrl = resolveUpstreamUrl(new Request(sourceUrl));
  if (!upstreamUrl) return "cold";
  const entry = skybridgeResponseCache.get(upstreamUrl);
  if (!entry || entry.expiresAt <= Date.now()) return "cold";
  return entry.state;
}

export function prewarmMcpAppSandbox(input: {
  fetch: Net["fetch"];
  locale: string;
}): Promise<void> {
  const rootUrl = rootUpstreamUrl(input.locale);
  const existing = skybridgeResponseCache.get(rootUrl);
  if (existing?.expiresAt && existing.expiresAt > Date.now() && existing.prewarm) {
    return existing.prewarm;
  }

  const rootResponse = loadCachedResponse(new Request(rootUrl), input.fetch);
  const entry = skybridgeResponseCache.get(rootUrl);
  if (!entry) return rootResponse.then(() => undefined);

  const prewarm = (async () => {
    const response = await rootResponse;
    if (!response?.ok) return;
    const entryAssets = [...new Set(
      (await response.text()).match(ENTRY_ASSET_PATH) ?? [],
    )].slice(0, SKYBRIDGE_PREWARM_ASSET_LIMIT);
    const assetResponses = await Promise.all(entryAssets.map((asset) =>
      loadCachedResponse(
        new Request(`https://${MCP_APP_SANDBOX_REMOTE_HOST}${asset}`),
        input.fetch,
      )
    ));
    if (assetResponses.some((asset) => !asset?.ok)) {
      throw new Error("MCP App sandbox startup asset failed to prewarm");
    }
    const mainScript = entryAssets.find((asset) => asset.endsWith(".js"));
    if (mainScript) {
      const script = await loadCachedResponse(
        new Request(`https://${MCP_APP_SANDBOX_REMOTE_HOST}${mainScript}`),
        input.fetch,
      );
      if (!script?.ok) {
        throw new Error("MCP App sandbox main script failed to prewarm");
      }
      const runtimeAssets = [...new Set(
        (await script.text()).match(RUNTIME_ASSET_PATH) ?? [],
      )].slice(0, SKYBRIDGE_PREWARM_ASSET_LIMIT);
      const runtimeResponses = await Promise.all(runtimeAssets.map((asset) =>
        loadCachedResponse(
          new Request(`https://${MCP_APP_SANDBOX_REMOTE_HOST}/${asset}`),
          input.fetch,
        )
      ));
      if (runtimeResponses.some((asset) => !asset?.ok)) {
        throw new Error("MCP App sandbox runtime asset failed to prewarm");
      }
    }
    if (skybridgeResponseCache.get(rootUrl) === entry) entry.state = "warm";
  })().catch((error: unknown) => {
    if (skybridgeResponseCache.get(rootUrl) === entry) {
      skybridgeResponseCache.delete(rootUrl);
    }
    throw error;
  });
  entry.prewarm = prewarm;
  return prewarm;
}

export function createMcpAppSandboxProtocolHandler(input: {
  fetch: Net["fetch"];
}): (request: Request) => Promise<Response> {
  return async (request) => {
    const upstream = await loadCachedResponse(request, input.fetch);
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
  };
}
