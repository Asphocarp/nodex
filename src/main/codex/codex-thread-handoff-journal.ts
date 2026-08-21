import { lstat, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writeDurableJson } from "../durable-json-file";
import type { CodexExecutionHostFileDescriptor } from "./codex-execution-host-file-transfer";
import type { CodexWorktreeWorkerPreparedHandoff } from "./codex-worktree-worker-port";

const JOURNAL_SCHEMA_VERSION = 1 as const;
const JOURNAL_MAX_BYTES = 512 * 1024;
const JOURNAL_MAX_ENTRIES = 128;

export const CODEX_THREAD_HANDOFF_PHASES = [
  "queued",
  "stopping-turn",
  "preparing-destination",
  "switching-runtime",
  "committing-location",
  "transferring-owner",
  "cleaning-source",
  "completed",
  "completed-with-warning",
  "rolling-back",
  "failed",
] as const;

export type CodexThreadHandoffPhase = (typeof CODEX_THREAD_HANDOFF_PHASES)[number];

export interface CodexThreadExecutionLocation {
  readonly hostId: string;
  readonly cwd: string;
  readonly workspaceRoots: readonly string[];
  readonly managedWorktreePath: string | null;
  readonly projectId: string | null;
  readonly projectlessOutputDirectory: string | null;
  readonly projectlessWorkspaceBrowserRoot: string | null;
}

export interface CodexCrossHostPreparedHandoff {
  readonly direction: "cross-host";
  readonly sourceHostId: string;
  readonly destinationHostId: string;
  readonly transferId: string;
  readonly sourceBranch: string;
  readonly sourceWorkspaceRoot: string;
  readonly sourceManagedWorktreePath: string | null;
  readonly destinationWorkspaceRoot: string;
  readonly destinationGitRoot: string;
  readonly managedWorktreePath: string;
  readonly createdWorktree: true;
  readonly sourceRepositoryPath: string;
  readonly destinationRepositoryPath: string;
  readonly sourceTemporaryRef: string;
  readonly destinationTemporaryRef: string;
  readonly sourceStagingRoot: string;
  readonly destinationStagingRoot: string;
  readonly relayRoot: string;
  readonly sourceBundle: CodexExecutionHostFileDescriptor;
  readonly destinationBundle: CodexExecutionHostFileDescriptor;
  readonly sourceRollout: CodexExecutionHostFileDescriptor;
  readonly destinationRollout: CodexExecutionHostFileDescriptor;
  readonly destinationRolloutCreated: boolean;
  readonly warnings: readonly string[];
}

export type CodexThreadHandoffPreparedArtifact =
  | CodexWorktreeWorkerPreparedHandoff
  | CodexCrossHostPreparedHandoff;

export interface CodexThreadHandoffJournalEntry {
  readonly schemaVersion: typeof JOURNAL_SCHEMA_VERSION;
  readonly operationId: string;
  readonly threadId: string;
  readonly phase: CodexThreadHandoffPhase;
  readonly source: CodexThreadExecutionLocation;
  readonly requestedDestinationHostId: string | null;
  readonly destination: CodexThreadExecutionLocation | null;
  readonly prepared: CodexThreadHandoffPreparedArtifact | null;
  readonly runtimeSwitched: boolean;
  readonly coreCommitted: boolean;
  readonly followUpPrompt: string | null;
  readonly followUpDispatchStarted: boolean;
  readonly warnings: readonly string[];
  readonly lastError: string | null;
  readonly failedPhase: CodexThreadHandoffPhase | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly completedAt: number | null;
}

const absolutePath = z.string().min(1).max(8_192).refine(path.isAbsolute);
const locationSchema = z
  .object({
    hostId: z.string().min(1).max(512),
    cwd: absolutePath,
    workspaceRoots: z.array(absolutePath).max(128),
    managedWorktreePath: absolutePath.nullable(),
    projectId: z.string().min(1).max(1_024).nullable(),
    projectlessOutputDirectory: absolutePath.nullable(),
    projectlessWorkspaceBrowserRoot: absolutePath.nullable(),
  })
  .strict();
const preparedCommon = {
  sourceBranch: z.string().min(1).max(1_024),
  sourceWorkspaceRoot: absolutePath,
  destinationWorkspaceRoot: absolutePath,
  destinationGitRoot: absolutePath,
  managedWorktreePath: absolutePath,
  warnings: z.array(z.string().max(64_000)).max(128),
};
const fileDescriptorSchema = z
  .object({
    path: absolutePath,
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    size: z
      .number()
      .int()
      .nonnegative()
      .max(2 * 1024 * 1024 * 1024),
  })
  .strict();
const preparedSchema = z.discriminatedUnion("direction", [
  z
    .object({
      direction: z.literal("to-worktree"),
      ...preparedCommon,
      localCheckoutBranch: z.string().min(1).max(1_024),
      destinationBranch: z.string().min(1).max(1_024),
      createdWorktree: z.literal(true),
    })
    .strict(),
  z
    .object({
      direction: z.literal("to-checkout"),
      ...preparedCommon,
      localCheckoutPreviousBranch: z.string().min(1).max(1_024).nullable(),
      createdWorktree: z.literal(false),
    })
    .strict(),
  z
    .object({
      direction: z.literal("cross-host"),
      ...preparedCommon,
      sourceHostId: z.string().min(1).max(512),
      destinationHostId: z.string().min(1).max(512),
      transferId: z.string().regex(/^[a-f0-9]{32}$/u),
      sourceManagedWorktreePath: absolutePath.nullable(),
      createdWorktree: z.literal(true),
      sourceRepositoryPath: absolutePath,
      destinationRepositoryPath: absolutePath,
      sourceTemporaryRef: z.string().min(1).max(1_024),
      destinationTemporaryRef: z.string().min(1).max(1_024),
      sourceStagingRoot: absolutePath,
      destinationStagingRoot: absolutePath,
      relayRoot: absolutePath,
      sourceBundle: fileDescriptorSchema,
      destinationBundle: fileDescriptorSchema,
      sourceRollout: fileDescriptorSchema,
      destinationRollout: fileDescriptorSchema,
      destinationRolloutCreated: z.boolean(),
    })
    .strict(),
]);
const entrySchema = z
  .object({
    schemaVersion: z.literal(JOURNAL_SCHEMA_VERSION),
    operationId: z.string().min(1).max(1_024),
    threadId: z.string().min(1).max(1_024),
    phase: z.enum(CODEX_THREAD_HANDOFF_PHASES),
    source: locationSchema,
    requestedDestinationHostId: z.string().min(1).max(512).nullable().default(null),
    destination: locationSchema.nullable(),
    prepared: preparedSchema.nullable(),
    runtimeSwitched: z.boolean(),
    coreCommitted: z.boolean(),
    followUpPrompt: z.string().max(64_000).nullable(),
    followUpDispatchStarted: z.boolean(),
    warnings: z.array(z.string().max(64_000)).max(128),
    lastError: z.string().max(64_000).nullable(),
    failedPhase: z.enum(CODEX_THREAD_HANDOFF_PHASES).nullable(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    completedAt: z.number().int().nonnegative().nullable(),
  })
  .strict();
const journalSchema = z
  .object({
    schemaVersion: z.literal(JOURNAL_SCHEMA_VERSION),
    entries: z.array(entrySchema).max(JOURNAL_MAX_ENTRIES),
  })
  .strict();

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isTerminal(entry: CodexThreadHandoffJournalEntry): boolean {
  return (
    entry.phase === "completed" ||
    entry.phase === "completed-with-warning" ||
    entry.phase === "failed"
  );
}

export class CodexThreadHandoffJournalStore {
  readonly #entries = new Map<string, CodexThreadHandoffJournalEntry>();
  #loaded = false;
  #writeTail = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly now: () => number = Date.now,
  ) {}

  async list(): Promise<readonly CodexThreadHandoffJournalEntry[]> {
    await this.#load();
    return [...this.#entries.values()].sort((left, right) => left.createdAt - right.createdAt);
  }

  async get(operationId: string): Promise<CodexThreadHandoffJournalEntry | null> {
    await this.#load();
    return this.#entries.get(operationId) ?? null;
  }

  async put(entry: CodexThreadHandoffJournalEntry): Promise<void> {
    const parsed = entrySchema.parse(entry) as CodexThreadHandoffJournalEntry;
    await this.#load();
    this.#entries.set(parsed.operationId, parsed);
    await this.#persist();
  }

  async #load(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const metadata = await lstat(this.filePath);
      if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > JOURNAL_MAX_BYTES) {
        await this.#quarantine();
        return;
      }
      const raw = await readFile(this.filePath, "utf8");
      const parsed = journalSchema.safeParse(JSON.parse(raw) as unknown);
      if (!parsed.success) {
        await this.#quarantine();
        return;
      }
      for (const entry of parsed.data.entries) {
        this.#entries.set(entry.operationId, entry as CodexThreadHandoffJournalEntry);
      }
    } catch (error) {
      if (isMissing(error)) return;
      if (error instanceof SyntaxError) {
        await this.#quarantine();
        return;
      }
      this.#loaded = false;
      throw error;
    }
  }

  async #persist(): Promise<void> {
    const operation = async (): Promise<void> => {
      const entries = [...this.#entries.values()].sort(
        (left, right) => right.updatedAt - left.updatedAt,
      );
      const active = entries.filter((entry) => !isTerminal(entry));
      const terminal = entries
        .filter(isTerminal)
        .slice(0, Math.max(0, JOURNAL_MAX_ENTRIES - active.length));
      const retained = [...active, ...terminal].sort(
        (left, right) => left.createdAt - right.createdAt,
      );
      this.#entries.clear();
      for (const entry of retained) this.#entries.set(entry.operationId, entry);
      await writeDurableJson(
        this.filePath,
        {
          schemaVersion: JOURNAL_SCHEMA_VERSION,
          entries: retained,
        },
        JOURNAL_MAX_BYTES,
      );
    };
    const result = this.#writeTail.then(operation, operation);
    this.#writeTail = result.catch(() => undefined);
    await result;
  }

  async #quarantine(): Promise<void> {
    try {
      await rename(this.filePath, `${this.filePath}.corrupt-${this.now()}`);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    await rm(this.filePath, { force: true });
  }
}

export function resolveCodexThreadHandoffJournalPath(runtimeStateHome: string): string {
  return path.join(runtimeStateHome, "recovery", "thread-handoffs-v1.json");
}
