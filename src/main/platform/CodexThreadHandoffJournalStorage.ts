import { lstat, readFile, rename, rm } from "node:fs/promises";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { writeDurableJson } from "../durable-json-file";
import {
  CODEX_THREAD_HANDOFF_JOURNAL_MAX_BYTES,
  CODEX_THREAD_HANDOFF_JOURNAL_SCHEMA_VERSION,
  parseCodexThreadHandoffJournal,
  type CodexThreadHandoffJournalEntry,
} from "../codex/codex-thread-handoff-journal";

export class CodexThreadHandoffJournalStorageError extends Schema.TaggedError<CodexThreadHandoffJournalStorageError>()(
  "CodexThreadHandoffJournalStorageError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export interface CodexThreadHandoffJournalStorage {
  readonly load: Effect.Effect<
    readonly CodexThreadHandoffJournalEntry[],
    CodexThreadHandoffJournalStorageError
  >;
  readonly persist: (
    entries: readonly CodexThreadHandoffJournalEntry[],
  ) => Effect.Effect<void, CodexThreadHandoffJournalStorageError>;
}

const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

export const makeCodexThreadHandoffJournalStorage = (
  filePath: string,
  now: () => number = Date.now,
): CodexThreadHandoffJournalStorage => {
  const attempt = <A>(operation: string, run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => new CodexThreadHandoffJournalStorageError({ operation, cause }),
    });
  const quarantine = attempt("quarantine-rename", () =>
    rename(filePath, `${filePath}.corrupt-${now()}`),
  ).pipe(
    Effect.catch((error) => (isMissing(error.cause) ? Effect.void : Effect.fail(error))),
    Effect.andThen(attempt("quarantine-remove", () => rm(filePath, { force: true }))),
  );

  return {
    load: Effect.gen(function* () {
      const metadata = yield* attempt("metadata", () => lstat(filePath)).pipe(
        Effect.catch((error) =>
          isMissing(error.cause) ? Effect.succeed(null) : Effect.fail(error),
        ),
      );
      if (metadata === null) return [];
      if (
        metadata.isSymbolicLink() ||
        !metadata.isFile() ||
        metadata.size > CODEX_THREAD_HANDOFF_JOURNAL_MAX_BYTES
      ) {
        yield* quarantine;
        return [];
      }
      const entries = parseCodexThreadHandoffJournal(
        yield* attempt("read", () => readFile(filePath, "utf8")),
      );
      if (entries !== null) return entries;
      yield* quarantine;
      return [];
    }),
    persist: (entries) =>
      Effect.tryPromise({
        try: () =>
          writeDurableJson(
            filePath,
            {
              schemaVersion: CODEX_THREAD_HANDOFF_JOURNAL_SCHEMA_VERSION,
              entries,
            },
            CODEX_THREAD_HANDOFF_JOURNAL_MAX_BYTES,
          ),
        catch: (cause) =>
          new CodexThreadHandoffJournalStorageError({ operation: "persist", cause }),
      }),
  };
};
