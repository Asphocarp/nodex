import { RefreshCw } from "lucide-react";
import { createReactBlockSpec } from "@blocknote/react";
import { syncedBlockRefBlockConfig } from "../../../../shared/block-documents/blocknote-schema-config";

/**
 * Reference-only shell for a Synced Block source. The source body is never a
 * ProseMirror child of the host; an owned-Document boundary may mount it when
 * the reference becomes an interactive surface.
 */
export const createSyncedBlockRefBlockSpec = createReactBlockSpec(
  syncedBlockRefBlockConfig,
  {
    render: ({ block }) => (
      <div
        contentEditable={false}
        data-synced-block-source-id={block.props.sourceBlockId}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-token-foreground/5 px-2 py-1 text-xs text-token-text-secondary"
      >
        <RefreshCw className="icon-2xs shrink-0 text-token-description-foreground" />
        <span className="shrink-0 font-medium">Synced block</span>
        <span className="min-w-0 truncate text-token-description-foreground">
          {block.props.sourceBlockId}
        </span>
      </div>
    ),
  },
);
