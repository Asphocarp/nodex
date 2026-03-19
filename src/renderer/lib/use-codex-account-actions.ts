import { useCallback } from "react";
import { invoke } from "./api";
import type { CodexAccountSnapshot } from "./types";

export function useCodexAccountActions() {
  const refreshAccount = useCallback(async () => {
    return (await invoke("codex:account:read")) as CodexAccountSnapshot;
  }, []);

  const startChatGptLogin = useCallback(async () => {
    return (await invoke("codex:account:login:start", { type: "chatgpt" })) as
      | { type: "apiKey" }
      | { type: "chatgpt"; loginId: string; authUrl: string };
  }, []);

  const startApiKeyLogin = useCallback(async (apiKey: string) => {
    return (await invoke("codex:account:login:start", { type: "apiKey", apiKey })) as
      | { type: "apiKey" }
      | { type: "chatgpt"; loginId: string; authUrl: string };
  }, []);

  const cancelLogin = useCallback(async (loginId: string) => {
    return (await invoke("codex:account:login:cancel", loginId)) as { status: "canceled" | "notFound" };
  }, []);

  const logout = useCallback(async () => {
    return (await invoke("codex:account:logout")) as boolean;
  }, []);

  return {
    refreshAccount,
    startChatGptLogin,
    startApiKeyLogin,
    cancelLogin,
    logout,
  };
}
