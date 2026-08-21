import type { ListPageHistoryRequest } from "../shared/page-history";
import {
  PageHistoryContractError,
  pageHistoryFailure,
  pageHistoryTransportFailure,
  parseListPageHistoryRequest,
  type PageHistoryCommandResult,
} from "../shared/page-history-transport";

export const PAGE_HISTORY_LIST_IPC_CHANNEL = "pages:history:list" as const;

export interface PageHistoryIpcDependencies {
  readonly registerHandle: (
    channel: typeof PAGE_HISTORY_LIST_IPC_CHANNEL,
    listener: (event: unknown, rawRequest: unknown) => Promise<PageHistoryCommandResult>,
  ) => void;
  readonly isTrustedEvent: (event: unknown) => boolean;
  readonly listHistory: (request: ListPageHistoryRequest) => Promise<PageHistoryCommandResult>;
}

const invalidResult = (error: unknown): PageHistoryCommandResult => ({
  ok: false,
  error: pageHistoryFailure(
    "invalid_page_history_request",
    error instanceof PageHistoryContractError ? error.message : "Page history request is invalid",
  ),
});

export const registerPageHistoryIpcHandler = (dependencies: PageHistoryIpcDependencies): void => {
  dependencies.registerHandle(PAGE_HISTORY_LIST_IPC_CHANNEL, async (event, rawRequest) => {
    if (!dependencies.isTrustedEvent(event)) {
      return invalidResult("Page history requires a trusted window");
    }
    try {
      const request = parseListPageHistoryRequest(rawRequest);
      return await dependencies.listHistory(request).catch(pageHistoryTransportFailure);
    } catch (error) {
      return invalidResult(error);
    }
  });
};
