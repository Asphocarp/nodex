import type { CodexComposerChatGptConversation, CodexComposerSite } from "../../shared/types";

const MAX_EXTERNAL_SUGGESTION_ROWS = 100;

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;

const nonBlankString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const nullableString = (value: unknown): string | null =>
  typeof value === "string" ? value.trim() || null : null;

const parseStructuredContent = (value: unknown): Readonly<Record<string, unknown>> | null => {
  const direct = asRecord(value);
  if (direct !== null) return direct;
  if (typeof value !== "string") return null;
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
};

export const parseComposerSitesToolResponse = (payload: unknown): CodexComposerSite[] => {
  const root = asRecord(payload);
  if (root === null || root.error !== undefined) return [];
  const result = asRecord(root.result);
  if (result === null || result.isError === true) return [];
  const structuredContent = parseStructuredContent(result.structuredContent);
  if (structuredContent === null || !Array.isArray(structuredContent.items)) return [];

  const sites: CodexComposerSite[] = [];
  const seenIds = new Set<string>();
  for (const value of structuredContent.items.slice(0, MAX_EXTERNAL_SUGGESTION_ROWS)) {
    const item = asRecord(value);
    const id = nonBlankString(item?.id);
    const slug = nonBlankString(item?.slug);
    if (id === null || slug === null || seenIds.has(id)) continue;
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
};

export const parseComposerChatGptConversations = (
  payload: unknown,
): CodexComposerChatGptConversation[] => {
  const root = asRecord(payload);
  if (root === null || !Array.isArray(root.items)) return [];

  const conversations: CodexComposerChatGptConversation[] = [];
  const seenIds = new Set<string>();
  for (const value of root.items.slice(0, MAX_EXTERNAL_SUGGESTION_ROWS)) {
    const item = asRecord(value);
    const conversationId = nonBlankString(item?.conversation_id) ?? nonBlankString(item?.id);
    if (conversationId === null || seenIds.has(conversationId)) continue;
    seenIds.add(conversationId);
    conversations.push({
      conversationId,
      title: typeof item?.title === "string" ? item.title : "",
      path: `chatgpt-conversation://${encodeURIComponent(conversationId)}`,
    });
  }
  return conversations;
};
