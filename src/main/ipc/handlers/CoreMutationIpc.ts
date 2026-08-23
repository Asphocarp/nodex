import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type { IpcMainInvokeEvent } from "electron";
import type { IpcApi } from "../../../shared/ipc-api";
import { registerAdditionalDocumentCommandIpcHandler } from "../../additional-document-command-ipc";
import { MainConfig } from "../../app/MainConfig";
import { ScopedCallbackRuntime } from "../../app/ScopedCallbackRuntime";
import {
  registerBlockPropertyMutationIpcHandler,
  registerLibraryBlockPropertyMutationIpcHandler,
} from "../../block-property-mutation-ipc";
import {
  registerBlockTransferIpcHandler,
  registerBlockTransferUndoIpcHandler,
} from "../../block-transfer-ipc";
import type { RendererClientRuntimeService } from "../../codex/renderer-client-runtime-contracts";
import type { DesktopDocumentSessionService } from "../../core-client";
import { DatabaseModule } from "../../database-application/DatabaseModule";
import { registerDatabaseModuleIpcHandlers } from "../../database-module-ipc";
import { registerDocumentHistoryIpcHandlers } from "../../document-history-ipc";
import { registerDocumentMutationIpcHandler } from "../../document-operation-ipc";
import { registerLibraryDatabaseModuleIpcHandler } from "../../library-database-module-ipc";
import { registerLibraryModuleIpcHandler } from "../../library-module-ipc";
import { registerLibraryPageDetailIpcHandler } from "../../library-page-detail-ipc";
import { registerPageDetailIpcHandler } from "../../page-detail-ipc";
import { registerPageHistoryIpcHandler } from "../../page-history-ipc";
import {
  registerPageLifecycleIpcHandler,
  registerPageLifecyclePreflightIpcHandler,
} from "../../page-lifecycle-ipc";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { LibraryModule } from "../../library-application/LibraryModule";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

export interface CoreMutationIpcOptions {
  readonly documents: DesktopDocumentSessionService;
  readonly rendererClients: RendererClientRuntimeService;
}

export class CoreMutationIpcError extends Schema.TaggedError<CoreMutationIpcError>()(
  "CoreMutationIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

type Handler<Channel extends keyof IpcApi> = (
  event: IpcMainInvokeEvent,
  ...args: IpcApi[Channel]["args"]
) => IpcApi[Channel]["result"] | Promise<IpcApi[Channel]["result"]>;

export const live = (
  options: CoreMutationIpcOptions,
): Layer.Layer<
  never,
  never,
  DatabaseModule | ElectronIpc | LibraryModule | MainConfig | ScopedCallbackRuntime | WindowRuntime
> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const config = yield* MainConfig;
      const callbacks = yield* ScopedCallbackRuntime;
      const database = yield* DatabaseModule;
      const ipc = yield* ElectronIpc;
      const library = yield* LibraryModule;
      const windows = yield* WindowRuntime;
      const targetFor = (event: IpcMainInvokeEvent) => {
        try {
          requireTrustedAppRendererSender(event, "Core mutation authority", config.rendererUrl);
          if (!windows.has(event.sender.id)) return null;
          return event.sender;
        } catch {
          return null;
        }
      };
      const authorize = (event: IpcMainInvokeEvent) =>
        Effect.try({
          try: () => {
            if (!targetFor(event)) {
              throw new Error("Core mutation authority requires an active Nodex window");
            }
          },
          catch: (cause) => new CoreMutationIpcError({ operation: "authorize-renderer", cause }),
        });
      const invoke = <A>(operation: string, task: () => A | Promise<A>) =>
        Effect.tryPromise({
          try: () => Promise.resolve(task()),
          catch: (cause) => new CoreMutationIpcError({ operation, cause }),
        });
      const registrations: Array<Effect.Effect<void, never, Scope.Scope>> = [];
      const registerHandle = <Channel extends keyof IpcApi>(
        channel: Channel,
        listener: Handler<Channel>,
      ): void => {
        registrations.push(
          ipc.handle(channel, (event, ...args: IpcApi[Channel]["args"]) =>
            authorize(event).pipe(
              Effect.flatMap(() => invoke(channel, () => listener(event, ...args))),
            ),
          ),
        );
      };
      const resolveTrustedIdentity = (rawEvent: unknown) => {
        const event = rawEvent as IpcMainInvokeEvent;
        const target = targetFor(event);
        if (!target) return null;
        const clientId = options.rendererClients.ensureClient(target).clientId;
        return {
          clientSessionId: clientId,
          actor: { kind: "electron_renderer" as const, clientId },
        };
      };

      registerBlockPropertyMutationIpcHandler({
        registerHandle: (channel, listener) => {
          registerHandle(channel, (event, projectId, request) =>
            listener(event, projectId, request),
          );
        },
        resolveTrustedIdentity,
        applyMutation: (request) =>
          callbacks.runPromise(library.applyBlockPropertyMutation(request)),
      });
      registerLibraryBlockPropertyMutationIpcHandler({
        registerHandle: (channel, listener) => {
          registerHandle(channel, (event, request) => listener(event, request));
        },
        resolveTrustedIdentity,
        applyMutation: (request) =>
          callbacks.runPromise(library.applyLibraryBlockPropertyMutation(request)),
      });
      registerDatabaseModuleIpcHandlers({
        registerHandle: (channel, listener) => {
          registerHandle(
            channel,
            (event, projectId, request) =>
              listener(event, projectId, request) as
                | IpcApi[typeof channel]["result"]
                | Promise<IpcApi[typeof channel]["result"]>,
          );
        },
        resolveTrustedIdentity,
        apply: (request) => callbacks.runPromise(database.apply(request)),
        read: (request) => callbacks.runPromise(database.read(request)),
      });
      registerLibraryModuleIpcHandler({
        registerHandle: (channel, listener) => {
          registerHandle(
            channel,
            (event, accessContext, request) =>
              listener(event, accessContext, request) as
                | IpcApi[typeof channel]["result"]
                | Promise<IpcApi[typeof channel]["result"]>,
          );
        },
        isTrustedEvent: (event) => targetFor(event as IpcMainInvokeEvent) !== null,
        read: (accessContext, request) =>
          callbacks.runPromise(library.read(accessContext, request)),
        apply: (accessContext, request) =>
          callbacks.runPromise(library.apply(accessContext, request)),
      });
      registerLibraryDatabaseModuleIpcHandler({
        registerHandle: (channel, listener) => {
          registerHandle(
            channel,
            (event, request) =>
              listener(event, request) as
                | IpcApi[typeof channel]["result"]
                | Promise<IpcApi[typeof channel]["result"]>,
          );
        },
        isTrustedEvent: (event) => targetFor(event as IpcMainInvokeEvent) !== null,
        read: (request) => callbacks.runPromise(database.readLibrary(request)),
        apply: (request) => callbacks.runPromise(database.applyLibrary(request)),
      });
      registerPageDetailIpcHandler({
        registerHandle: (channel, listener) => {
          registerHandle(channel, (event, projectId, pageId, minimumCommitSeq) =>
            listener(event, projectId, pageId, minimumCommitSeq),
          );
        },
        isTrustedEvent: (event) => targetFor(event as IpcMainInvokeEvent) !== null,
        read: (projectId, pageId, minimumCommitSeq) =>
          callbacks.runPromise(library.readProjectPageDetail(projectId, pageId, minimumCommitSeq)),
      });
      registerLibraryPageDetailIpcHandler({
        registerHandle: (channel, listener) => {
          registerHandle(channel, (event, pageId, minimumCommitSeq) =>
            listener(event, pageId, minimumCommitSeq),
          );
        },
        isTrustedEvent: (event) => targetFor(event as IpcMainInvokeEvent) !== null,
        read: (pageId, minimumCommitSeq) =>
          callbacks.runPromise(library.readLibraryPageDetail(pageId, undefined, minimumCommitSeq)),
      });
      registerPageLifecyclePreflightIpcHandler({
        registerHandle: (channel, listener) => {
          registerHandle(channel, (event, projectId, pageId) => listener(event, projectId, pageId));
        },
        readPreflight: (projectId, pageId) =>
          callbacks.runPromise(library.readPageLifecyclePreflight(projectId, pageId)),
      });
      registerPageLifecycleIpcHandler({
        registerHandle: (channel, listener) => {
          registerHandle(channel, (event, projectId, request) =>
            listener(event, projectId, request),
          );
        },
        getTrustedIdentity: resolveTrustedIdentity,
        applyMutation: (request) =>
          callbacks.runPromise(library.applyPageLifecycleMutation(request)),
      });
      registerDocumentMutationIpcHandler({
        registerHandle: (channel, listener) => {
          registerHandle(channel, (event, projectId, documentId, request) =>
            listener(event, projectId, documentId, request),
          );
        },
        resolveTrustedIdentity,
        applyMutation: (request) =>
          callbacks.runPromise(options.documents.applyDocumentMutation(request)),
      });
      registerAdditionalDocumentCommandIpcHandler({
        registerHandle: (channel, listener) => {
          registerHandle(channel, (event, projectId, request) =>
            listener(event, projectId, request),
          );
        },
        resolveTrustedIdentity,
        applyCommand: (request) =>
          callbacks.runPromise(options.documents.applyAdditionalDocumentCommand(request)),
      });
      registerBlockTransferIpcHandler({
        registerHandle: (channel, listener) => {
          registerHandle(channel, (event, projectId, intent) => listener(event, projectId, intent));
        },
        resolveTrustedIdentity,
        transfer: (intent) => callbacks.runPromise(options.documents.transferBlocks(intent)),
      });
      registerBlockTransferUndoIpcHandler({
        registerHandle: (channel, listener) => {
          registerHandle(channel, (event, projectId, intent) => listener(event, projectId, intent));
        },
        resolveTrustedIdentity: (event) => targetFor(event as IpcMainInvokeEvent),
        undo: (intent) => callbacks.runPromise(options.documents.undoBlockTransfer(intent)),
      });
      registerDocumentHistoryIpcHandlers({
        registerHandle: (channel, listener) => {
          if (channel === "block-documents:history:checkpoint") {
            registerHandle(
              channel,
              (event, projectId, documentId, request) =>
                listener(event, projectId, documentId, request) as
                  | IpcApi["block-documents:history:checkpoint"]["result"]
                  | Promise<IpcApi["block-documents:history:checkpoint"]["result"]>,
            );
            return;
          }
          if (channel === "block-documents:history:list") {
            registerHandle(
              channel,
              (event, request) =>
                listener(event, request) as
                  | IpcApi["block-documents:history:list"]["result"]
                  | Promise<IpcApi["block-documents:history:list"]["result"]>,
            );
            return;
          }
          if (channel === "block-documents:history:get") {
            registerHandle(
              channel,
              (event, request) =>
                listener(event, request) as
                  | IpcApi["block-documents:history:get"]["result"]
                  | Promise<IpcApi["block-documents:history:get"]["result"]>,
            );
            return;
          }
          registerHandle(
            channel,
            (event, projectId, documentId, request) =>
              listener(event, projectId, documentId, request) as
                | IpcApi["block-documents:history:restore"]["result"]
                | Promise<IpcApi["block-documents:history:restore"]["result"]>,
          );
        },
        resolveTrustedIdentity,
        createCheckpoint: (request) =>
          callbacks.runPromise(options.documents.createCheckpoint(request)),
        listVersions: (request) => callbacks.runPromise(options.documents.listVersions(request)),
        getVersion: (request) => callbacks.runPromise(options.documents.getVersion(request)),
        restoreVersion: (request) =>
          callbacks.runPromise(options.documents.restoreVersion(request)),
      });
      registerPageHistoryIpcHandler({
        registerHandle: (channel, listener) => {
          registerHandle(channel, (event, request) => listener(event, request));
        },
        isTrustedEvent: (event) => targetFor(event as IpcMainInvokeEvent) !== null,
        listHistory: (request) => callbacks.runPromise(library.listPageHistory(request)),
      });

      yield* Effect.all(registrations, { discard: true });
    }),
  );
