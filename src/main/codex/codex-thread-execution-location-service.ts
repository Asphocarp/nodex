import type {
  CodexThreadExecutionLocation,
  CodexThreadHandoffPreparedArtifact,
  CodexThreadHandoffJournalEntry,
  CodexThreadHandoffPhase,
  CodexThreadHandoffJournalStore,
} from "./codex-thread-handoff-journal";

export interface CodexThreadHandoffPreparation {
  readonly destination: CodexThreadExecutionLocation;
  readonly prepared: CodexThreadHandoffPreparedArtifact;
}

export interface CodexThreadExecutionLocationEffects {
  resolveSource(threadId: string): Promise<CodexThreadExecutionLocation>;
  readCanonicalLocation(threadId: string): Promise<CodexThreadExecutionLocation | null>;
  stopActiveTurn(threadId: string): Promise<void>;
  prepareDestination(
    entry: CodexThreadHandoffJournalEntry,
    onPhase: (phase: string, status: "running" | "success" | "error") => void,
  ): Promise<CodexThreadHandoffPreparation>;
  switchRuntime(
    threadId: string,
    location: CodexThreadExecutionLocation,
    preparation: CodexThreadHandoffPreparation | null,
  ): Promise<void>;
  commitLocation(threadId: string, location: CodexThreadExecutionLocation): Promise<void>;
  projectLocation(threadId: string, location: CodexThreadExecutionLocation): Promise<void>;
  transferOwner(threadId: string, preparation: CodexThreadHandoffPreparation): Promise<void>;
  cleanup(
    preparation: CodexThreadHandoffPreparation,
    outcome: "committed" | "rolled-back",
  ): Promise<readonly string[]>;
  rollbackPreparation(preparation: CodexThreadHandoffPreparation): Promise<readonly string[]>;
  sendFollowUp(threadId: string, prompt: string): Promise<void>;
}

export interface CodexThreadHandoffProgress {
  readonly entry: CodexThreadHandoffJournalEntry;
  readonly detail: string | null;
}

export interface CodexStartThreadHandoffInput {
  readonly operationId: string;
  readonly threadId: string;
  readonly destinationHostId: string | null;
  readonly followUpPrompt: string | null;
  readonly onProgress?: (progress: CodexThreadHandoffProgress) => void;
}

const terminalPhases = new Set<CodexThreadHandoffPhase>([
  "completed",
  "completed-with-warning",
  "failed",
]);

function locationsEqual(
  left: CodexThreadExecutionLocation,
  right: CodexThreadExecutionLocation,
): boolean {
  return (
    left.hostId === right.hostId &&
    left.cwd === right.cwd &&
    left.managedWorktreePath === right.managedWorktreePath &&
    left.projectId === right.projectId &&
    left.projectlessOutputDirectory === right.projectlessOutputDirectory &&
    left.projectlessWorkspaceBrowserRoot === right.projectlessWorkspaceBrowserRoot &&
    left.workspaceRoots.length === right.workspaceRoots.length &&
    left.workspaceRoots.every((root, index) => root === right.workspaceRoots[index])
  );
}

/**
 * Main-owned compensation transaction. External systems cannot share one database
 * transaction, so every durable boundary is journaled before the next effect.
 */
export class CodexThreadExecutionLocationService {
  readonly #inFlightByThreadId = new Map<string, Promise<CodexThreadHandoffJournalEntry>>();

  constructor(
    private readonly options: {
      readonly effects: CodexThreadExecutionLocationEffects;
      readonly journal: CodexThreadHandoffJournalStore;
      readonly now?: () => number;
    },
  ) {}

  async start(input: CodexStartThreadHandoffInput): Promise<CodexThreadHandoffJournalEntry> {
    const existingOperation = await this.options.journal.get(input.operationId);
    if (existingOperation) return existingOperation;
    const existingThread = this.#inFlightByThreadId.get(input.threadId);
    if (existingThread) {
      throw new Error("This task already has a handoff in progress.");
    }
    const persisted = (await this.options.journal.list()).find(
      (entry) => entry.threadId === input.threadId && !terminalPhases.has(entry.phase),
    );
    if (persisted) {
      throw new Error("This task has an unfinished handoff that must be recovered first.");
    }

    const source = await this.options.effects.resolveSource(input.threadId);
    const now = this.#now();
    const entry: CodexThreadHandoffJournalEntry = {
      schemaVersion: 1,
      operationId: input.operationId,
      threadId: input.threadId,
      phase: "queued",
      source,
      requestedDestinationHostId: input.destinationHostId,
      destination: null,
      prepared: null,
      runtimeSwitched: false,
      coreCommitted: false,
      followUpPrompt: input.followUpPrompt,
      followUpDispatchStarted: false,
      warnings: [],
      lastError: null,
      failedPhase: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    await this.#save(entry, input.onProgress, null);
    const operation = this.#run(entry, input.onProgress);
    this.#inFlightByThreadId.set(input.threadId, operation);
    try {
      return await operation;
    } finally {
      if (this.#inFlightByThreadId.get(input.threadId) === operation) {
        this.#inFlightByThreadId.delete(input.threadId);
      }
    }
  }

  async recover(
    onProgress?: (progress: CodexThreadHandoffProgress) => void,
  ): Promise<readonly CodexThreadHandoffJournalEntry[]> {
    const entries = await this.options.journal.list();
    const recovered: CodexThreadHandoffJournalEntry[] = [];
    for (const entry of entries) {
      if (terminalPhases.has(entry.phase)) continue;
      let canonical: CodexThreadExecutionLocation | null;
      try {
        canonical = await this.options.effects.readCanonicalLocation(entry.threadId);
      } catch (error) {
        onProgress?.({
          entry,
          detail: `Recovery deferred: ${error instanceof Error ? error.message : String(error)}`,
        });
        recovered.push(entry);
        continue;
      }
      if (!canonical) {
        onProgress?.({
          entry,
          detail: "Recovery deferred: canonical task location is unavailable.",
        });
        recovered.push(entry);
        continue;
      }
      const coreCommitted =
        entry.destination !== null && locationsEqual(canonical, entry.destination);
      const coreAtSource = locationsEqual(canonical, entry.source);
      if (!coreCommitted && !coreAtSource) {
        onProgress?.({ entry, detail: "Recovery deferred: canonical task location is ambiguous." });
        recovered.push(entry);
        continue;
      }
      const reconciled =
        entry.coreCommitted === coreCommitted
          ? entry
          : await this.#patch(
              entry,
              { coreCommitted },
              onProgress,
              coreCommitted ? "Recovered durable location." : "Recovered source location.",
            );
      if (reconciled.coreCommitted && reconciled.destination && reconciled.prepared) {
        recovered.push(await this.#resumeCommitted(reconciled, onProgress));
        continue;
      }
      recovered.push(
        await this.#rollback(
          reconciled,
          new Error("Recovered an interrupted task handoff."),
          onProgress,
        ),
      );
    }
    return recovered;
  }

  async #run(
    initial: CodexThreadHandoffJournalEntry,
    onProgress?: (progress: CodexThreadHandoffProgress) => void,
  ): Promise<CodexThreadHandoffJournalEntry> {
    let entry = initial;
    try {
      entry = await this.#phase(entry, "stopping-turn", onProgress);
      await this.options.effects.stopActiveTurn(entry.threadId);

      entry = await this.#phase(entry, "preparing-destination", onProgress);
      const preparation = await this.options.effects.prepareDestination(entry, (detail, status) =>
        onProgress?.({ entry, detail: `${detail}:${status}` }),
      );
      entry = await this.#patch(
        entry,
        {
          destination: preparation.destination,
          prepared: preparation.prepared,
          warnings: [...entry.warnings, ...preparation.prepared.warnings],
        },
        onProgress,
        null,
      );

      entry = await this.#phase(entry, "switching-runtime", onProgress);
      await this.options.effects.switchRuntime(
        entry.threadId,
        preparation.destination,
        preparation,
      );
      entry = await this.#patch(entry, { runtimeSwitched: true }, onProgress, null);

      entry = await this.#phase(entry, "committing-location", onProgress);
      await this.options.effects.commitLocation(entry.threadId, preparation.destination);
      entry = await this.#patch(entry, { coreCommitted: true }, onProgress, null);

      await this.options.effects.projectLocation(entry.threadId, preparation.destination);
      entry = await this.#phase(entry, "transferring-owner", onProgress);
      try {
        await this.options.effects.transferOwner(entry.threadId, preparation);
      } catch (error) {
        entry = await this.#addWarning(entry, error, onProgress);
      }

      return await this.#finishCommitted(entry, onProgress);
    } catch (error) {
      return await this.#rollback(entry, error, onProgress);
    }
  }

  async #finishCommitted(
    initial: CodexThreadHandoffJournalEntry,
    onProgress?: (progress: CodexThreadHandoffProgress) => void,
  ): Promise<CodexThreadHandoffJournalEntry> {
    if (!initial.destination || !initial.prepared) {
      return await this.#rollback(
        initial,
        new Error("Committed handoff is missing its destination artifact."),
        onProgress,
      );
    }
    const destination = initial.destination;
    const prepared = initial.prepared;
    let entry = initial;

    entry = await this.#phase(entry, "cleaning-source", onProgress);
    try {
      const warnings = await this.options.effects.cleanup(
        {
          destination,
          prepared,
        },
        "committed",
      );
      if (warnings.length > 0) {
        entry = await this.#patch(
          entry,
          {
            warnings: [...entry.warnings, ...warnings],
          },
          onProgress,
          warnings.join("; "),
        );
      }
    } catch (error) {
      entry = await this.#addWarning(entry, error, onProgress);
    }

    const followUpPrompt = entry.followUpPrompt;
    if (followUpPrompt && !entry.followUpDispatchStarted) {
      entry = await this.#patch(
        entry,
        { followUpDispatchStarted: true },
        onProgress,
        "Dispatching follow-up.",
      );
      try {
        await this.options.effects.sendFollowUp(entry.threadId, followUpPrompt);
      } catch (error) {
        entry = await this.#addWarning(entry, error, onProgress);
      }
    }

    const completedAt = this.#now();
    return await this.#patch(
      entry,
      {
        phase: entry.warnings.length > 0 ? "completed-with-warning" : "completed",
        completedAt,
        lastError: null,
      },
      onProgress,
      entry.warnings.at(-1) ?? null,
    );
  }

  async #resumeCommitted(
    initial: CodexThreadHandoffJournalEntry,
    onProgress?: (progress: CodexThreadHandoffProgress) => void,
  ): Promise<CodexThreadHandoffJournalEntry> {
    if (!initial.destination || !initial.prepared) {
      return await this.#rollback(
        initial,
        new Error("Committed handoff is missing its destination artifact."),
        onProgress,
      );
    }
    const preparation = {
      destination: initial.destination,
      prepared: initial.prepared,
    } satisfies CodexThreadHandoffPreparation;
    let entry = initial;
    try {
      await this.options.effects.switchRuntime(
        entry.threadId,
        preparation.destination,
        preparation,
      );
      await this.options.effects.projectLocation(entry.threadId, preparation.destination);
      entry = await this.#phase(entry, "transferring-owner", onProgress);
      try {
        await this.options.effects.transferOwner(entry.threadId, preparation);
      } catch (error) {
        entry = await this.#addWarning(entry, error, onProgress);
      }
      return await this.#finishCommitted(entry, onProgress);
    } catch (error) {
      return await this.#rollback(entry, error, onProgress);
    }
  }

  async #rollback(
    initial: CodexThreadHandoffJournalEntry,
    error: unknown,
    onProgress?: (progress: CodexThreadHandoffProgress) => void,
  ): Promise<CodexThreadHandoffJournalEntry> {
    let entry = await this.#patch(
      initial,
      {
        phase: "rolling-back",
        lastError: error instanceof Error ? error.message : String(error),
        failedPhase: initial.phase,
      },
      onProgress,
      "Rolling back task handoff.",
    );
    const rollbackWarnings: string[] = [];
    const preparation =
      entry.destination && entry.prepared
        ? { destination: entry.destination, prepared: entry.prepared }
        : null;

    if (preparation) {
      await this.options.effects
        .switchRuntime(entry.threadId, entry.source, preparation)
        .catch((rollbackError) =>
          rollbackWarnings.push(
            `runtime rollback: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          ),
        );
    }
    if (entry.coreCommitted) {
      await this.options.effects
        .commitLocation(entry.threadId, entry.source)
        .catch((rollbackError) =>
          rollbackWarnings.push(
            `Core rollback: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          ),
        );
    }
    if (preparation) {
      const preparedWarnings = await this.options.effects
        .rollbackPreparation(preparation)
        .catch((rollbackError) => {
          rollbackWarnings.push(
            `Git rollback: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          );
          return [];
        });
      rollbackWarnings.push(...preparedWarnings);
      await this.options.effects
        .cleanup(preparation, "rolled-back")
        .catch((rollbackError) =>
          rollbackWarnings.push(
            `artifact cleanup: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          ),
        );
    }
    await this.options.effects
      .projectLocation(entry.threadId, entry.source)
      .catch((rollbackError) =>
        rollbackWarnings.push(
          `projection rollback: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        ),
      );

    entry = await this.#patch(
      entry,
      {
        phase: "failed",
        runtimeSwitched: false,
        coreCommitted: false,
        warnings: [...entry.warnings, ...rollbackWarnings],
        completedAt: this.#now(),
      },
      onProgress,
      rollbackWarnings.at(-1) ?? entry.lastError,
    );
    return entry;
  }

  async #phase(
    entry: CodexThreadHandoffJournalEntry,
    phase: CodexThreadHandoffPhase,
    onProgress?: (progress: CodexThreadHandoffProgress) => void,
  ): Promise<CodexThreadHandoffJournalEntry> {
    return await this.#patch(entry, { phase }, onProgress, null);
  }

  async #addWarning(
    entry: CodexThreadHandoffJournalEntry,
    error: unknown,
    onProgress?: (progress: CodexThreadHandoffProgress) => void,
  ): Promise<CodexThreadHandoffJournalEntry> {
    const warning = error instanceof Error ? error.message : String(error);
    return await this.#patch(
      entry,
      {
        warnings: [...entry.warnings, warning],
      },
      onProgress,
      warning,
    );
  }

  async #patch(
    entry: CodexThreadHandoffJournalEntry,
    patch: Partial<CodexThreadHandoffJournalEntry>,
    onProgress: ((progress: CodexThreadHandoffProgress) => void) | undefined,
    detail: string | null,
  ): Promise<CodexThreadHandoffJournalEntry> {
    const next: CodexThreadHandoffJournalEntry = {
      ...entry,
      ...patch,
      schemaVersion: 1,
      operationId: entry.operationId,
      threadId: entry.threadId,
      createdAt: entry.createdAt,
      updatedAt: this.#now(),
    };
    await this.#save(next, onProgress, detail);
    return next;
  }

  async #save(
    entry: CodexThreadHandoffJournalEntry,
    onProgress: ((progress: CodexThreadHandoffProgress) => void) | undefined,
    detail: string | null,
  ): Promise<void> {
    await this.options.journal.put(entry);
    onProgress?.({ entry, detail });
  }

  #now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
