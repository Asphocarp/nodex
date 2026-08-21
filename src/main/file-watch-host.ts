import { watch, type WatchEventType } from "node:fs";
import path from "node:path";

export type FileWatchRenameEventHandling = "changed-path" | "changed-path-with-parent-directory";

export interface FileWatchChange {
  readonly changedPaths: readonly string[];
}

export type FileWatchClosed =
  | { readonly reason: "disposed" }
  | { readonly reason: "watch-error"; readonly error: Error };

export interface FileWatchSession {
  readonly coverage: {
    readonly recursive: boolean;
    readonly typedPathChanges: false;
  };
  readonly path: string;
  readonly closed: Promise<FileWatchClosed>;
  dispose(): Promise<void>;
}

export interface FileWatchHost {
  startFileWatch(input: {
    readonly path: string;
    readonly recursive: boolean;
    readonly renameEventHandling: FileWatchRenameEventHandling;
    readonly onChange: (change: FileWatchChange) => void;
  }): Promise<FileWatchSession>;
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

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

export class NodeFileWatchHost implements FileWatchHost {
  constructor(private readonly watchFactory: NativeFileWatchFactory = defaultWatchFactory) {}

  async startFileWatch(input: {
    readonly path: string;
    readonly recursive: boolean;
    readonly renameEventHandling: FileWatchRenameEventHandling;
    readonly onChange: (change: FileWatchChange) => void;
  }): Promise<FileWatchSession> {
    const closed = deferred<FileWatchClosed>();
    let settled = false;
    const watcher = this.watchFactory(
      input.path,
      { recursive: input.recursive },
      (eventType, filename) => {
        const changedPath =
          filename === null ? null : path.join(input.path, ...filename.toString().split(path.sep));
        const changedPaths = changedPath === null ? [] : [changedPath];

        if (
          changedPath !== null &&
          eventType === "rename" &&
          input.renameEventHandling === "changed-path-with-parent-directory"
        ) {
          changedPaths.push(path.dirname(changedPath));
        }

        input.onChange({ changedPaths });
      },
    );

    const close = (reason: FileWatchClosed) => {
      if (settled) return;
      settled = true;
      watcher.close();
      closed.resolve(reason);
    };

    watcher.on("error", (error) => {
      close({ reason: "watch-error", error });
    });

    return {
      coverage: {
        recursive: input.recursive,
        typedPathChanges: false,
      },
      path: input.path,
      closed: closed.promise,
      dispose: async () => {
        close({ reason: "disposed" });
      },
    };
  }
}

export const localFileWatchHost: FileWatchHost = new NodeFileWatchHost();
