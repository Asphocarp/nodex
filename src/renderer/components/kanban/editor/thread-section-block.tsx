import { createReactBlockSpec } from "@blocknote/react";
import { useEffect } from "react";
import { useThreadSectionRuntime } from "./thread-section-runtime";
import { ThreadSectionRow } from "./thread-section-row";
import { threadSectionBlockConfig } from "../../../../shared/block-documents/blocknote-schema-config";

export const createThreadSectionBlockSpec = createReactBlockSpec(
  threadSectionBlockConfig,
  {
    render: ({ block, editor }) => {
      const runtime = useThreadSectionRuntime();
      const scope = runtime.resolveScope?.(block.id) ?? null;
      const threadId = typeof block.props.threadId === "string" ? block.props.threadId.trim() : "";
      const thread = scope?.threads[threadId] ?? runtime.threads[threadId] ?? null;
      const pending = runtime.pendingBlockIds.has(block.id);
      const canOpenThread = Boolean(threadId && thread && !thread.archived && runtime.openThread);
      const canSend = Boolean(runtime.send);

      useEffect(() => {
        runtime.ensureScopeLoaded?.(block.id);
      }, [block.id, runtime]);

      return (
        <ThreadSectionRow
          blockId={block.id}
          label={typeof block.props.label === "string" ? block.props.label : ""}
          threadId={threadId}
          thread={thread}
          pending={pending}
          canOpenThread={canOpenThread}
          canSend={canSend}
          onLabelChange={(nextLabel) => {
            editor.updateBlock(block, { props: { ...block.props, label: nextLabel } });
          }}
          onOpenThread={runtime.openThread}
          onSend={runtime.send}
        />
      );
    },
  },
);
