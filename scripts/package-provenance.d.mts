export interface PackagedBuildProvenance {
  readonly provenanceId: string;
  readonly target: {
    readonly arch: "arm64" | "x64";
    readonly platform: "darwin";
  };
}

export function writePackagedBuildProvenance(
  appPath: string,
): PackagedBuildProvenance;

export function verifyPackagedBuildProvenance(
  appPath: string,
  options?: {
    readonly expectedArch?: "arm64" | "x64";
    readonly expectedPreparedManifestPath?: string;
  },
): PackagedBuildProvenance;
