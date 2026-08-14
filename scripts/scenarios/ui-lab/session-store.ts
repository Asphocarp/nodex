import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const STORE_VERSION = 2 as const;
const STORE_FILE = ".cache/scenarios/ui-lab-sessions-v2.json";

export interface UiLabScenarioSeedProvenance {
  readonly kind: "scenario";
  readonly scenarioId: string;
  readonly scenarioRevision: number;
}

export interface UiLabSessionRecord {
  readonly sessionId: string;
  readonly runRoot: string;
  readonly repositoryRealpath: string;
  readonly seed: UiLabScenarioSeedProvenance;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UiLabSessionStore {
  record(session: UiLabSessionRecord): Promise<void>;
  find(sessionId: string): Promise<UiLabSessionRecord | null>;
}

interface StoredUiLabSessions {
  readonly version: typeof STORE_VERSION;
  readonly sessions: readonly UiLabSessionRecord[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const parseSessionRecord = (value: unknown): UiLabSessionRecord => {
  if (!isRecord(value) || !isRecord(value.seed)) {
    throw new Error("UI Lab session store is invalid");
  }
  const seed = value.seed;
  if (
    !isNonEmptyString(value.sessionId)
    || !isNonEmptyString(value.runRoot)
    || !path.isAbsolute(value.runRoot)
    || !isNonEmptyString(value.repositoryRealpath)
    || !isNonEmptyString(value.createdAt)
    || !isNonEmptyString(value.updatedAt)
    || seed.kind !== "scenario"
    || !isNonEmptyString(seed.scenarioId)
    || typeof seed.scenarioRevision !== "number"
  ) {
    throw new Error("UI Lab session store is invalid");
  }
  return value as unknown as UiLabSessionRecord;
};

const parseStoredSessions = (value: unknown): StoredUiLabSessions => {
  if (
    !isRecord(value)
    || value.version !== STORE_VERSION
    || !Array.isArray(value.sessions)
  ) {
    throw new Error("UI Lab session store is invalid");
  }
  return {
    version: STORE_VERSION,
    sessions: value.sessions.map(parseSessionRecord),
  };
};

/**
 * Persists only discovery metadata. The retained Profile and its owned manifest
 * remain authoritative for session identity and seed provenance.
 */
export const createUiLabSessionStore = (
  repositoryRoot: string,
): UiLabSessionStore => {
  const storePath = path.join(path.resolve(repositoryRoot), STORE_FILE);
  const read = async (): Promise<StoredUiLabSessions> => {
    try {
      return parseStoredSessions(JSON.parse(await readFile(storePath, "utf8")));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { version: STORE_VERSION, sessions: [] };
      }
      throw error;
    }
  };

  return {
    record: async (session) => {
      const current = await read();
      const sessions = [
        session,
        ...current.sessions.filter((entry) => entry.sessionId !== session.sessionId),
      ];
      await mkdir(path.dirname(storePath), { recursive: true });
      const temporary = `${storePath}.${process.pid}.tmp`;
      await writeFile(
        temporary,
        `${JSON.stringify({ version: STORE_VERSION, sessions }, null, 2)}\n`,
        { mode: 0o600 },
      );
      await rename(temporary, storePath);
    },
    find: async (sessionId) => {
      const candidate = (await read()).sessions.find(
        (entry) => entry.sessionId === sessionId,
      );
      if (!candidate) return null;
      try {
        const stats = await lstat(candidate.runRoot);
        if (stats.isDirectory() && !stats.isSymbolicLink()) return candidate;
        return null;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
  };
};
