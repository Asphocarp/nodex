import {
  APP_FILESYSTEM_PREFIX,
  buildAppFilesystemUrl,
  buildEnvironmentAwareFilesystemUrl,
  isAbsoluteAppFilesystemPath,
} from "../../shared/app-protocol";
import { parseAssetSource } from "../../shared/assets";
import { parseLocalFileLinkHref } from "../../shared/file-link-openers";
import { resolveAssetSourceToDisplayUrl, type ManagedAssetPathResolver } from "./assets";

/** Normalizes generic local app resources while leaving conversation media to its own owner. */
export function normalizeEnvironmentAwareAppResourceSource(
  rawSource: string | null | undefined,
  rendererProtocol: string,
): string | null {
  const source = rawSource?.trim() ?? "";
  if (!source) return null;
  if (source.startsWith(APP_FILESYSTEM_PREFIX)) return source;
  if (/^(?:app:|data:|https?:)/iu.test(source)) return source;
  if (!isAbsoluteAppFilesystemPath(source)) return null;
  return buildEnvironmentAwareFilesystemUrl(source, rendererProtocol);
}

/** Compiles a trusted conversation-media source to its immediate DOM transport. */
export function normalizeAppMediaResourceSource(
  rawSource: string | null | undefined,
  mediaKind: "audio" | "image" | "video",
  resolveManagedAssetPath?: ManagedAssetPathResolver,
): string | null {
  const source = rawSource?.trim() ?? "";
  if (!source) return null;
  if (parseAssetSource(source)) {
    return resolveAssetSourceToDisplayUrl(source, resolveManagedAssetPath);
  }

  const localPath =
    parseLocalFileLinkHref(source)?.path ?? (isAbsoluteAppFilesystemPath(source) ? source : null);
  if (localPath) return buildAppFilesystemUrl(localPath);
  if (/^(?:app:|blob:|https?:)/iu.test(source)) return source;
  return source.toLowerCase().startsWith(`data:${mediaKind}/`) ? source : null;
}
