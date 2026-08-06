import type { MutableRefObject, ReactNode } from "react";
import type {
  PageInput,
  WorkflowStatus,
  CodexPromptInput,
  CodexThreadSummary,
} from "@/lib/types";
import type {
  PageStagePageModel,
  PageStageMetadataMutationResult,
} from "@/lib/page-stage-page";
import type { BlockRecordWindowStore } from "@/lib/block-record-window-store";
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

export interface PageStageProps {
  onClose: () => void;
  /** Stable PageTab identity whose editor model may outlive this React view. */
  editorSessionKey?: string;
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
  /** Publishes the canonical plain-text Page title for surrounding chrome. */
  onTitleChange?: (title: string) => void;
  /** Focuses the title when this Page surface first mounts. */
  autoFocusTitle?: boolean;
  /** Signals that the mounted title publisher is no longer active. */
  onTitleSourceDispose?: () => void;
  closeRef?: MutableRefObject<(() => Promise<void>) | null>;
  persistRef?: MutableRefObject<(() => Promise<void>) | null>;
  sessionSnapshotRef?: MutableRefObject<PageStageSessionSnapshot | null>;
  isActivePanelTab?: boolean;
  page: PageStagePageModel | null;
  /** Content access context for linked blocks and agent tools. */
  contentAccessContext: ContentAccessContext;
  /** Renderer-local scope for linked content and page tools. */
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
  /** Optional in-memory BlockRecord window seam for tests and Storybook. */
  recordWindowStore?: BlockRecordWindowStore;
}
