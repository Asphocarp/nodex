import { createRequire } from "node:module";
import type { Socket } from "node:net";
import type { BrowserUsePeerAuthorizationMode } from "../../shared/browser-use-host-capability";

export interface BrowserUsePeerAuthorizationResult {
  authorized: boolean;
  reason?: string;
  signingIdentifier?: string;
  teamId?: string;
}

export type BrowserUseSocketPeerAuthorizer = (socket: Socket) => BrowserUsePeerAuthorizationResult;

interface BrowserUsePeerAuthorizationAddon {
  authorizeSocketPeer(
    socketFileDescriptor: number,
    developmentMode: boolean,
  ): BrowserUsePeerAuthorizationResult;
}

export interface CreateBrowserUsePeerAuthorizerOptions {
  addonPath: string | null;
  mode: BrowserUsePeerAuthorizationMode;
  platform?: NodeJS.Platform;
}

type SocketWithFileDescriptor = Socket & {
  _handle?: {
    fd?: unknown;
  };
};

function readSocketFileDescriptor(socket: Socket): number | null {
  const descriptor = (socket as SocketWithFileDescriptor)._handle?.fd;
  return typeof descriptor === "number" && Number.isInteger(descriptor) && descriptor >= 0
    ? descriptor
    : null;
}

function sanitizeAuthorizationResult(
  result: BrowserUsePeerAuthorizationResult,
): BrowserUsePeerAuthorizationResult {
  return {
    authorized: result.authorized === true,
    ...(typeof result.reason === "string" ? { reason: result.reason.slice(0, 256) } : {}),
    ...(typeof result.signingIdentifier === "string"
      ? { signingIdentifier: result.signingIdentifier.slice(0, 256) }
      : {}),
    ...(typeof result.teamId === "string" ? { teamId: result.teamId.slice(0, 128) } : {}),
  };
}

export function createBrowserUsePeerAuthorizer(
  options: CreateBrowserUsePeerAuthorizerOptions,
): BrowserUseSocketPeerAuthorizer {
  if (options.mode === "disabled") return () => ({ authorized: true });

  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") {
    return () => ({
      authorized: false,
      reason: `peer-authorization-unavailable-${platform}`,
    });
  }
  if (!options.addonPath) {
    return () => ({
      authorized: false,
      reason: "peer-authorization-addon-unavailable",
    });
  }

  let addon: BrowserUsePeerAuthorizationAddon;
  try {
    addon = createRequire(import.meta.url)(options.addonPath) as BrowserUsePeerAuthorizationAddon;
  } catch {
    return () => ({
      authorized: false,
      reason: "peer-authorization-addon-load-failed",
    });
  }
  if (typeof addon.authorizeSocketPeer !== "function") {
    return () => ({
      authorized: false,
      reason: "peer-authorization-addon-invalid",
    });
  }

  return (socket) => {
    const socketFileDescriptor = readSocketFileDescriptor(socket);
    if (socketFileDescriptor === null) {
      return {
        authorized: false,
        reason: "missing-socket-file-descriptor",
      };
    }
    try {
      return sanitizeAuthorizationResult(
        addon.authorizeSocketPeer(socketFileDescriptor, options.mode === "development"),
      );
    } catch {
      return {
        authorized: false,
        reason: "peer-authorization-failed",
      };
    }
  };
}
