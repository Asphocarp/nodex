import type { MutableRefObject } from "react";
import type {
  CardInput,
  CardStatus,
  CodexPromptInput,
  CodexThreadSummary,
} from "@/lib/types";
import type { ReadyCardBlockDocumentDescriptor } from "@/lib/owned-block-document";
import type { BlockDocumentSurfaceDependencies } from "@/components/block-documents/block-document-surface";
import type {
  CardStageCardModel,
  CardStageMetadataMutationResult,
} from "@/lib/card-stage-card";

export type { CardStageMetadataMutationResult } from "@/lib/card-stage-card";

export interface CardStageLinkedThread {
  threadId: string;
  title: string;
  preview?: string;
  statusType: CodexThreadSummary["statusType"];
  statusActiveFlags: CodexThreadSummary["statusActiveFlags"];
  archived: boolean;
  updatedAt: number;
}

export interface CardStageSessionSnapshot {
  projectId: string;
  cardId: string;
  titleSnapshot: string;
}

/**
 * Makes the content authority impossible to infer from a Card read model.
 * Card Stage can only mount the owned Y.Doc identified by the prepared
 * descriptor; a Card read-model projection is never an editor input.
 */
export interface CardStageDocumentAuthority {
  readonly kind: "yjs";
  readonly descriptor: ReadyCardBlockDocumentDescriptor;
  readonly reload: () => Promise<void>;
  /** In-memory transport seam for isolated fixtures and tests. */
  readonly surfaceDependencies?: BlockDocumentSurfaceDependencies;
}

export interface CardStageProps {
  onClose: () => void;
  onLeaveCard?: (snapshot: CardStageSessionSnapshot) => void;
  /** Publishes the authoritative plain-text Y.Text title for surrounding chrome. */
  onTitleChange?: (title: string) => void;
  /** Signals that the mounted Y.Text title publisher is no longer authoritative. */
  onTitleSourceDispose?: () => void;
  closeRef?: MutableRefObject<(() => Promise<void>) | null>;
  persistRef?: MutableRefObject<(() => Promise<void>) | null>;
  sessionSnapshotRef?: MutableRefObject<CardStageSessionSnapshot | null>;
  isActivePanelTab?: boolean;
  card: CardStageCardModel | null;
  projectId: string;
  projectName?: string | null;
  projectWorkspacePath?: string | null;
  availableTags: string[];
  onUpdate: (
    cardId: string,
    updates: Partial<CardInput>,
  ) => Promise<CardStageMetadataMutationResult | void>;
  onDelete?: (cardId: string) => Promise<void>;
  onMove?: (cardId: string, toStatus: CardStatus) => Promise<void>;
  onCompleteOccurrence?: (cardId: string, occurrenceStart: Date) => Promise<void>;
  onSkipOccurrence?: (cardId: string, occurrenceStart: Date) => Promise<void>;
  onColumnIdChange?: (columnId: string) => void;
  onOpenTerminalPanel?: () => void;
  onToggleHistoryPanel?: () => void;
  sessionId?: string | null;
  sessionThread?: CodexThreadSummary | null;
  canStartThreadInSession?: boolean;
  linkedCodexThreads?: CardStageLinkedThread[];
  onOpenCodexThread?: (threadId: string) => Promise<void>;
  onOpenCard?: (input: {
    projectId: string;
    cardId: string;
    titleSnapshot?: string;
  }) => void | Promise<void>;
  onOpenNewCodexThread?: () => void;
  onOpenLocalEnvironmentSettings?: (input: {
    projectId: string;
    configPath?: string | null;
  }) => void;
  onStartNewSessionThreadFromEditor?: (input: {
    projectId: string;
    targetSessionId?: string;
    prompt: string;
    promptInput?: CodexPromptInput;
    threadName?: string;
  }) => Promise<{ threadId: string; sessionId?: string }>;
  onSendThreadSectionPrompt?: (input: {
    projectId: string;
    threadId: string;
    prompt: string;
    promptInput?: CodexPromptInput;
  }) => Promise<void>;
  historyPanelActive?: boolean;
  documentAuthority: CardStageDocumentAuthority;
}
