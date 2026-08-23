import { isTrustedAppRendererIpcSender } from "./app-renderer-ipc-authorization";

export interface AppRendererPermissionRequest {
  readonly developmentOrigin?: string | null;
  readonly hasOwnerWindow?: boolean;
  readonly isMainFrame: boolean;
  readonly permission: string;
  /** Normalized from check `mediaType` or request `mediaTypes`. */
  readonly requestedMediaTypes?: readonly string[];
  readonly requestingOrigin?: string | null;
  readonly webContentsType: string | null;
}

export function shouldGrantAppRendererPermission({
  developmentOrigin,
  hasOwnerWindow = false,
  permission,
  requestedMediaTypes,
  requestingOrigin,
  webContentsType,
  isMainFrame,
}: AppRendererPermissionRequest): boolean {
  if (permission === "clipboard-sanitized-write") {
    return webContentsType === "window" && isMainFrame;
  }
  if (permission !== "media") return false;
  if (requestedMediaTypes?.length !== 1 || requestedMediaTypes[0] !== "audio") return false;

  return isTrustedAppRendererIpcSender({
    developmentOrigin,
    hasOwnerWindow,
    isMainFrame,
    senderType: webContentsType ?? "",
    senderUrl: requestingOrigin ?? "",
  });
}
