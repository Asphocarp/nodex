import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ThirdPartyNotices } from "../shared/third-party-notices";
import { resolveBuildResources } from "../shared/build-resources";

export const THIRD_PARTY_NOTICES_FILENAME = "THIRD_PARTY_NOTICES.txt";

export interface ThirdPartyNoticesLocation {
  appPath: string;
  cwd: string;
  isPackaged: boolean;
  resourcesPath: string;
}

export function resolveThirdPartyNoticesCandidates({
  cwd,
  isPackaged,
  resourcesPath,
}: ThirdPartyNoticesLocation): string[] {
  const packagedResource = join(resourcesPath, THIRD_PARTY_NOTICES_FILENAME);
  if (isPackaged) {
    return [packagedResource];
  }

  const generatedResource = resolveBuildResources(cwd).noticesPath;
  return [...new Set([
    packagedResource,
    generatedResource,
    join(cwd, "assets", THIRD_PARTY_NOTICES_FILENAME),
    join(cwd, "electron", "assets", THIRD_PARTY_NOTICES_FILENAME),
  ])];
}

function isMissingFileError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}

export async function readThirdPartyNotices(
  location: ThirdPartyNoticesLocation,
): Promise<ThirdPartyNotices> {
  for (const candidate of resolveThirdPartyNoticesCandidates(location)) {
    try {
      return { text: await readFile(candidate, "utf8") };
    } catch (error) {
      if (isMissingFileError(error)) continue;
      throw error;
    }
  }

  return { text: null };
}
