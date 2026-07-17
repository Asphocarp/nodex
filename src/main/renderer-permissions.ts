export interface AppRendererPermissionRequest {
  permission: string;
  webContentsType: string | null;
  isMainFrame: boolean;
}

export function shouldGrantAppRendererPermission({
  permission,
  webContentsType,
  isMainFrame,
}: AppRendererPermissionRequest): boolean {
  if (permission === "media") return true;
  return permission === "clipboard-sanitized-write"
    && webContentsType === "window"
    && isMainFrame;
}
