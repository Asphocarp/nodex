import fs from "node:fs";
import path from "node:path";

type RemoteHostedPipPreferences = {
  alwaysHide: boolean;
  maxDisplaySize: number | null;
  schemaVersion: 2;
};

const EMPTY_PREFERENCES: RemoteHostedPipPreferences = {
  alwaysHide: false,
  maxDisplaySize: null,
  schemaVersion: 2,
};

function parsePreferences(value: unknown): RemoteHostedPipPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return EMPTY_PREFERENCES;
  }
  const candidate = value as Record<string, unknown>;
  const maxDisplaySize = candidate.maxDisplaySize;
  return {
    alwaysHide: candidate.alwaysHide === true,
    maxDisplaySize:
      typeof maxDisplaySize === "number" && Number.isFinite(maxDisplaySize) && maxDisplaySize > 0
        ? maxDisplaySize
        : null,
    schemaVersion: 2,
  };
}

export interface RemoteHostedPipPreferencesAdapter {
  readonly readAlwaysHide: () => boolean;
  readonly readMaxDisplaySize: () => number | null;
  readonly writeAlwaysHide: (alwaysHide: boolean) => void;
  readonly writeMaxDisplaySize: (maxDisplaySize: number) => void;
}

/** Synchronous native-callback Adapter; it owns no cache or lifecycle state. */
export function makeRemoteHostedPipPreferences(
  filePath: string,
): RemoteHostedPipPreferencesAdapter {
  const read = (): RemoteHostedPipPreferences => {
    try {
      return parsePreferences(JSON.parse(fs.readFileSync(filePath, "utf8")));
    } catch {
      return EMPTY_PREFERENCES;
    }
  };

  const write = (preferences: RemoteHostedPipPreferences): void => {
    const temporaryPath = `${filePath}.tmp`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(temporaryPath, `${JSON.stringify(preferences, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
  };

  return {
    readAlwaysHide: () => read().alwaysHide,
    readMaxDisplaySize: () => read().maxDisplaySize,
    writeAlwaysHide: (alwaysHide) => write({ ...read(), alwaysHide }),
    writeMaxDisplaySize: (maxDisplaySize) => {
      if (!Number.isFinite(maxDisplaySize) || maxDisplaySize <= 0) return;
      write({ ...read(), maxDisplaySize });
    },
  };
}
