import { useCallback, useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
import {
  BlockNoteSchema,
  createCodeBlockSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from "@blocknote/core";
import type { PartialBlock } from "@blocknote/core";
import { createReactBlockSpec, createReactInlineContentSpec, useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { Bot, FileText, Link2, ListTree, Paperclip, RefreshCw, Rows3, Settings2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { parseNfm, nfmToBlockNote } from "@/lib/nfm";
import { resolveAssetSourceToHttpUrl } from "@/lib/assets";
import { resolveAgentConfigChip, type AgentConfigProps } from "./agent-config-chip";
import { formatAttachmentBytes } from "./attachment-chip-format";
import { createReadonlyDateMentionInlineContentSpec } from "./date-mention-chip";
import { resolveThreadMentionDisplay } from "@/lib/nfm/thread-mention-display";
import { createCalloutBlock } from "./callout-block";
import { createCardToggleBlockSpec } from "./card-toggle-block";
import { editorCodeBlockOptions } from "./code-block-options";
import { imageBlockSpec } from "./image-block";
import {
  openNfmResolvedLinkAction,
  resolveNfmLinkAction,
} from "@/lib/nfm-link-actions";
import { useTheme } from "@/lib/use-theme";
import { ThreadMentionInlineVisual } from "../thread-mention-inline-visual";
import {
  agentConfigInlineContentConfig,
  attachmentInlineContentConfig,
  cardRefBlockConfig,
  databaseViewRefBlockConfig,
  syncedBlockRefBlockConfig,
  threadMentionInlineContentConfig,
  threadSectionBlockConfig,
  toggleListInlineViewBlockConfig,
} from "../../../../shared/block-documents/blocknote-schema-config";

interface ReadonlyNfmBlockNotePreviewProps {
  content: string;
  projectId: string;
  cardId: string;
  historyId?: number | string | null;
  projectWorkspacePath?: string | null;
  className?: string;
}

interface ReadonlyPreviewDocument {
  initialContent: PartialBlock[] | undefined;
  toggleStates: Array<{ id: string; open: boolean }>;
}

interface PreviewAttachmentProps {
  kind: string;
  mode: string;
  source: string;
  name: string;
  mimeType?: string;
  bytes?: number;
  origin?: string;
}

interface PreviewThreadMentionProps {
  uuid: string;
}

interface InertEmbedPlaceholderProps {
  icon: typeof FileText;
  label: string;
  detail?: string;
}

function InertEmbedPlaceholder({
  icon: Icon,
  label,
  detail,
}: InertEmbedPlaceholderProps) {
  return (
    <div
      contentEditable={false}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-token-foreground/5 px-2 py-1 text-xs text-token-text-secondary"
    >
      <Icon className="icon-2xs shrink-0 text-token-description-foreground" />
      <span className="shrink-0 font-medium text-token-text-secondary">{label}</span>
      {detail ? (
        <span className="min-w-0 truncate text-token-description-foreground">{detail}</span>
      ) : null}
    </div>
  );
}

const createReadonlyCardRefBlockSpec = createReactBlockSpec(
  cardRefBlockConfig,
  {
    render: ({ block }) => {
      const sourceProjectId = String(block.props.sourceProjectId || "default");
      const targetBlockId = String(block.props.targetBlockId || block.props.cardId || "").trim();
      const displayHint = String(block.props.displayHint || "").trim();
      return (
        <InertEmbedPlaceholder
          icon={Link2}
          label="Card reference"
          detail={displayHint || targetBlockId || sourceProjectId}
        />
      );
    },
  },
);

const createReadonlyDatabaseViewRefBlockSpec = createReactBlockSpec(
  databaseViewRefBlockConfig,
  {
    render: ({ block }) => (
      <InertEmbedPlaceholder
        icon={Rows3}
        label="Database view"
        detail={String(block.props.displayHint || block.props.databaseViewId || "").trim()}
      />
    ),
  },
);

const createReadonlySyncedBlockRefBlockSpec = createReactBlockSpec(
  syncedBlockRefBlockConfig,
  {
    render: ({ block }) => (
      <InertEmbedPlaceholder
        icon={RefreshCw}
        label="Synced block"
        detail={String(block.props.sourceBlockId || "").trim()}
      />
    ),
  },
);

const createReadonlyThreadSectionBlockSpec = createReactBlockSpec(
  threadSectionBlockConfig,
  {
    render: ({ block }) => {
      const label = String(block.props.label || "").trim();
      const threadId = String(block.props.threadId || "").trim();
      return (
        <InertEmbedPlaceholder
          icon={FileText}
          label="Thread section"
          detail={label || threadId || "Snapshot only"}
        />
      );
    },
  },
);

const createReadonlyToggleListInlineViewBlockSpec = createReactBlockSpec(
  toggleListInlineViewBlockConfig,
  {
    render: ({ block }) => (
      <InertEmbedPlaceholder
        icon={ListTree}
        label="Toggle list view"
        detail={String(block.props.sourceProjectId || "default")}
      />
    ),
  },
);

function formatPreviewAttachmentLabel(props: PreviewAttachmentProps): string {
  const name = props.name.trim() || (props.kind === "text" ? "Pasted text" : "Attachment");
  const size = typeof props.bytes === "number" && props.kind !== "folder"
    ? formatAttachmentBytes(props.bytes)
    : "";
  const mode = props.mode === "link" ? "linked" : "saved";
  return [name, size, mode].filter(Boolean).join(" - ");
}

const createReadonlyAttachmentInlineContentSpec = () =>
  createReactInlineContentSpec(
    attachmentInlineContentConfig,
    {
      render: ({ inlineContent }) => {
        const props = inlineContent.props as PreviewAttachmentProps;
        return (
          <span
            contentEditable={false}
            title={props.source}
            className="inline-flex max-w-full items-baseline whitespace-nowrap rounded-sm! bg-token-charts-purple/10 px-1.5 font-normal text-token-charts-purple"
          >
            <Paperclip className="mr-0.5 -ml-0.5 inline-block size-3.5 shrink-0 self-center" />
            <span className="truncate leading-[inherit]">{formatPreviewAttachmentLabel(props)}</span>
          </span>
        );
      },
    },
  );

const createReadonlyAgentConfigInlineContentSpec = () =>
  createReactInlineContentSpec(
    agentConfigInlineContentConfig,
    {
      render: ({ inlineContent }) => {
        const chip = resolveAgentConfigChip(inlineContent.props as Partial<AgentConfigProps>);
        const Icon = chip.invalid ? Settings2 : chip.detail ? Bot : Settings2;
        return (
          <span
            contentEditable={false}
            title={[chip.label, chip.detail].filter(Boolean).join(" - ")}
            className={cn(
              "inline-flex max-w-full items-baseline whitespace-nowrap rounded-sm! px-1.5 font-normal",
              chip.invalid
                ? "bg-token-foreground/8 text-token-description-foreground"
                : "bg-token-charts-blue/10 text-token-charts-blue",
            )}
          >
            <Icon className="mr-0.5 -ml-0.5 inline-block size-3.5 shrink-0 self-center" />
            <span className="truncate leading-[inherit]">{chip.label}</span>
            {chip.detail ? (
              <span className="ml-1 truncate leading-[inherit] opacity-70">{chip.detail}</span>
            ) : null}
          </span>
        );
      },
    },
  );

const createReadonlyThreadMentionInlineContentSpec = () =>
  createReactInlineContentSpec(
    threadMentionInlineContentConfig,
    {
      render: ({ inlineContent }) => {
        const props = inlineContent.props as PreviewThreadMentionProps;
        const mention = resolveThreadMentionDisplay({ uuid: props.uuid });
        return (
          <ThreadMentionInlineVisual
            contentEditable={false}
            title={props.uuid}
            label={mention.label || "Thread"}
          />
        );
      },
    },
  );

export const readonlyNfmBlockNotePreviewSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    toggleListItem: defaultBlockSpecs.toggleListItem,
    codeBlock: createCodeBlockSpec(editorCodeBlockOptions),
    table: defaultBlockSpecs.table,
    quote: defaultBlockSpecs.quote,
    divider: defaultBlockSpecs.divider,
    image: imageBlockSpec,
    callout: createCalloutBlock(),
    cardToggle: createCardToggleBlockSpec(),
    cardRef: createReadonlyCardRefBlockSpec(),
    databaseViewRef: createReadonlyDatabaseViewRefBlockSpec(),
    syncedBlockRef: createReadonlySyncedBlockRefBlockSpec(),
    threadSection: createReadonlyThreadSectionBlockSpec(),
    toggleListInlineView: createReadonlyToggleListInlineViewBlockSpec(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    attachment: createReadonlyAttachmentInlineContentSpec(),
    agentConfig: createReadonlyAgentConfigInlineContentSpec(),
    dateMention: createReadonlyDateMentionInlineContentSpec(),
    threadMention: createReadonlyThreadMentionInlineContentSpec(),
  },
  styleSpecs: defaultStyleSpecs,
});

export function createReadonlyNfmPreviewDocument(content: string): ReadonlyPreviewDocument {
  if (!content.trim()) {
    return {
      initialContent: undefined,
      toggleStates: [],
    };
  }

  const toggleStates = new Map<string, boolean>();
  const blocks = parseNfm(content);
  const initialContent = nfmToBlockNote(blocks, toggleStates) as PartialBlock[];

  return {
    initialContent: initialContent.length > 0 ? initialContent : undefined,
    toggleStates: Array.from(toggleStates, ([id, open]) => ({ id, open })),
  };
}

function cleanupToggleStates(ids: string[]) {
  for (const id of ids) {
    localStorage.removeItem(`toggle-${id}`);
  }
}

function setToggleStates(toggleStates: ReadonlyPreviewDocument["toggleStates"]): string[] {
  const ids: string[] = [];
  for (const { id, open } of toggleStates) {
    localStorage.setItem(`toggle-${id}`, open ? "true" : "false");
    ids.push(id);
  }
  return ids;
}

export function ReadonlyNfmBlockNotePreview({
  content,
  projectId,
  cardId,
  historyId,
  projectWorkspacePath,
  className,
}: ReadonlyNfmBlockNotePreviewProps) {
  const { resolved: themeMode } = useTheme();
  const toggleBlockIdsRef = useRef<string[]>([]);

  const previewDocument = useMemo(() => {
    cleanupToggleStates(toggleBlockIdsRef.current);
    const nextDocument = createReadonlyNfmPreviewDocument(content);
    toggleBlockIdsRef.current = setToggleStates(nextDocument.toggleStates);
    return nextDocument;
  }, [content, projectId, cardId, historyId]);

  useEffect(() => () => {
    cleanupToggleStates(toggleBlockIdsRef.current);
    toggleBlockIdsRef.current = [];
  }, []);

  const editor = useCreateBlockNote(
    {
      schema: readonlyNfmBlockNotePreviewSchema,
      initialContent: previewDocument.initialContent,
      resolveFileUrl: async (source) => resolveAssetSourceToHttpUrl(source),
      tables: {
        headers: true,
        cellBackgroundColor: true,
        cellTextColor: false,
        splitCells: false,
      },
    },
    [projectId, cardId, historyId, content],
  );

  const handleClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const anchor = target.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;
    if (!event.currentTarget.contains(anchor)) return;

    event.preventDefault();
    event.stopPropagation();

    const action = resolveNfmLinkAction(anchor.getAttribute("href") ?? "", projectWorkspacePath);
    if (!action) return;

    void openNfmResolvedLinkAction(action);
  }, [projectWorkspacePath]);

  return (
    <div
      className={cn("nfm-editor readonly-nfm-blocknote-preview relative", className)}
      style={{ minHeight: 0 }}
      onClickCapture={handleClickCapture}
      spellCheck={false}
      data-testid="readonly-nfm-blocknote-preview"
      data-project-id={projectId}
      data-card-id={cardId}
      data-history-id={historyId ?? undefined}
      data-project-workspace-path={projectWorkspacePath ?? undefined}
    >
      <BlockNoteView
        editor={editor}
        editable={false}
        theme={themeMode}
        formattingToolbar={false}
        linkToolbar={false}
        slashMenu={false}
        sideMenu={false}
        filePanel={false}
        tableHandles={false}
        emojiPicker={false}
        comments={false}
        data-theming-css-variables-demo
      />
    </div>
  );
}
