import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_CODEX_HOST_ID } from "../../../../shared/codex-host";

interface ConversationImageAssetContextValue {
  conversationId: string | null;
  hostId: string;
}

const ConversationImageAssetContext = createContext<ConversationImageAssetContextValue>({
  conversationId: null,
  hostId: DEFAULT_CODEX_HOST_ID,
});

export function ConversationImageAssetProvider({
  children,
  conversationId,
  hostId,
}: ConversationImageAssetContextValue & { children: ReactNode }) {
  return (
    <ConversationImageAssetContext.Provider value={{ conversationId, hostId }}>
      {children}
    </ConversationImageAssetContext.Provider>
  );
}

export function useConversationImageAssetContext(): ConversationImageAssetContextValue {
  return useContext(ConversationImageAssetContext);
}
