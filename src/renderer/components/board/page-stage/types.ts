import type { MutableRefObject, ReactNode } from "react";
import type {
  PageInput,
  WorkflowStatus,
  CodexPromptInput,
  CodexThreadSummary,
} from "@/lib/types";
import type { ReadyPageBlockDocumentDescriptor } from "@/lib/owned-block-document";
import type { BlockDocumentSurfaceDependencies } from "@/components/block-documents/block-document-surface";
import type { PageTitleResourceIdentity } from "@/lib/page-title-projection-context";
import type {
  PageStagePageModel,
  PageStageMetadataMutationResult,
} from "@/lib/page-stage-page";
import type { PageStageBreadcrumbProps } from "./breadcrumb";
import type { DatabaseId } from "../../../../shared/database-identities";
import type { ContentAccessContext } from "../../../../shared/content-access-context";
import type { PageStagePropertyEdit } from "@/lib/page-stage-properties";

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
  /** Stable resource identity for renderer-local live title projection. */
  pageTitleIdentity?: PageTitleResourceIdentity;
  /** False for an unpromoted preview whose model ends with this view. */
  retainEditorSession?: boolean;
  /** Optional route-level navigation control for standalone Page surfaces. */
  onNavigateBack?: () => void;
  /** Hosts the single Page toolbar outside the surface without duplicating it. */
  toolbarPlacement?:
    | { readonly kind: "surface" }
    | {
        readonly kind: "external";
        readonly render: (toolbar: ReactNode) => ReactNode;
      };
  onLeavePage?: (snapshot: PageStageSessionSnapshot) => void;
  /** Focuses the collaborative title when this Page surface first mounts. */
  autoFocusTitle?: boolean;
  closeRef?: MutableRefObject<(() => Promise<void>) | null>;
  persistRef?: MutableRefObject<(() => Promise<void>) | null>;
  sessionSnapshotRef?: MutableRefObject<PageStageSessionSnapshot | null>;
  isActivePanelTab?: boolean;
  page: PageStagePageModel | null;
  /** Content authority selected by the mounted Project or Resource surface. */
  contentAccessContext: ContentAccessContext;
  /** Renderer-local identity for the mounted collaborative Document surface. */
  documentScopeId: string;
  projectName?: string | null;
  projectWorkspacePath?: string | null;
  onUpdate: (
    pageId: string,
    updates: Partial<PageInput>,
  ) => Promise<PageStageMetadataMutationResult | void>;
  onUpdateProperty: (
    pageId: string,
    propertyId: string,
    edit: PageStagePropertyEdit,
  ) => Promise<PageStageMetadataMutationResult | void>;
  /** Re-reads current Page/Property authority after a stale read window. */
  onRefreshProperties?: () => Promise<void>;
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
  onOpenCanvas?: (input: {
    projectId: string;
    canvasBlockId: string;
    titleSnapshot?: string;
  }) => void | Promise<void>;
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
