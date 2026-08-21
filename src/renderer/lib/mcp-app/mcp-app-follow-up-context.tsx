import { createContext, type ReactNode, useContext } from "react";
import type { McpAppFollowUpMessage } from "./mcp-app-follow-up";

export type McpAppFollowUpHandler = (message: McpAppFollowUpMessage) => Promise<void>;

const McpAppFollowUpContext = createContext<McpAppFollowUpHandler | null>(null);

export function McpAppFollowUpProvider({
  children,
  onSend,
}: {
  children: ReactNode;
  onSend: McpAppFollowUpHandler;
}) {
  return <McpAppFollowUpContext.Provider value={onSend}>{children}</McpAppFollowUpContext.Provider>;
}

export function useMcpAppFollowUpHandler(): McpAppFollowUpHandler | null {
  return useContext(McpAppFollowUpContext);
}
