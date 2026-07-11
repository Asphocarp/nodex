import type { MutableRefObject } from "react";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

import type { CardStageDescriptionFlushHandle } from "@/components/kanban/card-stage/types";

export interface NfmEditorLegacySnapshotSource {
  kind: "legacy-snapshot";
  content: string;
  onChange: (nfm: string) => void;
  onPendingChange?: () => void;
  onBlur: () => void;
  flushHandleRef?: MutableRefObject<CardStageDescriptionFlushHandle | null>;
}

export interface NfmEditorCollaborativeDocumentSource {
  kind: "collaborative-document";
  documentId: string;
  generation: number;
  fragment: Y.XmlFragment;
  user: {
    name: string;
    color: string;
  };
  provider?: {
    awareness?: Awareness;
  };
  /** Editor-local invalidation hint. It is not a persistence callback. */
  onDocumentChange?: () => void;
}

export type NfmEditorSource =
  | NfmEditorLegacySnapshotSource
  | NfmEditorCollaborativeDocumentSource;

export type NfmEditorModeOptions<InitialContent> =
  | {
      initialContent: InitialContent | undefined;
      collaboration?: never;
    }
  | {
      collaboration: {
        fragment: Y.XmlFragment;
        user: {
          name: string;
          color: string;
        };
        provider?: {
          awareness?: Awareness;
        };
      };
      initialContent?: never;
    };

export function createNfmEditorModeOptions<InitialContent>(
  source: NfmEditorSource,
  legacyInitialContent: InitialContent | undefined,
): NfmEditorModeOptions<InitialContent> {
  if (source.kind === "legacy-snapshot") {
    return { initialContent: legacyInitialContent };
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
  projectId: string;
  sourceCardId?: string;
  source: NfmEditorSource;
}): string {
  if (input.source.kind === "legacy-snapshot") {
    return `legacy:${input.projectId}:${input.sourceCardId ?? "unscoped"}`;
  }

  return [
    "collaborative-document",
    input.projectId,
    input.source.documentId,
    input.source.generation,
    getCollaborativeFragmentId(input.source.fragment),
  ].join(":");
}

export function routeNfmEditorDocumentChange(
  source: NfmEditorSource,
  scheduleLegacySnapshot: () => void,
): "legacy-snapshot" | "collaborative-document" {
  if (source.kind === "collaborative-document") {
    source.onDocumentChange?.();
    return "collaborative-document";
  }

  source.onPendingChange?.();
  scheduleLegacySnapshot();
  return "legacy-snapshot";
}

export function resolveNfmEditorBlockActionCapabilities(
  source: NfmEditorSource,
  hasSourceCardContext: boolean,
): {
  canMoveBlocks: boolean;
  canSendBlocksToThread: boolean;
} {
  if (!hasSourceCardContext) {
    return {
      canMoveBlocks: false,
      canSendBlocksToThread: false,
    };
  }

  return {
    canMoveBlocks: source.kind === "legacy-snapshot",
    canSendBlocksToThread: true,
  };
}
