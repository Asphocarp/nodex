import { useCallback, useMemo } from "react";
import { invoke } from "./api";
import type { CodexRateLimitResetInput } from "./types";

export function useCodexAccountActions() {
  const refreshAccount = useCallback(async () => {
    return invoke("codex:account:read");
  }, []);

  const consumeRateLimitReset = useCallback(async (input: CodexRateLimitResetInput) => {
    return invoke("codex:account:rate-limit-reset:consume", input);
  }, []);

  const startChatGptLogin = useCallback(async () => {
    return invoke("codex:account:login:start", { type: "chatgpt" });
  }, []);

  const startApiKeyLogin = useCallback(async (apiKey: string) => {
    return invoke("codex:account:login:start", { type: "apiKey", apiKey });
  }, []);

  const cancelLogin = useCallback(async (loginId: string) => {
    return invoke("codex:account:login:cancel", loginId);
  }, []);

  const logout = useCallback(async () => {
    return invoke("codex:account:logout");
  }, []);

  return useMemo(() => ({
    refreshAccount,
    consumeRateLimitReset,
    startChatGptLogin,
    startApiKeyLogin,
    cancelLogin,
    logout,
  }), [cancelLogin, consumeRateLimitReset, logout, refreshAccount, startApiKeyLogin, startChatGptLogin]);
}
