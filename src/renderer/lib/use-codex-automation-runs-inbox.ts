import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  subscribeCodexAutomationRunsUpdates,
  subscribeCodexScheduledAutomationChanges,
} from "./api";
import { codexAutomationRunsInboxQueryOptions } from "./query-options";
import { queryKeys } from "./query-keys";

export function useCodexAutomationRunsInbox(limit = 200) {
  const queryClient = useQueryClient();
  const electronAvailable = typeof window !== "undefined" && Boolean(window.api);
  const query = useQuery({
    ...codexAutomationRunsInboxQueryOptions(limit),
    enabled: electronAvailable,
  });

  useEffect(() => {
    if (!electronAvailable) return;
    return subscribeCodexScheduledAutomationChanges(() => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.codexAutomationRuns.inbox(limit),
      });
    });
  }, [electronAvailable, limit, queryClient]);

  useEffect(() => {
    if (!electronAvailable) return;
    return subscribeCodexAutomationRunsUpdates(() => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.codexAutomationRuns.all(),
      });
    });
  }, [electronAvailable, queryClient]);

  return query;
}
