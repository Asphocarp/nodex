import { createReactBlockSpec } from "@blocknote/react";
import { useEffect } from "react";
import { useThreadSectionRuntime } from "./thread-section-runtime";
import { ThreadSectionRow } from "./thread-section-row";
import { threadSectionBlockConfig } from "../../../../shared/block-documents/blocknote-schema-config";

function ThreadSectionBlock({
  blockId,
  label,
  threadId,
  onLabelChange,
}: {
  blockId: string;
  label: string;
  threadId: string;
  onLabelChange: (label: string) => void;
}) {
  const runtime = useThreadSectionRuntime();
  const scope = runtime.resolveScope?.(blockId) ?? null;
  const thread = scope?.threads[threadId] ?? runtime.threads[threadId] ?? null;
  const pending = runtime.pendingBlockIds.has(blockId);
  const canOpenThread = Boolean(threadId && thread && !thread.archived && runtime.openThread);
  const canSend = Boolean(runtime.send);

  useEffect(() => {
    runtime.ensureScopeLoaded?.(blockId);
  }, [blockId, runtime]);

  return (
    <ThreadSectionRow
      blockId={blockId}
      label={label}
      threadId={threadId}
      thread={thread}
      pending={pending}
      canOpenThread={canOpenThread}
      canSend={canSend}
      onLabelChange={onLabelChange}
      onOpenThread={runtime.openThread}
      onSend={runtime.send}
    />
  );
}

export const createThreadSectionBlockSpec = createReactBlockSpec(threadSectionBlockConfig, {
  render: ({ block, editor }) => (
    <ThreadSectionBlock
      blockId={block.id}
      label={typeof block.props.label === "string" ? block.props.label : ""}
      threadId={typeof block.props.threadId === "string" ? block.props.threadId.trim() : ""}
      onLabelChange={(nextLabel) => {
        editor.updateBlock(block, { props: { ...block.props, label: nextLabel } });
      }}
    />
  ),
});
