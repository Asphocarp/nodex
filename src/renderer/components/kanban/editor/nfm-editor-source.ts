import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import type { PartialBlock } from "@blocknote/core";
import type { PublicBlockTransferIntent } from "../../../../shared/block-transfer-transport";
import type { NfmSchemaType } from "./nfm-schema";

export type NfmEditorInitialContent = PartialBlock<
  NfmSchemaType["blockSchema"],
  NfmSchemaType["inlineContentSchema"],
  NfmSchemaType["styleSchema"]
>[];

/**
 * A mounted NFM editor is a view over an existing durable document source.
 * Collaborative Documents and BlockRecord windows have different persistence
 * adapters, but NFM parsing remains an explicit boundary rather than a hidden
 * rehydration path.
 */
interface NfmEditorSourceIdentity {
  readonly documentId: string;
  readonly storeEpoch: string;
  readonly generation: number;
  readonly clientSessionId: string;
  readonly user: {
    readonly name: string;
    readonly color: string;
  };
  /** Editor-local invalidation hint. It is not a persistence callback. */
  readonly onDocumentChange?: (blocks?: readonly unknown[]) => void;
}

export interface NfmEditorCollaborativeDocumentSource extends NfmEditorSourceIdentity {
  readonly kind: "collaborative-document";
  readonly fragment: Y.XmlFragment;
  readonly provider?: {
    readonly awareness?: Awareness;
  };
}

export interface NfmEditorRecordSource extends NfmEditorSourceIdentity {
  /** A bounded BlockRecord window materialized by the record adapter. */
  readonly kind: "record-window";
  readonly initialContent: readonly NfmEditorInitialContent[number][];
  /** Reconciles an already-mounted editor after a newer Core window arrives. */
  readonly contentVersion: number;
  /** Flushes editor-local debounced writes before a structural command. */
  readonly onPrepareForMutation?: () => Promise<void>;
  readonly onMoveBlocksToPage?: (
    blockIds: readonly string[],
    targetPageId: string,
  ) => Promise<void>;
  readonly onTransfer?: (intent: PublicBlockTransferIntent) => Promise<void>;
}

export type NfmEditorSource =
  | NfmEditorCollaborativeDocumentSource
  | NfmEditorRecordSource;

export interface NfmEditorModeOptions {
  readonly collaboration?: {
    readonly fragment: Y.XmlFragment;
    readonly user: {
      readonly name: string;
      readonly color: string;
    };
    readonly provider?: {
      readonly awareness?: Awareness;
    };
  };
  readonly initialContent?: never;
}

export interface NfmRecordEditorModeOptions {
  readonly collaboration?: never;
  /** BlockNote mutates this array while normalizing editor state. */
  readonly initialContent: NfmEditorInitialContent;
}

export function createNfmEditorModeOptions(
  source: NfmEditorSource,
): NfmEditorModeOptions | NfmRecordEditorModeOptions {
  if (source.kind === "record-window") {
    return { initialContent: [...source.initialContent] };
  }
  return {
    collaboration: {
      fragment: source.fragment,
      user: source.user,
      ...(source.provider ? { provider: source.provider } : {}),
    },
  };
}

const collaborativeFragmentIds = new WeakMap<Y.XmlFragment, number>();
let nextCollaborativeFragmentId = 1;

function getCollaborativeFragmentId(fragment: Y.XmlFragment): number {
  const existing = collaborativeFragmentIds.get(fragment);
  if (existing !== undefined) return existing;

  const next = nextCollaborativeFragmentId;
  nextCollaborativeFragmentId += 1;
  collaborativeFragmentIds.set(fragment, next);
  return next;
}

export function getNfmEditorInstanceKey(input: {
  readonly documentScopeId: string;
  readonly source: NfmEditorSource;
}): string {
  return [
    input.source.kind,
    input.documentScopeId,
    input.source.documentId,
    input.source.generation,
    input.source.kind === "collaborative-document"
      ? getCollaborativeFragmentId(input.source.fragment)
      : "record-window",
  ].join(":");
}

export function resolveNfmEditorBlockActionCapabilities(
  hasSourcePageContext: boolean,
  executionProjectId: string | null,
): {
  readonly canMoveBlocks: boolean;
  readonly canSendBlocksToThread: boolean;
} {
  return {
    canMoveBlocks: hasSourcePageContext && executionProjectId !== null,
    canSendBlocksToThread:
      hasSourcePageContext && executionProjectId !== null,
  };
}
