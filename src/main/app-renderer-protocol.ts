import * as fs from "node:fs";
import * as path from "node:path";
import type { Session } from "electron";
import {
  APP_RENDERER_HOST,
  APP_RENDERER_PROTOCOL_SCHEME,
  buildTopLevelRendererCsp,
} from "../shared/app-renderer-policy";

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const response = (
  status: number,
  body: BodyInit | null = null,
  headers: HeadersInit = {},
): Response => {
  const responseHeaders = new Headers(headers);
  if (!responseHeaders.has("Content-Security-Policy")) {
    responseHeaders.set(
      "Content-Security-Policy",
      buildTopLevelRendererCsp({ mode: "production" }),
    );
  }
  if (!responseHeaders.has("Referrer-Policy")) {
    responseHeaders.set("Referrer-Policy", "no-referrer");
  }
  if (!responseHeaders.has("X-Content-Type-Options")) {
    responseHeaders.set("X-Content-Type-Options", "nosniff");
  }

  return new Response(body, {
    status,
    headers: responseHeaders,
  });
};

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

export function createAppRendererProtocolHandler(input: {
  rendererRoot: string;
  logError?: (message: string, error: unknown) => void;
}): (request: Request) => Promise<Response> {
  const rendererRoot = fs.realpathSync(input.rendererRoot);
  return async (request) => {
    const method = request.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      return response(405, null, { Allow: "GET, HEAD" });
    }

    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return response(400);
    }
    if (
      url.protocol !== `${APP_RENDERER_PROTOCOL_SCHEME}:` ||
      url.hostname !== APP_RENDERER_HOST ||
      url.username ||
      url.password ||
      url.port
    ) {
      return response(400);
    }

    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(url.pathname);
    } catch {
      return response(400);
    }
    if (
      decodedPath.includes("\0") ||
      decodedPath.includes("\\") ||
      decodedPath.split("/").includes("..")
    ) {
      return response(400);
    }
    const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
    if (!relativePath || path.isAbsolute(relativePath)) return response(400);

    const candidate = path.resolve(rendererRoot, relativePath);
    if (!isPathInside(rendererRoot, candidate)) return response(400);
    try {
      const realPath = fs.realpathSync(candidate);
      if (!isPathInside(rendererRoot, realPath)) return response(400);
      const stats = fs.statSync(realPath);
      if (!stats.isFile()) return response(404);
      const contentType = MIME_TYPES[path.extname(realPath).toLowerCase()];
      if (!contentType) return response(404);
      const headers = {
        "Cache-Control":
          relativePath === "index.html" ? "no-cache" : "public, max-age=31536000, immutable",
        "Content-Length": String(stats.size),
        "Content-Type": contentType,
      };
      if (method === "HEAD") return response(200, null, headers);
      return response(200, new Uint8Array(fs.readFileSync(realPath)), headers);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return response(404);
      input.logError?.("App renderer protocol read failed", error);
      return response(500);
    }
  };
}

export function registerAppRendererProtocol(
  electronSession: Session,
  rendererRoot: string,
  logError?: (message: string, error: unknown) => void,
): () => void {
  const appHandler = createAppRendererProtocolHandler({ rendererRoot, logError });
  if (electronSession.protocol.isProtocolHandled(APP_RENDERER_PROTOCOL_SCHEME)) {
    electronSession.protocol.unhandle(APP_RENDERER_PROTOCOL_SCHEME);
  }
  void electronSession.protocol.handle(APP_RENDERER_PROTOCOL_SCHEME, appHandler);
  return () => {
    if (electronSession.protocol.isProtocolHandled(APP_RENDERER_PROTOCOL_SCHEME)) {
      electronSession.protocol.unhandle(APP_RENDERER_PROTOCOL_SCHEME);
    }
  };
}
