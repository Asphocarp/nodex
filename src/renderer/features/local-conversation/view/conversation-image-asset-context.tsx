import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_CODEX_HOST_ID } from "../../../../shared/codex-host";
import type { ImageEditComposerTarget } from "@/features/user-attachment-image-editor";

interface ConversationImageAssetContextValue {
  conversationId: string | null;
  hostId: string;
  composerTarget: ImageEditComposerTarget | null;
}

const ConversationImageAssetContext = createContext<ConversationImageAssetContextValue>({
  conversationId: null,
  hostId: DEFAULT_CODEX_HOST_ID,
  composerTarget: null,
});

export function ConversationImageAssetProvider({
  children,
  composerTarget = null,
  conversationId,
  hostId,
}: Omit<ConversationImageAssetContextValue, "composerTarget"> & {
  children: ReactNode;
  composerTarget?: ImageEditComposerTarget | null;
}) {
  return (
    <ConversationImageAssetContext.Provider value={{ composerTarget, conversationId, hostId }}>
      {children}
    </ConversationImageAssetContext.Provider>
  );
}

export function useConversationImageAssetContext(): ConversationImageAssetContextValue {
  return useContext(ConversationImageAssetContext);
}
