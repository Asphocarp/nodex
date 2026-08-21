import type { ConfigReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigReadResponse";

export const DEFAULT_CHATGPT_BASE_URL = "https://chatgpt.com/backend-api";

export function resolveChatGptBaseUrl(configResponse: ConfigReadResponse): string {
  const config = configResponse.config as Record<string, unknown>;
  const directBaseUrl =
    typeof config.chatgpt_base_url === "string" ? config.chatgpt_base_url.trim() : "";
  if (directBaseUrl.length > 0) return directBaseUrl.replace(/\/+$/, "");

  const profileName = typeof config.profile === "string" ? config.profile : null;
  const profiles =
    typeof config.profiles === "object" && config.profiles !== null
      ? (config.profiles as Record<string, unknown>)
      : null;
  const selectedProfile =
    profileName &&
    profiles &&
    typeof profiles[profileName] === "object" &&
    profiles[profileName] !== null
      ? (profiles[profileName] as Record<string, unknown>)
      : null;
  const profiledBaseUrl =
    typeof selectedProfile?.chatgpt_base_url === "string"
      ? selectedProfile.chatgpt_base_url.trim()
      : "";
  if (profiledBaseUrl.length > 0) return profiledBaseUrl.replace(/\/+$/, "");

  return DEFAULT_CHATGPT_BASE_URL;
}
