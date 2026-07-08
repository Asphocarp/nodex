import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  subscribeCodexAutomationRunsUpdates,
  subscribeCodexScheduledAutomationChanges,
} from "./api";
import { codexScheduledAutomationsListQueryOptions } from "./query-options";
import { queryKeys } from "./query-keys";

export function useCodexScheduledAutomations() {
  const queryClient = useQueryClient();
  const electronAvailable = typeof window !== "undefined" && Boolean(window.api);
  const query = useQuery({
    ...codexScheduledAutomationsListQueryOptions(),
    enabled: electronAvailable,
  });

  useEffect(() => {
    if (!electronAvailable) return;
    return subscribeCodexScheduledAutomationChanges(() => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.codexScheduledAutomations.list(),
      });
    });
  }, [electronAvailable, queryClient]);

  useEffect(() => {
    if (!electronAvailable) return;
    return subscribeCodexAutomationRunsUpdates(() => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.codexScheduledAutomations.list(),
      });
    });
  }, [electronAvailable, queryClient]);

  return query;
}
