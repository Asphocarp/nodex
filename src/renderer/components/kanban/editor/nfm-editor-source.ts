import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

/**
 * A mounted NFM editor is always a view over an existing collaborative
 * Document. NFM parsing belongs to explicit import/export boundaries and must
 * never be used to rehydrate an editor after collaboration has started.
 */
export interface NfmEditorSource {
  readonly kind: "collaborative-document";
  readonly documentId: string;
  readonly storeEpoch: string;
  readonly generation: number;
  readonly clientSessionId: string;
  readonly fragment: Y.XmlFragment;
  readonly user: {
    readonly name: string;
    readonly color: string;
  };
  readonly provider?: {
    readonly awareness?: Awareness;
  };
  /** Editor-local invalidation hint. It is not a persistence callback. */
  readonly onDocumentChange?: () => void;
}

export type NfmEditorCollaborativeDocumentSource = NfmEditorSource;

export interface NfmEditorModeOptions {
  readonly collaboration: {
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

export function createNfmEditorModeOptions(
  source: NfmEditorSource,
): NfmEditorModeOptions {
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
  readonly projectId: string;
  readonly source: NfmEditorSource;
}): string {
  return [
    "collaborative-document",
    input.projectId,
    input.source.documentId,
    input.source.generation,
    getCollaborativeFragmentId(input.source.fragment),
  ].join(":");
}

export function resolveNfmEditorBlockActionCapabilities(
  hasSourceCardContext: boolean,
): {
  readonly canMoveBlocks: boolean;
  readonly canSendBlocksToThread: boolean;
} {
  return {
    canMoveBlocks: hasSourceCardContext,
    canSendBlocksToThread: hasSourceCardContext,
  };
}
