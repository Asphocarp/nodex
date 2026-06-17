import {
  QueryClient,
  QueryClientProvider,
  type DefaultOptions,
} from "@tanstack/react-query";
import { lazy, Suspense, useState, type ReactNode } from "react";

const ReactQueryDevtools = lazy(async () => {
  const module = await import("@tanstack/react-query-devtools");
  return { default: module.ReactQueryDevtools };
});

export const NODEX_QUERY_DEFAULT_OPTIONS: DefaultOptions = {
  queries: {
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  },
  mutations: {
    retry: false,
  },
};

export function createNodexQueryClient(defaultOptions: DefaultOptions = NODEX_QUERY_DEFAULT_OPTIONS): QueryClient {
  return new QueryClient({ defaultOptions });
}

function shouldRenderQueryDevtools(): boolean {
  return process.env.NODE_ENV === "development" && window.__NODEX_STORYBOOK__ !== true;
}

export function NodexQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => createNodexQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {shouldRenderQueryDevtools() ? (
        <Suspense fallback={null}>
          <ReactQueryDevtools initialIsOpen={false} />
        </Suspense>
      ) : null}
    </QueryClientProvider>
  );
}

