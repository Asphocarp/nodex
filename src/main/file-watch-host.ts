import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { watch, type WatchEventType } from "node:fs";
import path from "node:path";

export type FileWatchRenameEventHandling = "changed-path" | "changed-path-with-parent-directory";

export interface FileWatchInput {
  readonly path: string;
  readonly recursive: boolean;
  readonly renameEventHandling: FileWatchRenameEventHandling;
}

export interface FileWatchCoverage {
  readonly recursive: boolean;
  readonly typedPathChanges: false;
}

export type FileWatchEvent =
  | {
      readonly _tag: "Ready";
      readonly coverage: FileWatchCoverage;
      readonly path: string;
    }
  | {
      readonly _tag: "Changed";
      readonly changedPaths: readonly string[];
    };

export class FileWatchError extends Schema.TaggedError<FileWatchError>()("FileWatchError", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {}

/** A native watch is acquired by stream consumption and released by the consumer's Scope. */
export interface FileWatchHost {
  readonly watch: (input: FileWatchInput) => Stream.Stream<FileWatchEvent, FileWatchError>;
}

interface NativeFileWatcher {
  close(): void;
  on(event: "error", listener: (error: Error) => void): this;
}

export type NativeFileWatchFactory = (
  watchPath: string,
  options: { readonly recursive: boolean },
  listener: (eventType: WatchEventType, filename: string | Buffer | null) => void,
) => NativeFileWatcher;

const defaultWatchFactory: NativeFileWatchFactory = (watchPath, options, listener) =>
  watch(watchPath, options, listener);

export class NodeFileWatchHost implements FileWatchHost {
  constructor(private readonly watchFactory: NativeFileWatchFactory = defaultWatchFactory) {}

  readonly watch = (input: FileWatchInput): Stream.Stream<FileWatchEvent, FileWatchError> => {
    const watchFactory = this.watchFactory;
    return Stream.callback<FileWatchEvent, FileWatchError>(
      Effect.fn("NodeFileWatchHost.watch")(function* (events) {
        yield* Effect.acquireRelease(
          Effect.try({
            try: () => {
              const watcher = watchFactory(
                input.path,
                { recursive: input.recursive },
                (eventType, filename) => {
                  const changedPath =
                    filename === null
                      ? null
                      : path.join(input.path, ...filename.toString().split(path.sep));
                  const changedPaths = changedPath === null ? [] : [changedPath];

                  if (
                    changedPath !== null &&
                    eventType === "rename" &&
                    input.renameEventHandling === "changed-path-with-parent-directory"
                  ) {
                    changedPaths.push(path.dirname(changedPath));
                  }

                  Queue.offerUnsafe(events, { _tag: "Changed", changedPaths });
                },
              );
              watcher.on("error", (cause) => {
                Queue.failCauseUnsafe(
                  events,
                  Cause.fail(new FileWatchError({ path: input.path, cause })),
                );
              });
              Queue.offerUnsafe(events, {
                _tag: "Ready",
                coverage: { recursive: input.recursive, typedPathChanges: false },
                path: input.path,
              });
              return watcher;
            },
            catch: (cause) => new FileWatchError({ path: input.path, cause }),
          }),
          (watcher) => Effect.sync(() => watcher.close()),
        ).pipe(Effect.catch((error) => Queue.fail(events, error).pipe(Effect.asVoid)));
      }),
    );
  };
}

export const localFileWatchHost: FileWatchHost = new NodeFileWatchHost();
