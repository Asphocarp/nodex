import {
  assertLocalCommitEnvelope,
  compareLocalCommitCursor,
  localCommitCursorKey,
  type LocalCommitCursor,
  type LocalCommitEnvelope,
  type LocalCommitIdentity,
  type LocalCommitPayloadCompleteness,
} from "../../shared/local-commit";

export type LocalCommitSource = "apply" | "resolve" | "tailer" | "replay";

export type LocalCommitAdmission =
  | { readonly kind: "new"; readonly identity: LocalCommitIdentity }
  | { readonly kind: "duplicate"; readonly identity: LocalCommitIdentity }
  | { readonly kind: "enriched"; readonly identity: LocalCommitIdentity }
  | { readonly kind: "epoch-mismatch"; readonly identity: LocalCommitIdentity };

export type LocalCommitListener = (
  envelope: LocalCommitEnvelope,
  source: LocalCommitSource,
) => void | Promise<void>;

export interface LocalCommitDispatcherInput {
  readonly initialCursor?: LocalCommitCursor;
  /**
   * Number of tailer-confirmed commit identities retained for late apply
   * responses.  Commits newer than the tailer cursor are never evicted just
   * to satisfy this bound: without durable confirmation, eviction would make
   * a later tailer delivery observable twice.
   */
  readonly maxRememberedCommits?: number;
  readonly onListenerError?: (error: unknown, envelope: LocalCommitEnvelope) => void;
}

export class LocalCommitProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalCommitProtocolError";
  }
}

interface StoredCommit {
  envelope: LocalCommitEnvelope;
  readonly payloadCompleteness: LocalCommitPayloadCompleteness;
}

interface ListenerState {
  readonly listener: LocalCommitListener;
  tail: Promise<void>;
}

/**
 * Admits apply responses and durable replay into one delivery seam.
 *
 * `accept` is deliberately synchronous: admission is not allowed to wait for
 * a slow renderer, projection reread, or durable stream.  Delivery remains
 * serial per listener so a single consumer never observes its own effects out
 * of order, while independent consumers do not block one another.
 */
export class LocalCommitDispatcher {
  readonly #onListenerError: LocalCommitDispatcherInput["onListenerError"];
  readonly #maxRememberedCommits: number;
  readonly #commits = new Map<string, StoredCommit>();
  readonly #listeners = new Set<ListenerState>();
  #tailerCursor: LocalCommitCursor | undefined;
  #evictedThrough: LocalCommitCursor | undefined;

  constructor(input: LocalCommitDispatcherInput = {}) {
    this.#onListenerError = input.onListenerError;
    const maxRememberedCommits = input.maxRememberedCommits ?? 4096;
    if (
      !Number.isSafeInteger(maxRememberedCommits)
      || maxRememberedCommits < 1
    ) {
      throw new Error("maxRememberedCommits must be a positive safe integer");
    }
    this.#maxRememberedCommits = maxRememberedCommits;
    this.#tailerCursor = input.initialCursor;
  }

  get tailerCursor(): LocalCommitCursor | undefined {
    return this.#tailerCursor;
  }

  subscribe(listener: LocalCommitListener): () => void {
    const state: ListenerState = { listener, tail: Promise.resolve() };
    this.#listeners.add(state);
    return () => {
      this.#listeners.delete(state);
    };
  }

  accept(
    envelope: LocalCommitEnvelope,
    source: LocalCommitSource,
  ): LocalCommitAdmission {
    assertLocalCommitEnvelope(envelope);
    const identity = {
      ...envelope.cursor,
      commitId: envelope.commitId,
    } satisfies LocalCommitIdentity;

    if (
      this.#tailerCursor !== undefined
      && envelope.cursor.storeEpoch !== this.#tailerCursor.storeEpoch
    ) {
      return { kind: "epoch-mismatch", identity };
    }

    const key = localCommitCursorKey(envelope.cursor);
    const existing = this.#commits.get(key);
    if (existing !== undefined) {
      this.#assertSameIdentity(existing.envelope, envelope);
      if (source === "tailer" || source === "replay") {
        this.#advanceTailerCursor(envelope.cursor);
        this.#compactConfirmedCommits();
      }
      if (
        existing.payloadCompleteness === "sparse"
        && envelope.payloadCompleteness === "rich"
      ) {
        this.#commits.set(key, {
          envelope,
          payloadCompleteness: envelope.payloadCompleteness,
        });
        this.#enqueue(envelope, source);
        return { kind: "enriched", identity };
      }
      return { kind: "duplicate", identity };
    }

    // Once the durable tailer has crossed a cursor and the identity has been
    // compacted, a late apply/resolve response cannot be a new delivery.  The
    // durable ledger remains the authority for the old envelope; keeping a
    // second unbounded hash index here would defeat the memory bound.
    if (this.#isEvicted(envelope.cursor)) {
      if (source === "tailer" || source === "replay") {
        this.#advanceTailerCursor(envelope.cursor);
      }
      return { kind: "duplicate", identity };
    }

    this.#commits.set(key, {
      envelope,
      payloadCompleteness: envelope.payloadCompleteness,
    });
    if (source === "tailer" || source === "replay") {
      this.#advanceTailerCursor(envelope.cursor);
    }
    this.#compactConfirmedCommits();
    this.#enqueue(envelope, source);
    return { kind: "new", identity };
  }

  async waitForIdle(): Promise<void> {
    await Promise.all([...this.#listeners].map((state) => state.tail));
  }

  resetForStoreEpoch(cursor: LocalCommitCursor): void {
    if (!cursor.storeEpoch.trim()) throw new Error("Store epoch is empty");
    if (!Number.isSafeInteger(cursor.commitSeq) || cursor.commitSeq < 0) {
      throw new Error("Store epoch cursor is invalid");
    }
    this.#commits.clear();
    this.#tailerCursor = cursor;
    this.#evictedThrough = undefined;
  }

  #advanceTailerCursor(cursor: LocalCommitCursor): void {
    if (this.#tailerCursor === undefined) {
      this.#tailerCursor = cursor;
      return;
    }
    if (compareLocalCommitCursor(cursor, this.#tailerCursor) > 0) {
      this.#tailerCursor = cursor;
    }
  }

  #isEvicted(cursor: LocalCommitCursor): boolean {
    return this.#evictedThrough !== undefined
      && cursor.storeEpoch === this.#evictedThrough.storeEpoch
      && cursor.commitSeq <= this.#evictedThrough.commitSeq;
  }

  #compactConfirmedCommits(): void {
    const tailerCursor = this.#tailerCursor;
    if (!tailerCursor) return;
    const evictionFloor = tailerCursor.commitSeq - this.#maxRememberedCommits;
    if (evictionFloor < 0) return;

    for (const [key, stored] of this.#commits) {
      if (
        stored.envelope.cursor.storeEpoch === tailerCursor.storeEpoch
        && stored.envelope.cursor.commitSeq <= evictionFloor
      ) {
        this.#commits.delete(key);
      }
    }
    if (
      this.#evictedThrough === undefined
      || this.#evictedThrough.storeEpoch !== tailerCursor.storeEpoch
      || this.#evictedThrough.commitSeq < evictionFloor
    ) {
      this.#evictedThrough = {
        storeEpoch: tailerCursor.storeEpoch,
        commitSeq: evictionFloor,
      };
    }
  }

  #assertSameIdentity(
    existing: LocalCommitEnvelope,
    incoming: LocalCommitEnvelope,
  ): void {
    if (
      existing.commitId !== incoming.commitId
      || existing.operationId !== incoming.operationId
      || existing.canonicalHash !== incoming.canonicalHash
      || existing.intentHash !== incoming.intentHash
    ) {
      throw new LocalCommitProtocolError(
        `LocalCommit identity ${existing.cursor.storeEpoch}/${existing.cursor.commitSeq} disagrees`,
      );
    }
  }

  #enqueue(envelope: LocalCommitEnvelope, source: LocalCommitSource): void {
    for (const state of this.#listeners) {
      state.tail = state.tail
        .then(async () => {
          await state.listener(envelope, source);
        })
        .catch((error: unknown) => {
          this.#onListenerError?.(error, envelope);
        });
    }
  }
}
