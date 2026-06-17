import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { invoke, subscribeGitBranchChanges } from "./api";
import { gitBranchStateQueryOptions } from "./query-options";
import { queryKeys } from "./query-keys";

interface UseGitBranchStateOptions {
  enabled?: boolean;
  watch?: boolean;
}

export function useGitBranchState(
  cwd: string | null | undefined,
  options: UseGitBranchStateOptions = {},
) {
  const queryClient = useQueryClient();
  const normalizedCwd = cwd?.trim() ?? "";
  const enabled = options.enabled !== false && normalizedCwd.length > 0;
  const watch = options.watch === true;

  const query = useQuery({
    ...gitBranchStateQueryOptions(normalizedCwd),
    enabled,
  });

  useEffect(() => {
    if (!enabled || !watch) return;

    void invoke("git:branch:watch:start", normalizedCwd).catch(() => {});
    const unsubscribe = subscribeGitBranchChanges((event) => {
      if (event.cwd !== normalizedCwd) return;
      void queryClient.invalidateQueries({
        queryKey: queryKeys.git.branchState(normalizedCwd),
        exact: true,
      });
    });

    return () => {
      unsubscribe();
      void invoke("git:branch:watch:stop").catch(() => {});
    };
  }, [enabled, normalizedCwd, queryClient, watch]);

  return query;
}
