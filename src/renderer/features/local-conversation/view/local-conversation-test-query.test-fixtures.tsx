import { useState, type ReactNode } from "react";
import { queryKeys } from "../../../lib/query-keys";
import { createTestQueryClient, TestQueryProvider } from "../../../test/query";

function createLocalConversationTestQueryClient() {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.mcp.statuses(), {
    data: [],
    nextCursor: null,
  });
  return client;
}

/** Provides isolated server-state defaults for mounted conversation turns. */
export function LocalConversationTestQueryProvider({ children }: { readonly children: ReactNode }) {
  const [client] = useState(createLocalConversationTestQueryClient);
  return <TestQueryProvider client={client}>{children}</TestQueryProvider>;
}
