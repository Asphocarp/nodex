import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { invoke } from "./api";
import { queryKeys } from "./query-keys";
import { windowRestoreSettingsQueryOptions } from "./query-options";
import type { UpdateWindowRestoreSettingsInput, WindowRestoreSettings } from "./types";

const DEFAULT_SETTINGS: WindowRestoreSettings = {
  policy: "all",
};

function normalizeWindowRestoreSettings(value: unknown): WindowRestoreSettings {
  if (typeof value !== "object" || value === null) return DEFAULT_SETTINGS;
  const policy = (value as { policy?: unknown }).policy;
  if (policy === "all" || policy === "last-window" || policy === "none") {
    return { policy };
  }
  return DEFAULT_SETTINGS;
}

export function useWindowRestoreSettings(): {
  settings: WindowRestoreSettings;
  isLoading: boolean;
  updateSettings: (input: UpdateWindowRestoreSettingsInput) => Promise<WindowRestoreSettings>;
  reloadSettings: () => Promise<void>;
} {
  const queryClient = useQueryClient();
  const { data: settings, isPending } = useQuery({
    ...windowRestoreSettingsQueryOptions(),
    select: normalizeWindowRestoreSettings,
  });

  const { mutateAsync: updateSettingsRequest } = useMutation({
    mutationFn: (input: UpdateWindowRestoreSettingsInput) =>
      invoke("settings:window-restore:update", input) as Promise<WindowRestoreSettings>,
    onSuccess: (result) => {
      queryClient.setQueryData(
        queryKeys.settings.windowRestore(),
        normalizeWindowRestoreSettings(result),
      );
    },
  });

  const reloadSettings = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.settings.windowRestore(),
      exact: true,
    });
  }, [queryClient]);

  const updateSettings = useCallback(
    async (input: UpdateWindowRestoreSettingsInput) => {
      const result = await updateSettingsRequest(input);
      return normalizeWindowRestoreSettings(result);
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

export function __resetWindowRestoreSettingsForTests(): void {}
