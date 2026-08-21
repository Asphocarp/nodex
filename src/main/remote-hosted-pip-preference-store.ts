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

export class RemoteHostedPipPreferenceStore {
  constructor(private readonly filePath: string) {}

  readAlwaysHide(): boolean {
    return this.read().alwaysHide;
  }

  readMaxDisplaySize(): number | null {
    return this.read().maxDisplaySize;
  }

  writeAlwaysHide(alwaysHide: boolean): void {
    this.write({ ...this.read(), alwaysHide });
  }

  writeMaxDisplaySize(maxDisplaySize: number): void {
    if (!Number.isFinite(maxDisplaySize) || maxDisplaySize <= 0) return;
    this.write({ ...this.read(), maxDisplaySize });
  }

  private read(): RemoteHostedPipPreferences {
    try {
      return parsePreferences(JSON.parse(fs.readFileSync(this.filePath, "utf8")));
    } catch {
      return EMPTY_PREFERENCES;
    }
  }

  private write(preferences: RemoteHostedPipPreferences): void {
    const temporaryPath = `${this.filePath}.tmp`;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(temporaryPath, `${JSON.stringify(preferences, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, this.filePath);
  }
}
