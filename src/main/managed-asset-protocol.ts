import * as fs from "node:fs";
import * as path from "node:path";
import type { Session } from "electron";
import {
  MANAGED_ASSET_DISPLAY_HOST,
  MANAGED_ASSET_PROTOCOL_SCHEME,
} from "../shared/managed-assets";
import { isSafeAssetFileName } from "../shared/assets";
import {
  getAssetsRootPath,
  getImageMimeTypeForAssetFile,
  resolveAssetPathInRoot,
} from "./local-store/assets";

const RESPONSE_SECURITY_HEADERS = {
  "Cache-Control": "private, max-age=31536000, immutable",
  "X-Content-Type-Options": "nosniff",
} as const;

export interface ManagedAssetProtocolOptions {
  readonly assetsRootPath: string;
  readonly logError?: (message: string, error: unknown) => void;
}

function response(
  status: number,
  body: BodyInit | null = null,
  headers: HeadersInit = {},
): Response {
  return new Response(body, {
    status,
    headers: {
      ...RESPONSE_SECURITY_HEADERS,
      ...headers,
    },
  });
}

function parseManagedAssetRequest(request: Request): {
  readonly fileName: string;
  readonly method: "GET" | "HEAD";
} | Response {
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
    url.protocol !== `${MANAGED_ASSET_PROTOCOL_SCHEME}:`
    || url.hostname !== MANAGED_ASSET_DISPLAY_HOST
    || url.search.length > 0
    || url.hash.length > 0
  ) {
    return response(400);
  }

  const encodedPath = url.pathname.startsWith("/")
    ? url.pathname.slice(1)
    : url.pathname;
  if (encodedPath.length === 0 || encodedPath.includes("/")) {
    return response(400);
  }

  try {
    const fileName = decodeURIComponent(encodedPath);
    if (!isSafeAssetFileName(fileName)) return response(400);
    return { fileName, method };
  } catch {
    return response(400);
  }
}

export function createManagedAssetProtocolHandler(
  options: ManagedAssetProtocolOptions,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const parsed = parseManagedAssetRequest(request);
    if (parsed instanceof Response) return parsed;

    const mimeType = getImageMimeTypeForAssetFile(parsed.fileName);
    if (!mimeType) return response(404);

    try {
      const absolutePath = resolveAssetPathInRoot(
        options.assetsRootPath,
        parsed.fileName,
      );
      if (!fs.existsSync(absolutePath)) return response(404);

      const stats = fs.lstatSync(absolutePath);
      if (!stats.isFile() || stats.isSymbolicLink()) return response(404);

      const headers = {
        "Content-Disposition": `inline; filename="${path.basename(parsed.fileName)}"`,
        "Content-Length": String(stats.size),
        "Content-Type": mimeType,
      };
      if (parsed.method === "HEAD") return response(200, null, headers);

      const bytes = fs.readFileSync(absolutePath);
      return response(200, new Uint8Array(bytes), headers);
    } catch (error) {
      options.logError?.("Managed asset protocol read failed", error);
      return response(500);
    }
  };
}

export function registerManagedAssetProtocol(
  electronSession: Session,
  options: {
    readonly logError?: (message: string, error: unknown) => void;
  } = {},
): () => void {
  const handler = createManagedAssetProtocolHandler({
    assetsRootPath: getAssetsRootPath(),
    logError: options.logError,
  });
  if (electronSession.protocol.isProtocolHandled(MANAGED_ASSET_PROTOCOL_SCHEME)) {
    electronSession.protocol.unhandle(MANAGED_ASSET_PROTOCOL_SCHEME);
  }
  void electronSession.protocol.handle(MANAGED_ASSET_PROTOCOL_SCHEME, handler);

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    if (!electronSession.protocol.isProtocolHandled(MANAGED_ASSET_PROTOCOL_SCHEME)) {
      return;
    }
    electronSession.protocol.unhandle(MANAGED_ASSET_PROTOCOL_SCHEME);
  };
}
