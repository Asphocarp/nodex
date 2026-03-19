import { createPortal } from "react-dom";
import type { ThreadBlockModel } from "../thread-stage-types";
import { ThreadBlockRenderer } from "./blocks/local-conversation-block-renderer";
import { usePortalHost } from "./use-portal-host";

export const LOCAL_CONVERSATION_FIXED_ABOVE_COMPOSER_PORTAL_ID = "above-composer-portal";
export const LOCAL_CONVERSATION_QUEUE_ABOVE_COMPOSER_PORTAL_ID = "above-composer-queue-portal";

export function LocalConversationAboveComposerPortalHost() {
  return (
    <div className="px-panel z-10 mx-auto flex w-full max-w-[var(--thread-composer-max-width)] flex-col pb-2">
      <div className="contents" data-thread-find-composer="true">
        <div className="relative h-0" />
        <div>
          <div id={LOCAL_CONVERSATION_FIXED_ABOVE_COMPOSER_PORTAL_ID} className="relative px-3 empty:hidden" />
          <div id={LOCAL_CONVERSATION_QUEUE_ABOVE_COMPOSER_PORTAL_ID} className="relative px-3 empty:hidden" />
        </div>
      </div>
    </div>
  );
}

interface LocalConversationAboveComposerPortalProps {
  blocks: ThreadBlockModel[];
  isLatestTurn: boolean;
  isStreamingTurn: boolean;
  projectWorkspacePath?: string | null;
  threadCwd?: string | null;
}

export function LocalConversationAboveComposerPortal({
  blocks,
  isLatestTurn,
  isStreamingTurn,
  projectWorkspacePath,
  threadCwd,
}: LocalConversationAboveComposerPortalProps) {
  const host = usePortalHost(LOCAL_CONVERSATION_FIXED_ABOVE_COMPOSER_PORTAL_ID);
  if (blocks.length === 0) return null;
  if (!host) return null;

  return createPortal(
    <div className="flex flex-col">
      {blocks.map((block) => (
        <ThreadBlockRenderer
          key={block.id}
          block={block}
          isLatestTurn={isLatestTurn}
          isStreamingTurn={isStreamingTurn}
          projectWorkspacePath={projectWorkspacePath}
          threadCwd={threadCwd}
        />
      ))}
    </div>,
    host,
  );
}
