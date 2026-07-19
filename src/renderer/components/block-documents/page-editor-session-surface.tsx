import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BlockDocumentSurfaceFailureState,
  OwnedBlockDocumentRuntimeSurface,
  type BlockDocumentSurfaceProps,
  type BlockDocumentSurfaceValue,
} from "./block-document-surface";
import { createDocumentSyncAdapter } from "@/lib/api";
import {
  BlockDocumentSurfaceRuntime,
  type BlockDocumentSurfaceRuntimeOptions,
} from "@/lib/block-document-surface-runtime";
import {
  makePageEditorRuntimeIdentity,
  pageEditorSessionRegistry,
  type PageEditorSession,
  type PageEditorSessionRegistry,
} from "@/lib/page-editor-session-registry";

interface PageEditorSessionSurfaceProps extends Omit<
  BlockDocumentSurfaceProps,
  "children"
> {
  readonly sessionKey: string;
  readonly retainModelOnUnmount?: boolean;
  readonly registry?: PageEditorSessionRegistry;
  readonly children: (
    surface: BlockDocumentSurfaceValue,
    session: PageEditorSession,
  ) => ReactNode;
}

interface SessionOwnerState {
  readonly session: PageEditorSession | null;
  readonly startupError: Error | null;
}

const EMPTY_SESSION_OWNER_STATE: SessionOwnerState = {
  session: null,
  startupError: null,
};

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const createRuntime = (
  options: BlockDocumentSurfaceRuntimeOptions,
): BlockDocumentSurfaceRuntime => new BlockDocumentSurfaceRuntime(options);

/**
 * Attaches the active Page Stage to a PageTab-owned editor session. View
 * cleanup always releases presence and DOM; durable tabs leave model disposal
 * to the registry, while an unpromoted preview disposes on final unmount.
 */
export function PageEditorSessionSurface({
  sessionKey,
  retainModelOnUnmount = true,
  registry = pageEditorSessionRegistry,
  projectId,
  descriptor,
  isActive,
  localAwarenessState,
  onReload,
  dependencies,
  runtimeRef,
  pendingFallback,
  failureFallback,
  children,
}: PageEditorSessionSurfaceProps) {
  const [revision, setRevision] = useState(0);
  const [ownerState, setOwnerState] = useState<SessionOwnerState>(
    EMPTY_SESSION_OWNER_STATE,
  );
  const descriptorRef = useRef(descriptor);
  descriptorRef.current = descriptor;
  const retainModelOnUnmountRef = useRef(retainModelOnUnmount);
  retainModelOnUnmountRef.current = retainModelOnUnmount;
  const onReloadRef = useRef(onReload);
  onReloadRef.current = onReload;
  const identity = makePageEditorRuntimeIdentity(descriptor);
  const adapterFactory = dependencies?.createAdapter ?? createDocumentSyncAdapter;
  const runtimeFactory = dependencies?.createRuntime ?? createRuntime;

  useLayoutEffect(() => {
    let live = true;
    let session: PageEditorSession | null = null;
    let viewGeneration = 0;
    setOwnerState(EMPTY_SESSION_OWNER_STATE);

    try {
      const currentDescriptor = descriptorRef.current;
      if (currentDescriptor.projectId !== projectId) {
        throw new TypeError(
          "Page editor session Project does not match its descriptor",
        );
      }
      session = registry.acquire({
        key: sessionKey,
        descriptor: currentDescriptor,
        createRuntime: () => runtimeFactory({
          descriptor: currentDescriptor,
          adapter: adapterFactory(projectId),
        }),
      });
      viewGeneration = session.claimView();
      if (runtimeRef) runtimeRef.current = session.runtime;
      setOwnerState({ session, startupError: null });
      void session.connect().catch((error) => {
        if (!live) return;
        setOwnerState((current) =>
          current.session === session
            ? { session, startupError: toError(error) }
            : current
        );
      });
    } catch (error) {
      setOwnerState({ session: null, startupError: toError(error) });
    }

    return () => {
      live = false;
      if (runtimeRef && runtimeRef.current === session?.runtime) {
        runtimeRef.current = null;
      }
      if (!session) return;
      const retainModel = retainModelOnUnmountRef.current;
      const released = session.releaseView(viewGeneration, {
        persist: retainModel,
      });
      if (!released || retainModel) return;
      void registry.dispose(sessionKey, session).catch(() => undefined);
    };
  }, [
    adapterFactory,
    identity,
    projectId,
    registry,
    revision,
    runtimeFactory,
    runtimeRef,
    sessionKey,
  ]);

  const restart = async (): Promise<void> => {
    const session = ownerState.session;
    setOwnerState(EMPTY_SESSION_OWNER_STATE);
    if (session) await registry.dispose(sessionKey, session);
    await onReloadRef.current?.();
    setRevision((current) => current + 1);
  };

  const { session, startupError } = ownerState;
  if (!session) {
    if (startupError) {
      const failure = {
        descriptor,
        error: startupError,
        reason: "startup" as const,
        reloading: false,
        reload: restart,
      };
      return failureFallback
        ? failureFallback(failure)
        : <BlockDocumentSurfaceFailureState {...failure} />;
    }
    if (pendingFallback !== undefined) return pendingFallback;
    return (
      <div
        role="status"
        aria-live="polite"
        data-block-document-surface-state="loading"
        className="py-8 text-sm text-token-description-foreground"
      >
        Opening content…
      </div>
    );
  }

  return (
    <OwnedBlockDocumentRuntimeSurface
      runtime={session.runtime}
      projectId={projectId}
      descriptor={descriptor}
      isActive={isActive}
      localAwarenessState={localAwarenessState}
      startupError={startupError}
      onReload={restart}
      pendingFallback={pendingFallback}
      failureFallback={failureFallback}
    >
      {(surface) => {
        if (surface.kind !== "page") {
          throw new TypeError(
            "Page editor session resolved a non-Page Document schema",
          );
        }
        return children({
          ...surface,
          descriptor,
        }, session);
      }}
    </OwnedBlockDocumentRuntimeSurface>
  );
}
