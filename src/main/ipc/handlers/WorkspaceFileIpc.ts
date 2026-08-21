import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import type { IpcEvents } from "../../../shared/ipc-api";
import {
  WorkspaceDirectoryEntriesInputSchema,
  WorkspaceFileMetadataInputSchema,
  WorkspaceFileRequestSchema,
  WorkspaceFileSearchInputSchema,
  WorkspaceFileTextReadInputSchema,
  WorkspaceFileWatchStopInputSchema,
  WorkspaceFileWriteInputSchema,
} from "../../../shared/schemas/workspace-files";
import { MainConfig } from "../../app/MainConfig";
import { ScopedCallbackRuntime } from "../../app/ScopedCallbackRuntime";
import {
  type FileWatchHost,
  type FileWatchSession,
  localFileWatchHost,
} from "../../file-watch-host";
import { safeSendToWebContents } from "../../ipc-safe-send";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";
import {
  listWorkspaceDirectoryEntries,
  readWorkspaceFile,
  readWorkspaceFileBinary,
  readWorkspaceFileMetadata,
  searchWorkspaceFiles,
  toWorkspaceFileIpcError,
  WorkspaceFileUserError,
  writeWorkspaceFile,
} from "../../workspace-files-service";

export interface WorkspaceFileIpcOptions {
  readonly authorizeSender?: (event: IpcMainInvokeEvent) => boolean;
  readonly fileWatchHost?: FileWatchHost;
  readonly makeSubscriptionId?: () => string;
}

export class WorkspaceFileIpcError extends Schema.TaggedError<WorkspaceFileIpcError>()(
  "WorkspaceFileIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

interface SharedWatch {
  readonly owner: WebContents;
  readonly path: string;
  readonly session: FileWatchSession;
  readonly subscriptionIds: Set<string>;
}

interface OwnerListener {
  readonly owner: WebContents;
  readonly onDestroyed: () => void;
}

const sendChanged = (owner: WebContents, payload: IpcEvents["workspace-file:changed"]): void => {
  safeSendToWebContents(owner, "workspace-file:changed", [payload]);
};

export const live = (
  options: WorkspaceFileIpcOptions = {},
): Layer.Layer<never, never, ElectronIpc | MainConfig | ScopedCallbackRuntime | WindowRuntime> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const callbacks = yield* ScopedCallbackRuntime;
      const config = yield* MainConfig;
      const ipc = yield* ElectronIpc;
      const windows = yield* WindowRuntime;
      const lock = yield* Semaphore.make(1);
      const watchHost = options.fileWatchHost ?? localFileWatchHost;
      const makeSubscriptionId = options.makeSubscriptionId ?? randomUUID;
      const watches = new Map<string, SharedWatch>();
      const subscriptions = new Map<
        string,
        { readonly ownerId: number; readonly watchKey: string }
      >();
      const owners = new Map<number, OwnerListener>();

      const authorize = (event: IpcMainInvokeEvent) =>
        Effect.try({
          try: () => {
            if (options.authorizeSender) {
              if (!options.authorizeSender(event))
                throw new Error("Unauthorized workspace file access");
              return;
            }
            requireTrustedAppRendererSender(event, "Workspace file access", config.rendererUrl);
            if (!windows.has(event.sender.id)) {
              throw new WorkspaceFileUserError(
                "unauthorized_sender",
                "Workspace file access requires an active Nodex window",
              );
            }
          },
          catch: (cause) =>
            cause instanceof WorkspaceFileUserError
              ? cause
              : new WorkspaceFileUserError(
                  "unauthorized_sender",
                  "Workspace file access is available only to the top-level app renderer",
                  { cause },
                ),
        });
      const mapError = (
        operation: string,
        cause: unknown,
      ): WorkspaceFileUserError | WorkspaceFileIpcError => {
        const mapped = toWorkspaceFileIpcError(cause);
        return mapped instanceof WorkspaceFileUserError
          ? mapped
          : new WorkspaceFileIpcError({ operation, cause: mapped });
      };
      const run = <A>(operation: string, event: IpcMainInvokeEvent, task: () => Promise<A>) =>
        authorize(event).pipe(
          Effect.andThen(
            Effect.tryPromise({
              try: task,
              catch: (cause) => mapError(operation, cause),
            }),
          ),
        );
      const runEffect = <A, E>(
        operation: string,
        event: IpcMainInvokeEvent,
        task: Effect.Effect<A, E>,
      ) =>
        authorize(event).pipe(
          Effect.andThen(task),
          Effect.mapError((cause) => mapError(operation, cause)),
        );
      const releaseOwnerListenerIfIdle = (ownerId: number): void => {
        for (const watch of watches.values()) {
          if (watch.owner.id === ownerId) return;
        }
        const listener = owners.get(ownerId);
        if (!listener) return;
        owners.delete(ownerId);
        listener.owner.removeListener("destroyed", listener.onDestroyed);
      };
      const disposeWatchUnlocked = (watchKey: string) =>
        Effect.gen(function* () {
          const watch = watches.get(watchKey);
          if (!watch) return;
          watches.delete(watchKey);
          for (const subscriptionId of watch.subscriptionIds) subscriptions.delete(subscriptionId);
          watch.subscriptionIds.clear();
          yield* Effect.tryPromise({
            try: () => watch.session.dispose(),
            catch: (cause) => new WorkspaceFileIpcError({ operation: "dispose-watch", cause }),
          }).pipe(Effect.ignore);
          releaseOwnerListenerIfIdle(watch.owner.id);
        });
      const disposeOwner = (ownerId: number) =>
        Effect.gen(function* () {
          for (const [watchKey, watch] of [...watches]) {
            if (watch.owner.id === ownerId) yield* disposeWatchUnlocked(watchKey);
          }
          releaseOwnerListenerIfIdle(ownerId);
        }).pipe(lock.withPermits(1));
      const ensureOwnerListener = (owner: WebContents): void => {
        if (owners.has(owner.id)) return;
        const onDestroyed = () => callbacks.fork(disposeOwner(owner.id));
        owners.set(owner.id, { owner, onDestroyed });
        owner.once("destroyed", onDestroyed);
      };

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          for (const watchKey of [...watches.keys()]) yield* disposeWatchUnlocked(watchKey);
          for (const listener of owners.values()) {
            listener.owner.removeListener("destroyed", listener.onDestroyed);
          }
          owners.clear();
          subscriptions.clear();
        }).pipe(lock.withPermits(1)),
      );

      yield* ipc.handle("workspace-directory-entries", (event, input: unknown) =>
        run("list-directory", event, () =>
          listWorkspaceDirectoryEntries(WorkspaceDirectoryEntriesInputSchema.parse(input)),
        ),
      );
      yield* ipc.handle("workspace-file-search", (event, input: unknown) =>
        run("search-files", event, () =>
          searchWorkspaceFiles(WorkspaceFileSearchInputSchema.parse(input)),
        ),
      );
      yield* ipc.handle("read-file", (event, input: unknown) =>
        run("read-file", event, () =>
          readWorkspaceFile(WorkspaceFileTextReadInputSchema.parse(input)),
        ),
      );
      yield* ipc.handle("read-file-metadata", (event, input: unknown) =>
        run("read-file-metadata", event, () =>
          readWorkspaceFileMetadata(WorkspaceFileMetadataInputSchema.parse(input)),
        ),
      );
      yield* ipc.handle("read-file-binary", (event, input: unknown) =>
        run("read-file-binary", event, () =>
          readWorkspaceFileBinary(WorkspaceFileRequestSchema.parse(input)),
        ),
      );
      yield* ipc.handle("write-file", (event, input: unknown) =>
        run("write-file", event, () =>
          writeWorkspaceFile(WorkspaceFileWriteInputSchema.parse(input)),
        ),
      );
      yield* ipc.handle("workspace-file-watch:start", (event, input: unknown) =>
        runEffect(
          "start-file-watch",
          event,
          Effect.gen(function* () {
            const request = yield* Effect.try({
              try: () => WorkspaceFileRequestSchema.parse(input),
              catch: (cause) => mapError("parse-file-watch", cause),
            });
            const owner = event.sender;
            const watchedPath = resolve(request.path);
            const watchKey = `${owner.id}\0${watchedPath}`;
            let shared = watches.get(watchKey);
            if (!shared) {
              const subscriptionIds = new Set<string>();
              const session = yield* Effect.tryPromise({
                try: () =>
                  watchHost.startFileWatch({
                    path: dirname(watchedPath),
                    recursive: false,
                    renameEventHandling: "changed-path-with-parent-directory",
                    onChange: ({ changedPaths }) => {
                      const exactPathChanged =
                        changedPaths.length === 0 ||
                        changedPaths.some((changedPath) => resolve(changedPath) === watchedPath);
                      if (!exactPathChanged || owner.isDestroyed()) return;
                      for (const subscriptionId of subscriptionIds) {
                        sendChanged(owner, { subscriptionId, path: watchedPath });
                      }
                    },
                  }),
                catch: (cause) => mapError("acquire-file-watch", cause),
              });
              shared = { owner, path: watchedPath, session, subscriptionIds };
              watches.set(watchKey, shared);
              ensureOwnerListener(owner);
              callbacks.fork(
                Effect.promise(() => session.closed).pipe(
                  Effect.andThen(disposeWatchUnlocked(watchKey).pipe(lock.withPermits(1))),
                ),
              );
            }
            if (owner.isDestroyed()) {
              yield* disposeWatchUnlocked(watchKey);
              return yield* Effect.fail(
                new WorkspaceFileUserError(
                  "unauthorized_sender",
                  "Workspace file watcher owner is no longer available",
                ),
              );
            }
            const subscriptionId = makeSubscriptionId();
            shared.subscriptionIds.add(subscriptionId);
            subscriptions.set(subscriptionId, { ownerId: owner.id, watchKey });
            return { subscriptionId };
          }).pipe(lock.withPermits(1)),
        ),
      );
      yield* ipc.handle("workspace-file-watch:stop", (event, input: unknown) =>
        runEffect(
          "stop-file-watch",
          event,
          Effect.gen(function* () {
            const request = yield* Effect.try({
              try: () => WorkspaceFileWatchStopInputSchema.parse(input),
              catch: (cause) => mapError("parse-file-watch-stop", cause),
            });
            const subscription = subscriptions.get(request.subscriptionId);
            if (!subscription || subscription.ownerId !== event.sender.id) return;
            subscriptions.delete(request.subscriptionId);
            const shared = watches.get(subscription.watchKey);
            if (!shared) return;
            shared.subscriptionIds.delete(request.subscriptionId);
            if (shared.subscriptionIds.size === 0) {
              yield* disposeWatchUnlocked(subscription.watchKey);
            }
          }).pipe(lock.withPermits(1)),
        ),
      );
    }),
  );
