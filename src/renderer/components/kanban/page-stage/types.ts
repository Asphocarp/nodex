import type { MutableRefObject } from "react";
import type {
  PageInput,
  WorkflowStatus,
  CodexPromptInput,
  CodexThreadSummary,
} from "@/lib/types";
import type { ReadyPageBlockDocumentDescriptor } from "@/lib/owned-block-document";
import type { BlockDocumentSurfaceDependencies } from "@/components/block-documents/block-document-surface";
import type {
  PageStagePageModel,
  PageStageMetadataMutationResult,
} from "@/lib/page-stage-page";
import type { PageStageBreadcrumbProps } from "./breadcrumb";
import type { DatabaseId } from "../../../../shared/database-identities";

export type { PageStageMetadataMutationResult } from "@/lib/page-stage-page";

export interface PageStageLinkedThread {
  threadId: string;
  title: string;
  preview?: string;
  statusType: CodexThreadSummary["statusType"];
  statusActiveFlags: CodexThreadSummary["statusActiveFlags"];
  archived: boolean;
  updatedAt: number;
}

export interface PageStageSessionSnapshot {
  projectId: string;
  pageId: string;
  titleSnapshot: string;
}

export interface PageStageHistorySnapshot {
  readonly title: string;
  readonly nfm: string;
}

/**
 * Makes the content authority impossible to infer from a Page read model.
 * Page Stage can only mount the owned Y.Doc identified by the prepared
 * descriptor; a Page read-model projection is never an editor input.
 */
export interface PageStageDocumentAuthority {
  readonly kind: "yjs";
  readonly descriptor: ReadyPageBlockDocumentDescriptor;
  readonly reload: () => Promise<void>;
  /** In-memory transport seam for isolated fixtures and tests. */
  readonly surfaceDependencies?: BlockDocumentSurfaceDependencies;
}

export interface PageStageProps {
  onClose: () => void;
  /** Stable PageTab identity whose editor model may outlive this React view. */
  editorSessionKey?: string;
  /** False for an unpromoted preview whose model ends with this view. */
  retainEditorSession?: boolean;
  /** Optional route-level navigation control for standalone Page surfaces. */
  onNavigateBack?: () => void;
  onLeavePage?: (snapshot: PageStageSessionSnapshot) => void;
  /** Publishes the authoritative plain-text Y.Text title for surrounding chrome. */
  onTitleChange?: (title: string) => void;
  /** Focuses the collaborative title when this Page surface first mounts. */
  autoFocusTitle?: boolean;
  /** Signals that the mounted Y.Text title publisher is no longer authoritative. */
  onTitleSourceDispose?: () => void;
  closeRef?: MutableRefObject<(() => Promise<void>) | null>;
  persistRef?: MutableRefObject<(() => Promise<void>) | null>;
  sessionSnapshotRef?: MutableRefObject<PageStageSessionSnapshot | null>;
  isActivePanelTab?: boolean;
  page: PageStagePageModel | null;
  projectId: string;
  projectName?: string | null;
  projectWorkspacePath?: string | null;
  availableTags: string[];
  onUpdate: (
    pageId: string,
    updates: Partial<PageInput>,
  ) => Promise<PageStageMetadataMutationResult | void>;
  onDelete?: (pageId: string) => Promise<void>;
  onMove?: (pageId: string, toStatus: WorkflowStatus) => Promise<void>;
  onCompleteOccurrence?: (pageId: string, occurrenceStart: Date) => Promise<void>;
  onSkipOccurrence?: (pageId: string, occurrenceStart: Date) => Promise<void>;
  onColumnIdChange?: (columnId: string) => void;
  onOpenTerminalPanel?: () => void;
  onToggleHistoryPanel?: (snapshot: PageStageHistorySnapshot) => void;
  sessionId?: string | null;
  sessionThread?: CodexThreadSummary | null;
  canStartThreadInSession?: boolean;
  linkedCodexThreads?: PageStageLinkedThread[];
  onOpenCodexThread?: (threadId: string) => Promise<void>;
  onOpenPage?: (input: {
    projectId: string;
    pageId: string;
    titleSnapshot?: string;
  }) => void | Promise<void>;
  onOpenDatabase?: (databaseId: DatabaseId) => void | Promise<void>;
  breadcrumb?: Omit<PageStageBreadcrumbProps, "currentTitle" | "disabled">;
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
  documentAuthority: PageStageDocumentAuthority;
}
