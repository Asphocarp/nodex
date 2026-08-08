import type { CodexConversationItem } from "../../../../lib/types";
import { extractCommandActions } from "./command-actions";

const MUTATING_CURL_METHOD_PATTERN = /(?:^|\s)(?:-X\s*|--request(?:=|\s+))(?:POST|PUT|PATCH|DELETE)\b/i;
const CURL_DATA_OPTION_PATTERN = /(?:^|\s)(?:--data(?:-[^\s=]+)?|--json|--form|--upload-file)(?:=|\s|$)/;
const CURL_SHORT_DATA_OPTION_PATTERN = /(?:^|\s)-(?:d|F|T)(?:=|\s|$)/;
const HTTP_URL_PATTERN = /\bhttps?:\/\/[^\s'"<>]+/gi;

function isRemoteHttpUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname !== "localhost" && !hostname.startsWith("127.");
  } catch {
    return false;
  }
}

export function isCurlWebSearchCommand(command: string): boolean {
  if (!/^\s*curl(?:\s|$)/.test(command)) return false;
  if (MUTATING_CURL_METHOD_PATTERN.test(command)) return false;
  if (CURL_DATA_OPTION_PATTERN.test(command)) return false;
  if (CURL_SHORT_DATA_OPTION_PATTERN.test(command)) return false;

  const urls = command.match(HTTP_URL_PATTERN);
  return urls?.some(isRemoteHttpUrl) ?? false;
}

export function resolveConversationCommandText(
  entry: Pick<CodexConversationItem, "command" | "commandActions">,
): string | null {
  const directCommand = entry.command?.trim();
  if (directCommand) return directCommand;

  for (const action of extractCommandActions(entry)) {
    const actionCommand = action.command?.trim();
    if (actionCommand) return actionCommand;
  }

  return null;
}
