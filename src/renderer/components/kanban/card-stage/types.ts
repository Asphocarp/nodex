import type { MutableRefObject } from "react";
import type {
  Card,
  CardInput,
  CardUpdateMutationResult,
  CodexPromptInput,
  CodexThreadSummary,
} from "@/lib/types";
import type { ReadyCardBlockDocumentDescriptor } from "@/lib/owned-block-document";
import type { BlockDocumentSurfaceDependencies } from "@/components/block-documents/block-document-surface";

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
  closeRef?: MutableRefObject<(() => Promise<void>) | null>;
  persistRef?: MutableRefObject<(() => Promise<void>) | null>;
  sessionSnapshotRef?: MutableRefObject<CardStageSessionSnapshot | null>;
  isActivePanelTab?: boolean;
  card: Card | null;
  columnId: string;
  columnName: string;
  projectId: string;
  projectName?: string | null;
  projectWorkspacePath?: string | null;
  availableTags: string[];
  onUpdate: (
    columnId: string,
    cardId: string,
    updates: Partial<CardInput>,
  ) => Promise<CardUpdateMutationResult | void>;
  onDelete: (columnId: string, cardId: string) => Promise<void>;
  onMove: (fromStatus: Card["status"], cardId: string, toStatus: Card["status"]) => Promise<void>;
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
