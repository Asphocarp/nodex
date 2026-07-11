import { createReactBlockSpec } from "@blocknote/react";
import { Rows3 } from "lucide-react";
import { toggleListInlineViewBlockConfig } from "../../../../shared/block-documents/blocknote-schema-config";

/**
 * Read-only bridge for a pre-BF-05 document encountered before startup
 * migration completes. It intentionally never hydrates query rows or writes
 * projected Card children into the host editor.
 */
export const createToggleListInlineViewBlockSpec = createReactBlockSpec(
  toggleListInlineViewBlockConfig,
  {
    render: ({ block }) => (
      <div
        contentEditable={false}
        data-legacy-database-view={block.id}
        className="flex min-h-8 items-center gap-2 py-1 text-sm text-token-description-foreground"
      >
        <Rows3 aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          Migrating Database view from {block.props.sourceProjectId || "this Project"}…
        </span>
      </div>
    ),
  },
);
