import {
  createContext,
  type ReactNode,
  useContext,
} from "react";
import {
  mcpAppRuntimeManager,
  type McpAppRuntimeManager,
} from "./mcp-app-runtime-manager";

const McpAppRuntimeManagerContext = createContext<McpAppRuntimeManager>(
  mcpAppRuntimeManager,
);

export function McpAppRuntimeManagerProvider({
  children,
  manager,
}: {
  children: ReactNode;
  manager: McpAppRuntimeManager;
}) {
  return (
    <McpAppRuntimeManagerContext.Provider value={manager}>
      {children}
    </McpAppRuntimeManagerContext.Provider>
  );
}

export function useMcpAppRuntimeManager(): McpAppRuntimeManager {
  return useContext(McpAppRuntimeManagerContext);
}
