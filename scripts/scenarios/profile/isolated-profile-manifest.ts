import { readFile, writeFile } from "node:fs/promises";

export const ISOLATED_PROFILE_MANIFEST_VERSION = 1 as const;
export const ISOLATED_PROFILE_MANIFEST_FILE = "scenario-profile.json";

export interface IsolatedProfileManifest {
  readonly version: typeof ISOLATED_PROFILE_MANIFEST_VERSION;
  readonly runId: string;
  readonly label: string;
  readonly repositoryRealpath: string;
  readonly createdAt: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseIsolatedProfileManifest = (value: unknown): IsolatedProfileManifest => {
  if (
    !isRecord(value) ||
    value.version !== ISOLATED_PROFILE_MANIFEST_VERSION ||
    typeof value.runId !== "string" ||
    value.runId.length === 0 ||
    typeof value.label !== "string" ||
    typeof value.repositoryRealpath !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    throw new Error("Isolated scenario Profile manifest is invalid or unsupported");
  }
  return value as unknown as IsolatedProfileManifest;
};

export const readIsolatedProfileManifest = async (
  manifestPath: string,
): Promise<IsolatedProfileManifest> =>
  parseIsolatedProfileManifest(JSON.parse(await readFile(manifestPath, "utf8")));

export const writeIsolatedProfileManifest = async (
  manifestPath: string,
  manifest: IsolatedProfileManifest,
): Promise<void> => {
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
};
