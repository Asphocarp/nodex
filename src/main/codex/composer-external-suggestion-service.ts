import type { ConfigReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigReadResponse";
import type {
  CodexComposerChatGptConversation,
  CodexComposerChatGptConversationListResult,
  CodexComposerSite,
  CodexComposerSiteListResult,
} from "../../shared/types";
import { resolveChatGptBaseUrl } from "./chatgpt-base-url";
import type { ChatGptDesktopRequestInput } from "./chatgpt-desktop-request";

const CHATGPT_RECENT_CONVERSATION_LIMIT = 5;
const CHATGPT_CONVERSATION_QUERY_MAX_CHARACTERS = 100;
const MAX_EXTERNAL_SUGGESTION_ROWS = 100;
const SITES_PAGE_LIMIT = 20;
const CHATGPT_ATTACH_HEADERS = {
  "X-OpenAI-Attach-Auth": "1",
  "X-OpenAI-Attach-Integrity-State": "1",
} as const;

interface ComposerExternalSuggestionServiceDependencies {
  readAuthMethod: () => Promise<string | null>;
  readConfig: () => Promise<ConfigReadResponse>;
  requestChatGptDesktop: (input: ChatGptDesktopRequestInput) => Promise<Response>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function nonBlankString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function parseStructuredContent(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return null;
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

export function parseComposerSitesToolResponse(payload: unknown): CodexComposerSite[] {
  const root = asRecord(payload);
  if (!root || root.error !== undefined) return [];
  const result = asRecord(root.result);
  if (!result || result.isError === true) return [];
  const structuredContent = parseStructuredContent(result.structuredContent);
  if (!structuredContent || !Array.isArray(structuredContent.items)) return [];

  const sites: CodexComposerSite[] = [];
  const seenIds = new Set<string>();
  for (const value of structuredContent.items.slice(0, MAX_EXTERNAL_SUGGESTION_ROWS)) {
    const item = asRecord(value);
    const id = nonBlankString(item?.id);
    const slug = nonBlankString(item?.slug);
    if (!id || !slug || seenIds.has(id)) continue;
    seenIds.add(id);
    sites.push({
      id,
      title: typeof item?.title === "string" ? item.title : "",
      slug,
      currentLiveUrl: nullableString(item?.current_live_url),
      path: `sites-project://${encodeURIComponent(id)}`,
    });
  }
  return sites;
}

export function parseComposerChatGptConversations(
  payload: unknown,
): CodexComposerChatGptConversation[] {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root.items)) return [];

  const conversations: CodexComposerChatGptConversation[] = [];
  const seenIds = new Set<string>();
  for (const value of root.items.slice(0, MAX_EXTERNAL_SUGGESTION_ROWS)) {
    const item = asRecord(value);
    const conversationId = nonBlankString(item?.conversation_id) ?? nonBlankString(item?.id);
    if (!conversationId || seenIds.has(conversationId)) continue;
    seenIds.add(conversationId);
    conversations.push({
      conversationId,
      title: typeof item?.title === "string" ? item.title : "",
      path: `chatgpt-conversation://${encodeURIComponent(conversationId)}`,
    });
  }
  return conversations;
}

function isChatGptAuthMethod(value: string | null): boolean {
  return value === "chatgpt" || value === "chatgptAuthTokens";
}

function resolveChatGptOrigin(config: ConfigReadResponse): string {
  return new URL(resolveChatGptBaseUrl(config)).origin;
}

function buildRecentConversationPath(): string {
  const query = new URLSearchParams({
    expand: "false",
    is_archived: "false",
    limit: String(CHATGPT_RECENT_CONVERSATION_LIMIT),
    order: "updated",
    offset: "0",
  });
  return `/conversations?${query.toString()}`;
}

function buildConversationSearchPath(query: string): string {
  const params = new URLSearchParams({ query });
  return `/conversations/search?${params.toString()}`;
}

export class CodexComposerExternalSuggestionService {
  constructor(private readonly deps: ComposerExternalSuggestionServiceDependencies) {}

  private async isChatGptAvailable(): Promise<boolean> {
    try {
      return isChatGptAuthMethod(await this.deps.readAuthMethod());
    } catch {
      return false;
    }
  }

  async listSites(): Promise<CodexComposerSiteListResult> {
    if (!(await this.isChatGptAvailable())) {
      return { available: false, sites: [] };
    }

    let config: ConfigReadResponse;
    let origin: string;
    try {
      config = await this.deps.readConfig();
      origin = resolveChatGptOrigin(config);
      const accessResponse = await this.deps.requestChatGptDesktop({
        action: "check Sites availability",
        baseUrl: origin,
        path: "/wham/sites/access",
        method: "GET",
        headers: CHATGPT_ATTACH_HEADERS,
        refreshOn401: true,
      });
      if (!accessResponse.ok) return { available: false, sites: [] };
      const access = asRecord(await readJson(accessResponse));
      if (access?.enabled !== true) return { available: false, sites: [] };
    } catch {
      return { available: false, sites: [] };
    }

    try {
      const response = await this.deps.requestChatGptDesktop({
        action: "list Sites projects",
        baseUrl: origin,
        path: "/wham/apps",
        method: "POST",
        headers: {
          ...CHATGPT_ATTACH_HEADERS,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: 1,
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            arguments: { limit: SITES_PAGE_LIMIT },
            name: "sites_list_sites",
          },
        }),
        refreshOn401: true,
      });
      if (!response.ok) return { available: true, sites: [] };
      return {
        available: true,
        sites: parseComposerSitesToolResponse(await readJson(response)),
      };
    } catch {
      return { available: true, sites: [] };
    }
  }

  async listChatGptConversations(
    query: string,
  ): Promise<CodexComposerChatGptConversationListResult> {
    if (!(await this.isChatGptAvailable())) {
      return { available: false, conversations: [] };
    }

    const normalizedQuery = query.trim().slice(0, CHATGPT_CONVERSATION_QUERY_MAX_CHARACTERS);
    try {
      const config = await this.deps.readConfig();
      const response = await this.deps.requestChatGptDesktop({
        action: "list ChatGPT conversations",
        baseUrl: resolveChatGptBaseUrl(config),
        path: normalizedQuery
          ? buildConversationSearchPath(normalizedQuery)
          : buildRecentConversationPath(),
        method: "GET",
        headers: CHATGPT_ATTACH_HEADERS,
        refreshOn401: true,
      });
      if (!response.ok) return { available: true, conversations: [] };
      return {
        available: true,
        conversations: parseComposerChatGptConversations(await readJson(response)),
      };
    } catch {
      return { available: true, conversations: [] };
    }
  }
}
