import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NODEX_QUERY_DEFAULT_OPTIONS } from "@/lib/query-client";

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        ...NODEX_QUERY_DEFAULT_OPTIONS.queries,
        gcTime: Infinity,
        retry: false,
      },
      mutations: {
        ...NODEX_QUERY_DEFAULT_OPTIONS.mutations,
        retry: false,
      },
    },
  });
}

export function TestQueryProvider({
  children,
  client = createTestQueryClient(),
}: {
  children: ReactNode;
  client?: QueryClient;
}) {
  return (
    <QueryClientProvider client={client}>
      {children}
    </QueryClientProvider>
  );
}

