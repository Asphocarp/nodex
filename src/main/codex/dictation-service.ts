import { getLogger } from "../logging/logger";
import type { BackendLogger } from "../logging/logger";
import type { CodexDictationStateSnapshot } from "../../shared/types";
import type { GetAuthStatusResponse } from "@nodex/codex-app-server-protocol";
import type { ConfigReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigReadResponse";
import { requestChatGptDesktop, type ChatGptDesktopRequestInput } from "./chatgpt-desktop-request";

const DEFAULT_CHATGPT_BASE_URL = "https://chatgpt.com/backend-api";
export const CODEX_DICTATION_SHORTCUT_LABEL = "Ctrl+M";
export const CODEX_DICTATION_BASE64_HEADER = "X-Codex-Base64";

const logger = getLogger({ subsystem: "codex", component: "dictation-service" });

type DictationAuthMethod = CodexDictationStateSnapshot["authMethod"];

export interface CodexDictationServiceDependencies {
  readConfig: () => Promise<ConfigReadResponse>;
  readAuthStatus: (input: { includeToken: boolean; refreshToken: boolean }) => Promise<GetAuthStatusResponse>;
  requestChatGptDesktop?: (input: ChatGptDesktopRequestInput) => Promise<Response>;
  logger?: Pick<BackendLogger, "warn">;
}

function normalizeDictationAuthMethod(value: string | null | undefined): DictationAuthMethod {
  if (value === "chatgpt" || value === "chatgptAuthTokens") return "chatgpt";
  if (value === "apikey" || value === "apiKey") return "apiKey";
  return null;
}

function resolveChatGptBaseUrl(configResponse: ConfigReadResponse): string {
  const config = configResponse.config as Record<string, unknown>;
  const directBaseUrl = typeof config.chatgpt_base_url === "string" ? config.chatgpt_base_url.trim() : "";
  if (directBaseUrl.length > 0) {
    return directBaseUrl.replace(/\/+$/, "");
  }

  const profileName = typeof config.profile === "string" ? config.profile : null;
  const profiles = typeof config.profiles === "object" && config.profiles !== null
    ? config.profiles as Record<string, unknown>
    : null;
  const selectedProfile = profileName && profiles && typeof profiles[profileName] === "object" && profiles[profileName] !== null
    ? profiles[profileName] as Record<string, unknown>
    : null;
  const profiledBaseUrl = typeof selectedProfile?.chatgpt_base_url === "string"
    ? selectedProfile.chatgpt_base_url.trim()
    : "";
  if (profiledBaseUrl.length > 0) {
    return profiledBaseUrl.replace(/\/+$/, "");
  }

  return DEFAULT_CHATGPT_BASE_URL;
}

export class CodexDictationService {
  private readonly requestChatGptDesktop: (input: ChatGptDesktopRequestInput) => Promise<Response>;
  private readonly logger: Pick<BackendLogger, "warn">;

  constructor(private readonly deps: CodexDictationServiceDependencies) {
    this.requestChatGptDesktop = deps.requestChatGptDesktop ?? (async (input) => await requestChatGptDesktop({
      readAuthStatus: deps.readAuthStatus,
      fetchImpl: fetch,
      getAppVersion: () => "0.0.0",
    }, input));
    this.logger = deps.logger ?? logger;
  }

  async readState(): Promise<CodexDictationStateSnapshot> {
    const authStatus = await this.deps.readAuthStatus({ includeToken: false, refreshToken: false });
    const authMethod = normalizeDictationAuthMethod(authStatus.authMethod);

    return {
      isEnabled: authMethod === "chatgpt",
      authMethod,
      isRealtimeVoiceActive: false,
      shortcutLabel: CODEX_DICTATION_SHORTCUT_LABEL,
    };
  }

  async transcribe(input: {
    contentType: string;
    base64Payload: string;
  }): Promise<string> {
    const configResponse = await this.deps.readConfig();
    const baseUrl = resolveChatGptBaseUrl(configResponse);
    const response = await this.requestChatGptDesktop({
      action: "transcribe audio",
      baseUrl,
      path: "/transcribe",
      method: "POST",
      headers: {
        "Content-Type": input.contentType,
        [CODEX_DICTATION_BASE64_HEADER]: "1",
      },
      body: input.base64Payload,
      refreshOn401: true,
      missingAuthErrorMessage: "ChatGPT authentication is required for dictation.",
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      const requestUrl = new URL("/transcribe", `${baseUrl.replace(/\/+$/, "")}/`);
      this.logger.warn("Dictation transcribe proxy failed", {
        status: response.status,
        host: requestUrl.host,
        path: requestUrl.pathname,
        upstreamContentType: response.headers.get("content-type") ?? null,
        bodyPreview: buildUpstreamBodyPreview(bodyText),
      });
      throw new Error("Unable to transcribe audio");
    }

    const bodyText = await response.text();
    try {
      const parsed = JSON.parse(bodyText) as { text?: unknown; body?: { text?: unknown } };
      if (typeof parsed.text === "string") return parsed.text;
      if (typeof parsed.body?.text === "string") return parsed.body.text;
    } catch {
      if (bodyText.trim().length > 0) return bodyText;
    }

    return "";
  }
}

function buildUpstreamBodyPreview(bodyText: string): string {
  const withoutTags = bodyText.replace(/<[^>]*>/g, " ");
  const collapsed = withoutTags.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 240) {
    return collapsed;
  }
  return `${collapsed.slice(0, 239)}…`;
}
