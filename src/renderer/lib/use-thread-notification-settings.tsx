import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { invoke } from "./api";
import { queryKeys } from "./query-keys";
import { threadNotificationSettingsQueryOptions } from "./query-options";
import type { ThreadNotificationSettings, UpdateThreadNotificationSettingsInput } from "./types";

const DEFAULT_SETTINGS: ThreadNotificationSettings = {
  turnMode: "unfocused",
  permissionsEnabled: true,
  questionsEnabled: true,
};

export function useThreadNotificationSettings(): {
  settings: ThreadNotificationSettings;
  isLoading: boolean;
  updateSettings: (
    input: UpdateThreadNotificationSettingsInput,
  ) => Promise<ThreadNotificationSettings>;
  reloadSettings: () => Promise<void>;
} {
  const queryClient = useQueryClient();
  const { data: settings, isPending } = useQuery({
    ...threadNotificationSettingsQueryOptions(),
    select: normalizeThreadNotificationSettings,
  });

  const reloadSettings = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.settings.threadNotifications(),
      exact: true,
    });
  }, [queryClient]);

  const { mutateAsync: updateSettingsRequest } = useMutation({
    mutationFn: (input: UpdateThreadNotificationSettingsInput) =>
      invoke("settings:thread-notifications:update", input) as Promise<ThreadNotificationSettings>,
    onSuccess: (result) => {
      queryClient.setQueryData(
        queryKeys.settings.threadNotifications(),
        normalizeThreadNotificationSettings(result),
      );
    },
  });

  const updateSettings = useCallback(
    async (input: UpdateThreadNotificationSettingsInput) => {
      const result = await updateSettingsRequest(input);
      return normalizeThreadNotificationSettings(result);
    },
    [updateSettingsRequest],
  );

  return {
    settings: settings ?? DEFAULT_SETTINGS,
    isLoading: isPending,
    updateSettings,
    reloadSettings,
  };
}

function normalizeThreadNotificationSettings(value: unknown): ThreadNotificationSettings {
  return isThreadNotificationSettings(value) ? value : DEFAULT_SETTINGS;
}

function isThreadNotificationSettings(value: unknown): value is ThreadNotificationSettings {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ThreadNotificationSettings>;
  if (
    candidate.turnMode !== "off" &&
    candidate.turnMode !== "unfocused" &&
    candidate.turnMode !== "always"
  ) {
    return false;
  }
  return (
    typeof candidate.permissionsEnabled === "boolean" &&
    typeof candidate.questionsEnabled === "boolean"
  );
}

export function __resetThreadNotificationSettingsForTests(): void {}
