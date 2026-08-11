export const APP_RENDERER_PROTOCOL_SCHEME = "app";
export const APP_RENDERER_HOST = "-";
export const APP_RENDERER_ORIGIN = `${APP_RENDERER_PROTOCOL_SCHEME}://${APP_RENDERER_HOST}`;
export const APP_RENDERER_URL = `${APP_RENDERER_ORIGIN}/index.html`;
export const VITE_REACT_REFRESH_PREAMBLE_SHA256 =
  "'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='";

const STATSIG_CONNECT_ORIGINS = [
  "https://api.statsig.com",
  "https://featuregates.org",
  "https://statsigapi.net",
  "https://events.statsigapi.net",
  "https://api.statsigcdn.com",
  "https://featureassets.org",
  "https://assetsconfigcdn.org",
  "https://prodregistryv2.org",
  "https://cloudflare-dns.com",
  "https://beyondwickedmapping.org",
] as const;

export function buildTopLevelRendererCsp(input: {
  mode: "development" | "production";
}): string {
  const developmentConnections = input.mode === "development"
    ? [
        "http://localhost:51284",
        "ws://localhost:51284",
        "http://127.0.0.1:51284",
        "ws://127.0.0.1:51284",
      ]
    : [];
  const developmentScriptSources = input.mode === "development"
    ? [VITE_REACT_REFRESH_PREAMBLE_SHA256]
    : [];
  const directives = [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'none'",
    `script-src 'self' ${developmentScriptSources.join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' nodex-asset: data: blob: https:",
    "media-src 'self' nodex-asset: data: blob:",
    "worker-src 'self' blob:",
    `connect-src 'self' https://*.ingest.sentry.io https://*.ingest.us.sentry.io ${STATSIG_CONNECT_ORIGINS.join(" ")} ${developmentConnections.join(" ")}`.trim(),
    "frame-src 'self' blob: nodex-mcp-sandbox: https: http:",
    "child-src 'self' blob: nodex-mcp-sandbox: https: http:",
  ];
  return directives.join("; ");
}
