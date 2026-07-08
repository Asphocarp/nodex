import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "./api";
import {
  localEnvironmentConfigsQueryOptions,
  localEnvironmentOptionsQueryOptions,
  localEnvironmentSnapshotQueryOptions,
} from "./query-options";
import { queryKeys } from "./query-keys";
import type {
  UpdateWorktreeEnvironmentConfigInput,
  WorktreeEnvironmentSettingsSnapshot,
} from "./types";

interface QueryEnabledOptions {
  enabled?: boolean;
}

export function useLocalEnvironmentConfigs(
  projectId: string,
  options: QueryEnabledOptions = {},
) {
  const enabled = options.enabled !== false && projectId.trim().length > 0;
  return useQuery({
    ...localEnvironmentConfigsQueryOptions(projectId),
    enabled,
  });
}

export function useLocalEnvironmentOptions(
  projectId: string,
  options: QueryEnabledOptions = {},
) {
  const enabled = options.enabled !== false && projectId.trim().length > 0;
  return useQuery({
    ...localEnvironmentOptionsQueryOptions(projectId),
    enabled,
  });
}

export function useLocalEnvironmentSnapshot(
  projectId: string,
  configPath?: string | null,
  options: QueryEnabledOptions = {},
) {
  const enabled = options.enabled !== false && projectId.trim().length > 0;
  return useQuery({
    ...localEnvironmentSnapshotQueryOptions(projectId, configPath),
    enabled,
  });
}

export function useSaveLocalEnvironmentConfigMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateWorktreeEnvironmentConfigInput) =>
      invoke("worktrees:environments:config:save", input) as Promise<WorktreeEnvironmentSettingsSnapshot>,
    onSuccess: async (snapshot) => {
      queryClient.setQueryData(
        queryKeys.localEnvironments.config(snapshot.projectId, snapshot.configPath),
        snapshot,
      );
      await queryClient.invalidateQueries({
        queryKey: queryKeys.localEnvironments.configs(snapshot.projectId),
        exact: true,
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.localEnvironments.options(snapshot.projectId),
        exact: true,
      });
    },
  });
}
