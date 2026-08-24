import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { IpcMainInvokeEvent } from "electron";
import type { IpcApi } from "../../../shared/ipc-api";
import { MainConfig } from "../../app/MainConfig";
import { DesktopDocumentSessionRuntime } from "../../core-client";
import { DatabaseModule } from "../../database-application/DatabaseModule";
import {
  type DocumentSyncClientTarget,
  documentSyncUnauthorized,
} from "../../document-sync-transport";
import { LibraryModule } from "../../library-application/LibraryModule";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

export class CoreDocumentIpcError extends Schema.TaggedError<CoreDocumentIpcError>()(
  "CoreDocumentIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

type Handler<Channel extends keyof IpcApi> = (
  event: IpcMainInvokeEvent,
  ...args: IpcApi[Channel]["args"]
) => Effect.Effect<IpcApi[Channel]["result"], unknown>;

const omitProjectScope = <Request extends { readonly projectId: string }>(
  request: Request,
): Omit<Request, "projectId"> => {
  const { projectId, ...unscoped } = request;
  void projectId;
  return unscoped;
};

const canvasUnauthorized = (
  message: string,
  mutationId?: string,
): {
  readonly ok: false;
  readonly error: {
    readonly code: "access_scope_mismatch";
    readonly message: string;
    readonly retryable: false;
    readonly resetRequired: false;
    readonly mutationId?: string;
  };
} => ({
  ok: false,
  error: {
    code: "access_scope_mismatch",
    message,
    retryable: false,
    resetRequired: false,
    ...(mutationId ? { mutationId } : {}),
  },
});

export const live: Layer.Layer<
  never,
  never,
  | DatabaseModule
  | DesktopDocumentSessionRuntime
  | ElectronIpc
  | LibraryModule
  | MainConfig
  | WindowRuntime
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* MainConfig;
    const database = yield* DatabaseModule;
    const documents = yield* DesktopDocumentSessionRuntime;
    const ipc = yield* ElectronIpc;
    const library = yield* LibraryModule;
    const windows = yield* WindowRuntime;
    const handle = <Channel extends keyof IpcApi>(channel: Channel, handler: Handler<Channel>) =>
      ipc.handle(channel, handler);
    const targetFor = (event: IpcMainInvokeEvent): DocumentSyncClientTarget | null => {
      try {
        requireTrustedAppRendererSender(event, "Document authority", config.rendererUrl);
        if (!windows.has(event.sender.id)) return null;
        return event.sender;
      } catch {
        return null;
      }
    };
    const authorize = (event: IpcMainInvokeEvent) =>
      Effect.try({
        try: () => {
          if (!targetFor(event)) throw new Error("Document authority requires an owned window");
        },
        catch: (cause) => new CoreDocumentIpcError({ operation: "authorize-renderer", cause }),
      });
    const unauthorizedResult = <A>() => Effect.succeed(documentSyncUnauthorized() as A);

    yield* handle("page-target:resolve", (event, input) =>
      authorize(event).pipe(Effect.andThen(library.resolvePageTarget(input))),
    );
    yield* handle("page-ownership-path:resolve", (event, input) =>
      authorize(event).pipe(Effect.andThen(library.resolvePageOwnershipPath(input))),
    );
    yield* handle("database-view:reference:get", (event, input) =>
      authorize(event).pipe(Effect.andThen(database.resolveDatabaseViewReference(input))),
    );
    yield* handle("block-document:owned:get", (event, projectId, ownerBlockId) =>
      authorize(event).pipe(
        Effect.andThen(documents.getOwnedDocumentDescriptor(projectId, ownerBlockId)),
      ),
    );
    yield* handle("block-document:owned:prepare", (event, projectId, ownerBlockId) =>
      authorize(event).pipe(
        Effect.andThen(documents.prepareOwnedBlockDocument(projectId, ownerBlockId)),
      ),
    );
    yield* handle("library-block-document:owned:prepare", (event, ownerBlockId) =>
      authorize(event).pipe(
        Effect.andThen(documents.prepareLibraryOwnedBlockDocument(ownerBlockId)),
      ),
    );

    const projectDocumentCommand = <
      Channel extends
        | "document-sync:subscribe"
        | "document-sync:unsubscribe"
        | "document-sync:sync"
        | "document-sync:apply"
        | "document-sync:awareness:publish",
    >(
      channel: Channel,
      operation: string,
      execute: (
        target: DocumentSyncClientTarget,
        request: IpcApi[Channel]["args"][0],
      ) => Effect.Effect<IpcApi[Channel]["result"]>,
    ) =>
      handle(channel, (event, request) => {
        const target = targetFor(event);
        if (!target) return unauthorizedResult<IpcApi[Channel]["result"]>();
        return execute(target, request).pipe(Effect.withSpan(`CoreDocumentIpc.${operation}`));
      });

    yield* projectDocumentCommand(
      "document-sync:subscribe",
      "subscribe-project-document",
      (target, request) =>
        documents.subscribe(
          { kind: "project", projectId: request.projectId },
          target,
          omitProjectScope(request),
        ),
    );
    yield* projectDocumentCommand(
      "document-sync:unsubscribe",
      "unsubscribe-project-document",
      (target, request) =>
        documents.unsubscribe(
          { kind: "project", projectId: request.projectId },
          target,
          omitProjectScope(request),
        ),
    );
    yield* projectDocumentCommand(
      "document-sync:sync",
      "sync-project-document",
      (target, request) =>
        documents.sync(
          { kind: "project", projectId: request.projectId },
          target,
          omitProjectScope(request),
        ),
    );
    yield* projectDocumentCommand(
      "document-sync:apply",
      "apply-project-document",
      (target, request) =>
        documents.applyUpdate(
          { kind: "project", projectId: request.projectId },
          target,
          omitProjectScope(request),
        ),
    );
    yield* projectDocumentCommand(
      "document-sync:awareness:publish",
      "publish-project-awareness",
      (target, request) =>
        documents.publishAwareness(
          { kind: "project", projectId: request.projectId },
          target,
          omitProjectScope(request),
        ),
    );

    const libraryDocumentCommand = <
      Channel extends
        | "library-document-sync:subscribe"
        | "library-document-sync:unsubscribe"
        | "library-document-sync:sync"
        | "library-document-sync:apply"
        | "library-document-sync:awareness:publish",
    >(
      channel: Channel,
      operation: string,
      execute: (
        target: DocumentSyncClientTarget,
        request: IpcApi[Channel]["args"][0],
      ) => Effect.Effect<IpcApi[Channel]["result"]>,
    ) =>
      handle(channel, (event, request) => {
        const target = targetFor(event);
        if (!target) return unauthorizedResult<IpcApi[Channel]["result"]>();
        return execute(target, request).pipe(Effect.withSpan(`CoreDocumentIpc.${operation}`));
      });

    yield* libraryDocumentCommand(
      "library-document-sync:subscribe",
      "subscribe-library-document",
      (target, request) => documents.subscribe({ kind: "library" }, target, request),
    );
    yield* libraryDocumentCommand(
      "library-document-sync:unsubscribe",
      "unsubscribe-library-document",
      (target, request) => documents.unsubscribe({ kind: "library" }, target, request),
    );
    yield* libraryDocumentCommand(
      "library-document-sync:sync",
      "sync-library-document",
      (target, request) => documents.sync({ kind: "library" }, target, request),
    );
    yield* libraryDocumentCommand(
      "library-document-sync:apply",
      "apply-library-document",
      (target, request) => documents.applyUpdate({ kind: "library" }, target, request),
    );
    yield* libraryDocumentCommand(
      "library-document-sync:awareness:publish",
      "publish-library-awareness",
      (target, request) => documents.publishAwareness({ kind: "library" }, target, request),
    );

    yield* handle("canvas-scene:subscribe", (event, request) => {
      const target = targetFor(event);
      if (!target)
        return Effect.succeed(canvasUnauthorized("Canvas scene subscription is unauthorized"));
      return documents.subscribeCanvasScene(target, request);
    });
    yield* handle("canvas-scene:unsubscribe", (event, request) => {
      const target = targetFor(event);
      if (!target)
        return Effect.succeed(canvasUnauthorized("Canvas scene subscription is unauthorized"));
      return documents.unsubscribeCanvasScene(target, request);
    });
    yield* handle("canvas-scene:sync", (event, request) => {
      const target = targetFor(event);
      if (!target) return Effect.succeed(canvasUnauthorized("Canvas scene sync is unauthorized"));
      return documents.syncCanvasScene(target, request);
    });
    yield* handle("canvas-scene:apply", (event, request) => {
      const target = targetFor(event);
      if (!target) {
        return Effect.succeed(
          canvasUnauthorized("Canvas scene mutation is unauthorized", request.mutationId),
        );
      }
      return documents.applyCanvasSceneMutation(target, request);
    });
    yield* handle("canvas-scene:presence:publish", (event, request) => {
      const target = targetFor(event);
      if (!target) {
        return Effect.succeed({
          ok: false as const,
          error: {
            code: "unauthorized" as const,
            message: "Canvas presence publication is unauthorized",
            retryable: false as const,
            resetRequired: false as const,
          },
        });
      }
      return documents.publishCanvasPresence(target, request);
    });
    yield* handle("canvas-scene:compaction:read", (event, request) => {
      const target = targetFor(event);
      if (!target)
        return Effect.succeed(canvasUnauthorized("Canvas compaction read is unauthorized"));
      return documents.readCanvasSceneCompaction(target, request);
    });
    yield* handle("canvas-scene:compaction:apply", (event, request) => {
      const target = targetFor(event);
      if (!target) {
        return Effect.succeed(
          canvasUnauthorized("Canvas compaction is unauthorized", request.mutationId),
        );
      }
      return documents.compactCanvasScene(target, request);
    });
  }),
);
