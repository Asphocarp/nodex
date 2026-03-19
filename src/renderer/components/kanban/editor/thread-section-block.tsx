import { defaultProps } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { useThreadSectionRuntime } from "./thread-section-runtime";
import { ThreadSectionRow } from "./thread-section-row";

export const createThreadSectionBlockSpec = createReactBlockSpec(
  {
    type: "threadSection" as const,
    propSchema: {
      ...defaultProps,
      label: { default: "" },
      threadId: { default: "" },
    },
    content: "none" as const,
  },
  {
    render: ({ block, editor }) => {
      const runtime = useThreadSectionRuntime();
      const threadId = typeof block.props.threadId === "string" ? block.props.threadId.trim() : "";
      const thread = runtime.threads[threadId] ?? null;
      const pending = runtime.pendingBlockIds.has(block.id);
      const canOpenThread = Boolean(threadId && thread && !thread.archived && runtime.openThread);
      const canSend = Boolean(runtime.send);

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
