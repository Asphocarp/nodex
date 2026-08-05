import type { CoreLocalCommitEnvelope } from "./types";

export type LocalCommitIngress = "apply" | "tailer" | "replay" | "resolve";

export type LocalCommitDispatchAdmission =
  | { readonly kind: "accepted"; readonly key: string }
  | { readonly kind: "duplicate"; readonly key: string }
  | { readonly kind: "enriched"; readonly key: string };

export interface LocalCommitDispatcherInput {
  /** Runs synchronously at identity admission. It must not await renderer work. */
  readonly onAdmitted?: (
    commit: CoreLocalCommitEnvelope,
    source: LocalCommitIngress,
  ) => void;
  readonly onCommit: (
    commit: CoreLocalCommitEnvelope,
    source: LocalCommitIngress,
  ) => void | Promise<void>;
  readonly onEnriched?: (
    commit: CoreLocalCommitEnvelope,
    source: LocalCommitIngress,
  ) => void | Promise<void>;
  readonly onError?: (error: unknown, commit: CoreLocalCommitEnvelope) => void;
  readonly expectedStoreEpoch?: string;
  readonly maxRememberedCommits?: number;
  readonly maxDeliveryAttempts?: number;
}

interface PendingCommit {
  commit: CoreLocalCommitEnvelope;
  source: LocalCommitIngress;
  attempts: number;
  started: boolean;
}

interface LocalCommitCoverage {
  readonly effectSequences: ReadonlySet<number>;
  readonly documentEffectKeys: ReadonlySet<string>;
  readonly inlineDocumentEffectKeys: ReadonlySet<string>;
  readonly projectionImpact: CoreLocalCommitEnvelope["projection_impact"];
}

interface RememberedCommit {
  readonly hash: string;
  readonly coverage: LocalCommitCoverage;
}

const commitKey = (commit: CoreLocalCommitEnvelope): string => {
  if (!Number.isSafeInteger(commit.commit_seq) || commit.commit_seq < 1) {
    throw new Error("LocalCommit sequence is invalid");
  }
  if (!commit.store_epoch || commit.store_epoch.trim() !== commit.store_epoch) {
    throw new Error("LocalCommit store epoch is invalid");
  }
  if (!commit.canonical_hash || !/^[a-f0-9]{64}$/u.test(commit.canonical_hash)) {
    throw new Error("LocalCommit canonical hash is invalid");
  }
  if (commit.effects.length === 0) {
    throw new Error("LocalCommit must contain at least one physical effect");
  }
  return `${commit.store_epoch}:${commit.commit_seq}`;
};

const documentEffectKey = (effect: CoreLocalCommitEnvelope["effects"][number]): string => {
  if (effect.payload.module !== "owned_document") return "";
  const event = effect.payload.event;
  return `${effect.sequence}:${event.document_id}:${event.kind}`;
};

const coverageOf = (commit: CoreLocalCommitEnvelope): LocalCommitCoverage => {
  const documentEffects = commit.effects.filter((effect) =>
    effect.payload.module === "owned_document"
  );
  return {
    effectSequences: new Set(commit.effects.map((effect) => effect.sequence)),
    documentEffectKeys: new Set(
      documentEffects
        .map(documentEffectKey)
        .filter((key) => key.length > 0),
    ),
    inlineDocumentEffectKeys: new Set(
      documentEffects
        .filter((effect) =>
          effect.payload.module === "owned_document"
          && effect.payload.event.kind === "document_updated"
          && effect.payload.event.update.length > 0
        )
        .map(documentEffectKey),
    ),
    projectionImpact: commit.projection_impact,
  };
};

const setCovers = <Value>(
  current: ReadonlySet<Value>,
  candidate: ReadonlySet<Value>,
): boolean => {
  for (const value of current) {
    if (!candidate.has(value)) return false;
  }
  return true;
};

const impactCovers = (
  current: LocalCommitCoverage["projectionImpact"],
  candidate: LocalCommitCoverage["projectionImpact"],
): boolean => {
  if (current.kind === "none") return candidate.kind !== "none";
  if (candidate.kind === "all") return true;
  if (candidate.kind === "none") return false;
  if (current.kind === "all") return false;
  return [
    [current.page_ids, candidate.page_ids],
    [current.database_ids, candidate.database_ids],
    [current.data_source_ids, candidate.data_source_ids],
    [current.view_ids, candidate.view_ids],
    [
      current.document_heads.map((head) => `${head.page_id}:${head.document_id}:${head.generation}:${head.head_seq}`),
      candidate.document_heads.map((head) => `${head.page_id}:${head.document_id}:${head.generation}:${head.head_seq}`),
    ],
  ].every(([required, available]) => setCovers(
    new Set(required),
    new Set(available),
  ));
};

const coverageCovers = (
  current: LocalCommitCoverage,
  candidate: LocalCommitCoverage,
): boolean => {
  return setCovers(
    current.effectSequences,
    candidate.effectSequences,
  )
    && setCovers(
      current.documentEffectKeys,
      candidate.documentEffectKeys,
    )
    && setCovers(
      current.inlineDocumentEffectKeys,
      candidate.inlineDocumentEffectKeys,
    )
    && impactCovers(
      current.projectionImpact,
      candidate.projectionImpact,
    );
};

const isRicherCoverage = (
  candidate: LocalCommitCoverage,
  current: LocalCommitCoverage,
): boolean => {
  if (!coverageCovers(current, candidate)) return false;
  return !setCovers(
    candidate.effectSequences,
    current.effectSequences,
  )
    || !setCovers(
      candidate.documentEffectKeys,
      current.documentEffectKeys,
    )
    || !setCovers(
      candidate.inlineDocumentEffectKeys,
      current.inlineDocumentEffectKeys,
    )
    || !impactCovers(
      candidate.projectionImpact,
      current.projectionImpact,
    );
};

const isRicher = (
  candidate: CoreLocalCommitEnvelope,
  current: CoreLocalCommitEnvelope,
): boolean => isRicherCoverage(coverageOf(candidate), coverageOf(current));

const notifyAdmitted = (
  callback: LocalCommitDispatcherInput["onAdmitted"],
  onError: LocalCommitDispatcherInput["onError"],
  commit: CoreLocalCommitEnvelope,
  source: LocalCommitIngress,
): void => {
  if (!callback) return;
  try {
    callback(commit, source);
  } catch (error) {
    onError?.(error, commit);
  }
};

const notifyEnriched = (
  callback: LocalCommitDispatcherInput["onEnriched"],
  onError: LocalCommitDispatcherInput["onError"],
  commit: CoreLocalCommitEnvelope,
  source: LocalCommitIngress,
): void => {
  if (!callback) return;
  try {
    const result = callback(commit, source);
    if (result instanceof Promise) {
      void result.catch((error: unknown) => onError?.(error, commit));
    }
  } catch (error) {
    onError?.(error, commit);
  }
};

/**
 * Admits LocalCommit envelopes synchronously, then drains them in one ordered
 * queue. The apply-response path therefore never waits for projection, while
 * the durable tailer can deliver the same identity later and be deduplicated.
 * A failed delivery is not acknowledged: it is retried a bounded number of
 * times and remains replayable after the dispatcher gives the error to its
 * owner.
 */
export class LocalCommitDispatcher {
  readonly #onAdmitted: LocalCommitDispatcherInput["onAdmitted"];
  readonly #onCommit: LocalCommitDispatcherInput["onCommit"];
  readonly #onEnriched: LocalCommitDispatcherInput["onEnriched"];
  readonly #onError: LocalCommitDispatcherInput["onError"];
  readonly #expectedStoreEpoch: string | undefined;
  readonly #maxRememberedCommits: number;
  readonly #maxDeliveryAttempts: number;
  readonly #seen = new Map<string, RememberedCommit>();
  readonly #pending = new Map<string, PendingCommit>();
  readonly #queue: string[] = [];
  #tail: Promise<void> = Promise.resolve();
  #draining = false;

  constructor(input: LocalCommitDispatcherInput) {
    this.#onAdmitted = input.onAdmitted;
    this.#onCommit = input.onCommit;
    this.#onEnriched = input.onEnriched;
    this.#onError = input.onError;
    this.#expectedStoreEpoch = input.expectedStoreEpoch;
    this.#maxRememberedCommits = Math.max(
      1,
      Math.floor(input.maxRememberedCommits ?? 100_000),
    );
    this.#maxDeliveryAttempts = Math.max(
      1,
      Math.floor(input.maxDeliveryAttempts ?? 3),
    );
  }

  /**
   * Admission is intentionally synchronous. Callers may ignore the returned
   * diagnostic, but they never have to wait for a renderer/projection tail.
   */
  accept(
    commit: CoreLocalCommitEnvelope,
    source: LocalCommitIngress,
  ): LocalCommitDispatchAdmission {
    const key = commitKey(commit);
    if (
      this.#expectedStoreEpoch !== undefined
      && commit.store_epoch !== this.#expectedStoreEpoch
    ) {
      throw new Error(`LocalCommit belongs to another store epoch: ${key}`);
    }

    const known = this.#seen.get(key);
    if (known !== undefined) {
      if (known.hash !== commit.canonical_hash) {
        const error = new Error(`LocalCommit identity collision for ${key}`);
        this.#onError?.(error, commit);
        throw error;
      }
      const coverage = coverageOf(commit);
      if (isRicherCoverage(coverage, known.coverage)) {
        notifyEnriched(this.#onEnriched, this.#onError, commit, source);
        this.#remember(key, commit);
        return { kind: "enriched", key };
      }
      return { kind: "duplicate", key };
    }

    const pending = this.#pending.get(key);
    if (pending !== undefined) {
      if (pending.commit.canonical_hash !== commit.canonical_hash) {
        const error = new Error(`LocalCommit identity collision for ${key}`);
        this.#onError?.(error, commit);
        throw error;
      }
      if (isRicher(commit, pending.commit)) {
        // The first admission may already have published a sparse response
        // before the durable tailer supplies its inline document resources.
        // Republish the richer envelope even when projection delivery has not
        // started; the bridge deduplicates the semantic effect and only
        // delivers missing resources.
        notifyEnriched(this.#onEnriched, this.#onError, commit, source);
        if (!pending.started) {
          pending.commit = commit;
          pending.source = source === "apply" ? pending.source : source;
          this.#scheduleDrain();
          return { kind: "enriched", key };
        }
        return { kind: "enriched", key };
      }
      return { kind: "duplicate", key };
    }

    this.#pending.set(key, {
      commit,
      source,
      attempts: 0,
      started: false,
    });
    this.#queue.push(key);
    notifyAdmitted(this.#onAdmitted, this.#onError, commit, source);
    this.#scheduleDrain();
    return { kind: "accepted", key };
  }

  /** Resolves when all admissions made so far have drained. */
  waitForIdle(): Promise<void> {
    return this.#tail;
  }

  get rememberedCount(): number {
    return this.#seen.size;
  }

  #scheduleDrain(): void {
    if (this.#draining) return;
    this.#draining = true;
    const previousTail = this.#tail;
    this.#tail = previousTail.then(() => new Promise<void>((resolve) => {
      // Batch all envelopes admitted in the current turn. In particular, a
      // sparse apply response can be enriched by the same-turn durable tailer
      // before projection starts.
      queueMicrotask(() => {
        void this.#drain()
          .catch((error) => {
            const key = this.#queue[0];
            const pending = key === undefined ? undefined : this.#pending.get(key);
            if (pending) {
              this.#onError?.(error, pending.commit);
              return;
            }
            throw error;
          })
          .finally(resolve);
      });
    }))
      .finally(() => {
        this.#draining = false;
        if (this.#queue.length > 0) this.#scheduleDrain();
      });
  }

  async #drain(): Promise<void> {
    while (this.#queue.length > 0) {
      const key = this.#queue.shift();
      if (key === undefined) continue;
      const pending = this.#pending.get(key);
      if (pending === undefined) continue;
      pending.started = true;
      try {
        await this.#onCommit(pending.commit, pending.source);
        this.#pending.delete(key);
        this.#remember(key, pending.commit);
      } catch (error) {
        pending.started = false;
        pending.attempts += 1;
        if (pending.attempts < this.#maxDeliveryAttempts) {
          this.#queue.push(key);
          continue;
        }
        this.#pending.delete(key);
        this.#onError?.(error, pending.commit);
      }
    }
  }

  #remember(key: string, commit: CoreLocalCommitEnvelope): void {
    this.#seen.delete(key);
    this.#seen.set(key, {
      hash: commit.canonical_hash,
      coverage: coverageOf(commit),
    });
    while (this.#seen.size > this.#maxRememberedCommits) {
      const oldest = this.#seen.keys().next().value;
      if (oldest === undefined) return;
      this.#seen.delete(oldest);
    }
  }

}
