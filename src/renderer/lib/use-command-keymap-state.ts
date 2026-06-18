import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { subscribeCommandKeymapChanges } from "./api";
import { queryKeys } from "./query-keys";
import { commandKeymapStateQueryOptions } from "./query-options";
import type { CommandKeymapState } from "../../shared/command-keybindings";

export function useCommandKeymapState() {
  const queryClient = useQueryClient();
  const query = useQuery(commandKeymapStateQueryOptions());

  useEffect(() => {
    return subscribeCommandKeymapChanges((state: CommandKeymapState) => {
      queryClient.setQueryData(queryKeys.settings.commandKeymap(), state);
    });
  }, [queryClient]);

  return query;
}
