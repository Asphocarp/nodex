import { createContext, useContext, type ReactNode } from "react";
import type { ProtocolAppInfo } from "../../../../../lib/types";

const ThreadMcpAppsContext = createContext<readonly ProtocolAppInfo[]>([]);

export function ThreadMcpAppsProvider({
  apps,
  children,
}: {
  apps: readonly ProtocolAppInfo[];
  children: ReactNode;
}) {
  return <ThreadMcpAppsContext.Provider value={apps}>{children}</ThreadMcpAppsContext.Provider>;
}

export function useThreadMcpApps(): readonly ProtocolAppInfo[] {
  return useContext(ThreadMcpAppsContext);
}
