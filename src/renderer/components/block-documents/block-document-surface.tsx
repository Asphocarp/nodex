import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MutableRefObject,
  type ReactNode,
} from "react";
import type { Awareness } from "y-protocols/awareness";
import type {
  CardDocumentEnvelope,
  OwnedDocumentDescriptor,
} from "../../../shared/block-documents";
import type { OwnedDocumentEnvelope } from "../../../shared/block-documents/document-schema-adapters";
import { NodexButton } from "@/components/ui/button";
import { createDocumentSyncAdapter } from "@/lib/api";
import {
  BlockDocumentSurfaceRuntime,
  type BlockDocumentSurfaceReloadContext,
  type BlockDocumentSurfaceRuntimeOptions,
  type BlockDocumentSurfaceStatus,
} from "@/lib/block-document-surface-runtime";
import type { DocumentSyncAdapter } from "@/lib/nodex-y-provider";
import type {
  OwnedBlockDocumentModel,
  ReadyCardBlockDocumentDescriptor,
} from "@/lib/owned-block-document";

export type PrimaryCardBlockDocumentDescriptor = ReadyCardBlockDocumentDescriptor;

export type PrimaryOwnedBlockDocumentDescriptor =
  OwnedDocumentDescriptor & {
    readonly ownerLifecycle: "active";
    readonly readiness: "ready";
    readonly sync: { readonly kind: "yjs"; readonly stateVector: Uint8Array };
  };

export type BlockDocumentLocalAwarenessState = Readonly<
  Record<string, unknown>
>;

export interface BlockDocumentSurfaceValue extends CardDocumentEnvelope {
  readonly descriptor: PrimaryCardBlockDocumentDescriptor;
  readonly runtime: BlockDocumentSurfaceRuntime;
  readonly awareness: Awareness;
  readonly clientSessionId: string;
  readonly status: BlockDocumentSurfaceStatus;
}

export type OwnedBlockDocumentSurfaceValue = OwnedDocumentEnvelope & {
  readonly descriptor: PrimaryOwnedBlockDocumentDescriptor;
  readonly runtime: BlockDocumentSurfaceRuntime;
  readonly awareness: Awareness;
  readonly clientSessionId: string;
  readonly status: BlockDocumentSurfaceStatus;
};

export interface BlockDocumentSurfaceDependencies {
  readonly createAdapter?: (projectId: string) => DocumentSyncAdapter;
  readonly createRuntime?: (
    options: BlockDocumentSurfaceRuntimeOptions,
  ) => BlockDocumentSurfaceRuntime;
}

export interface BlockDocumentSurfaceProps {
  readonly projectId: string;
  readonly descriptor: PrimaryCardBlockDocumentDescriptor;
  /** Retained inactive tabs continue syncing content but publish no presence. */
  readonly isActive: boolean;
  readonly localAwarenessState?: BlockDocumentLocalAwarenessState;
  readonly onReload?: (
    context?: BlockDocumentSurfaceReloadContext,
  ) => void | Promise<void>;
  readonly dependencies?: BlockDocumentSurfaceDependencies;
  /** Read-only integration seam for flush/checkpoint before closing a stage. */
  readonly runtimeRef?: MutableRefObject<BlockDocumentSurfaceRuntime | null>;
  /** Surface-specific first-sync placeholder; defaults to the generic status text. */
  readonly pendingFallback?: ReactNode;
  readonly children: (surface: BlockDocumentSurfaceValue) => ReactNode;
}

export interface OwnedBlockDocumentSurfaceProps extends Omit<
  BlockDocumentSurfaceProps,
  "descriptor" | "children"
> {
  readonly descriptor: PrimaryOwnedBlockDocumentDescriptor;
  readonly children: (surface: OwnedBlockDocumentSurfaceValue) => ReactNode;
}

interface SurfaceFailureProps {
  readonly error: Error;
  readonly resetRequired: boolean;
  readonly reloading: boolean;
  readonly reload: () => Promise<void>;
}

const DEFAULT_DEPENDENCIES: BlockDocumentSurfaceDependencies = {};

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const createRuntime = (
  options: BlockDocumentSurfaceRuntimeOptions,
): BlockDocumentSurfaceRuntime => new BlockDocumentSurfaceRuntime(options);

function SurfacePending({
  phase,
  fallback,
}: {
  readonly phase?: string;
  readonly fallback?: ReactNode;
}) {
  if (fallback !== undefined) return fallback;
  const label =
    phase === "connecting" ? "Connecting content…" : "Opening content…";
  return (
    <div
      role="status"
      aria-live="polite"
      data-block-document-surface-state={phase ?? "loading"}
      className="py-8 text-sm text-token-description-foreground"
    >
      {label}
    </div>
  );
}

function SurfaceFailure({
  error,
  resetRequired,
  reloading,
  reload,
}: SurfaceFailureProps) {
  return (
    <div
      role="alert"
      data-block-document-surface-state={
        resetRequired ? "reset-required" : "error"
      }
      className="flex items-center gap-2 py-8 text-sm"
    >
      <span className="min-w-0 text-token-description-foreground">
        {resetRequired
          ? "This content needs to resync before editing can continue."
          : "Couldn’t open this collaborative content."}
      </span>
      <NodexButton
        type="button"
        size="xs"
        variant="secondary"
        disabled={reloading}
        title={error.message}
        onClick={() => void reload()}
      >
        {reloading ? "Reloading…" : "Reload"}
      </NodexButton>
    </div>
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const makeActiveAwarenessState = (
  runtime: BlockDocumentSurfaceRuntime,
  projectId: string,
  descriptor: PrimaryOwnedBlockDocumentDescriptor,
  configured: BlockDocumentLocalAwarenessState | undefined,
  retained: Record<string, unknown> | null,
): Record<string, unknown> => {
  const current = runtime.awareness.getLocalState();
  const base = retained ?? (isRecord(current) ? current : {});
  const configuredNodex = isRecord(configured?.nodex) ? configured.nodex : {};
  const retainedNodex = isRecord(base.nodex) ? base.nodex : {};
  return {
    ...base,
    ...configured,
    nodex: {
      ...retainedNodex,
      ...configuredNodex,
      projectId,
      ownerBlockId: descriptor.ownerBlockId,
      clientSessionId: runtime.clientSessionId,
    },
  };
};

const useSurfaceAwareness = (
  runtime: BlockDocumentSurfaceRuntime,
  projectId: string,
  descriptor: PrimaryOwnedBlockDocumentDescriptor,
  isActive: boolean,
  configured: BlockDocumentLocalAwarenessState | undefined,
): void => {
  const retainedStateRef = useRef<Record<string, unknown> | null>(null);
  const configuredRef = useRef(configured);
  configuredRef.current = configured;

  useEffect(() => {
    const awareness = runtime.awareness;
    const localClientId = runtime.document.clientID;

    if (isActive) {
      awareness.setLocalState(
        makeActiveAwarenessState(
          runtime,
          projectId,
          descriptor,
          configuredRef.current,
          retainedStateRef.current,
        ),
      );
      return;
    }

    const clearPresence = (): void => {
      const current = awareness.getLocalState();
      if (!isRecord(current)) return;
      retainedStateRef.current = current;
      runtime.clearLocalAwareness();
    };
    const handleAwarenessUpdate = (changes: {
      readonly added: readonly number[];
      readonly updated: readonly number[];
    }): void => {
      if (
        !changes.added.includes(localClientId) &&
        !changes.updated.includes(localClientId)
      ) {
        return;
      }
      clearPresence();
    };

    awareness.on("update", handleAwarenessUpdate);
    clearPresence();
    return () => awareness.off("update", handleAwarenessUpdate);
  }, [descriptor, isActive, projectId, runtime]);
};

interface ReadySurfaceProps {
  readonly runtime: BlockDocumentSurfaceRuntime;
  readonly projectId: string;
  readonly descriptor: PrimaryOwnedBlockDocumentDescriptor;
  readonly isActive: boolean;
  readonly localAwarenessState?: BlockDocumentLocalAwarenessState;
  readonly startupError: Error | null;
  readonly onReload: () => Promise<void>;
  readonly pendingFallback?: ReactNode;
  readonly children: OwnedBlockDocumentSurfaceProps["children"];
}

function ReadySurface({
  runtime,
  projectId,
  descriptor,
  isActive,
  localAwarenessState,
  startupError,
  onReload,
  pendingFallback,
  children,
}: ReadySurfaceProps) {
  const status = useSyncExternalStore(
    runtime.subscribe,
    runtime.getStatus,
    runtime.getStatus,
  );
  const [reloading, setReloading] = useState(false);
  const reloadInFlightRef = useRef(false);
  useSurfaceAwareness(
    runtime,
    projectId,
    descriptor,
    isActive,
    localAwarenessState,
  );

  const reload = async (): Promise<void> => {
    if (reloadInFlightRef.current) return;
    reloadInFlightRef.current = true;
    setReloading(true);
    try {
      if (status.reloadRequired) {
        await runtime.reload();
      } else {
        await runtime.close();
      }
    } finally {
      await onReload();
    }
  };

  useEffect(() => {
    if (status.phase !== "reset-required" || reloadInFlightRef.current) return;
    reloadInFlightRef.current = true;
    setReloading(true);
    void runtime
      .reload()
      .finally(onReload)
      .catch(() => {
        reloadInFlightRef.current = false;
        setReloading(false);
      });
  }, [onReload, runtime, status.phase]);

  const failure = startupError ?? status.error;
  if (failure) {
    return (
      <SurfaceFailure
        error={failure}
        resetRequired={status.phase === "reset-required"}
        reloading={reloading}
        reload={reload}
      />
    );
  }

  const document = status.ready ? runtime.getReadyDocument() : null;
  if (!document) {
    return <SurfacePending phase={status.phase} fallback={pendingFallback} />;
  }

  return children({
    ...document,
    descriptor,
    runtime,
    awareness: runtime.awareness,
    clientSessionId: runtime.clientSessionId,
    status,
  });
}

interface RuntimeOwnerProps extends OwnedBlockDocumentSurfaceProps {
  readonly restart: () => void;
}

interface RuntimeOwnerState {
  readonly runtime: BlockDocumentSurfaceRuntime | null;
  readonly startupError: Error | null;
}

const EMPTY_RUNTIME_OWNER_STATE: RuntimeOwnerState = {
  runtime: null,
  startupError: null,
};

function RuntimeOwner({
  projectId,
  descriptor: descriptorProp,
  isActive,
  localAwarenessState,
  onReload,
  dependencies = DEFAULT_DEPENDENCIES,
  runtimeRef,
  pendingFallback,
  children,
  restart,
}: RuntimeOwnerProps) {
  const [descriptor] = useState(descriptorProp);
  const [ownerState, setOwnerState] = useState<RuntimeOwnerState>(
    EMPTY_RUNTIME_OWNER_STATE,
  );
  const closeTailRef = useRef<Promise<void>>(Promise.resolve());
  const onReloadRef = useRef(onReload);
  onReloadRef.current = onReload;
  const adapterFactory =
    dependencies.createAdapter ?? createDocumentSyncAdapter;
  const runtimeFactory = dependencies.createRuntime ?? createRuntime;

  useLayoutEffect(() => {
    let live = true;
    let ownedRuntime: BlockDocumentSurfaceRuntime | null = null;
    setOwnerState(EMPTY_RUNTIME_OWNER_STATE);

    const openAfterPreviousClose = async (): Promise<void> => {
      await closeTailRef.current;
      if (!live) return;

      try {
        if (descriptor.projectId !== projectId) {
          throw new TypeError(
            "Block Document surface Project does not match its descriptor",
          );
        }
        const adapter = adapterFactory(projectId);
        ownedRuntime = runtimeFactory({
          descriptor,
          adapter,
          reload: (context) => onReloadRef.current?.(context),
        });
        if (runtimeRef) runtimeRef.current = ownedRuntime;
        setOwnerState({ runtime: ownedRuntime, startupError: null });
        await ownedRuntime.connect();
      } catch (error) {
        if (!live) return;
        setOwnerState((current) => ({
          runtime: current.runtime,
          startupError: toError(error),
        }));
      }
    };

    void openAfterPreviousClose();

    return () => {
      live = false;
      if (runtimeRef?.current === ownedRuntime) runtimeRef.current = null;
      setOwnerState((current) =>
        current.runtime === ownedRuntime
          ? EMPTY_RUNTIME_OWNER_STATE
          : current,
      );
      if (!ownedRuntime) return;
      closeTailRef.current = ownedRuntime.close().then(
        () => undefined,
        () => undefined,
      );
    };
  }, [adapterFactory, descriptor, projectId, runtimeFactory, runtimeRef]);

  const { runtime, startupError } = ownerState;

  const reloadWithoutRuntime = async (): Promise<void> => {
    try {
      await onReloadRef.current?.();
    } finally {
      restart();
    }
  };

  if (!runtime) {
    if (startupError) {
      return (
        <SurfaceFailure
          error={startupError}
          resetRequired={false}
          reloading={false}
          reload={reloadWithoutRuntime}
        />
      );
    }
    return <SurfacePending fallback={pendingFallback} />;
  }

  const handleReload = async (): Promise<void> => {
    try {
      if (!runtime.getStatus().reloadRequired) {
        await onReloadRef.current?.();
      }
    } finally {
      restart();
    }
  };

  return (
    <ReadySurface
      runtime={runtime}
      projectId={projectId}
      descriptor={descriptor}
      isActive={isActive}
      localAwarenessState={localAwarenessState}
      startupError={startupError}
      onReload={handleReload}
      pendingFallback={pendingFallback}
    >
      {children}
    </ReadySurface>
  );
}

const surfaceIdentity = (
  projectId: string,
  descriptor: PrimaryOwnedBlockDocumentDescriptor,
): string =>
  [
    projectId,
    descriptor.documentId,
    descriptor.storeEpoch,
    descriptor.generation,
  ].join("\u0000");

/**
 * Owns one independent Y.Doc/provider pair for one mounted writable surface.
 * The authoritative roots are withheld until the initial state-vector sync and
 * schema validation have completed.
 */
export function OwnedBlockDocumentSurface(
  props: OwnedBlockDocumentSurfaceProps,
) {
  const [revision, setRevision] = useState(0);
  const identity = surfaceIdentity(props.projectId, props.descriptor);
  return (
    <RuntimeOwner
      key={`${identity}\u0000${revision}`}
      {...props}
      restart={() => setRevision((current) => current + 1)}
    />
  );
}

/** Card-named compatibility surface with a statically typed title root. */
export function BlockDocumentSurface(props: BlockDocumentSurfaceProps) {
  return (
    <OwnedBlockDocumentSurface {...props}>
      {(surface) => {
        if (surface.kind !== "card") {
          throw new TypeError(
            "Card surface resolved a non-Card Document schema",
          );
        }
        return props.children({
          ...surface,
          descriptor: props.descriptor,
        });
      }}
    </OwnedBlockDocumentSurface>
  );
}

export const isPrimaryOwnedBlockDocumentModel = (
  model: OwnedBlockDocumentModel,
): model is Extract<
  OwnedBlockDocumentModel,
  { readonly status: "ready" }
> => model.status === "ready";
