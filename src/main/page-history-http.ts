import type { Context, Hono } from "hono";
import type { PageHistoryCursor, ListPageHistoryRequest } from "../shared/page-history";
import {
  PageHistoryContractError,
  pageHistoryFailure,
  pageHistoryHttpStatus,
  pageHistoryTransportFailure,
  parseListPageHistoryRequest,
  type PageHistoryCommandResult,
} from "../shared/page-history-transport";

export interface PageHistoryHttpDependencies {
  readonly listHistory: (
    request: ListPageHistoryRequest,
  ) => Promise<PageHistoryCommandResult>;
}

const invalidResult = (error: unknown): PageHistoryCommandResult => ({
  ok: false,
  error: pageHistoryFailure(
    "invalid_page_history_request",
    error instanceof PageHistoryContractError
      ? error.message
      : "Page history request is invalid",
  ),
});

const respond = (context: Context, result: PageHistoryCommandResult) => {
  context.header("Cache-Control", "no-store");
  return context.json(result, pageHistoryHttpStatus(result));
};

const readCursor = (context: Context): PageHistoryCursor | undefined => {
  const source = context.req.query("beforeSource");
  const occurredAt = context.req.query("beforeOccurredAt");
  const versionId = context.req.query("beforeVersionId");
  const changeSeq = context.req.query("beforeChangeSeq");
  const hasAny =
    source !== undefined ||
    occurredAt !== undefined ||
    versionId !== undefined ||
    changeSeq !== undefined;
  if (!hasAny) return undefined;
  if (
    source === "document_version" &&
    occurredAt !== undefined &&
    versionId !== undefined &&
    changeSeq === undefined
  ) {
    return { source, occurredAt, versionId };
  }
  if (
    source === "change_log" &&
    occurredAt !== undefined &&
    changeSeq !== undefined &&
    versionId === undefined
  ) {
    return { source, occurredAt, changeSeq: Number(changeSeq) };
  }
  throw new PageHistoryContractError(
    "Page history cursor query must be complete and source-specific",
  );
};

export const registerPageHistoryHttpRoute = (
  app: Hono,
  dependencies: PageHistoryHttpDependencies,
): void => {
  app.get(
    "/api/projects/:projectId/pages/:pageId/history",
    async (context) => {
      try {
        const pageSize = context.req.query("pageSize");
        const before = readCursor(context);
        const request = parseListPageHistoryRequest({
          version: 1,
          requestingProjectId: context.req.param("projectId").trim(),
          pageId: context.req.param("pageId").trim(),
          ...(pageSize === undefined ? {} : { pageSize: Number(pageSize) }),
          ...(before === undefined ? {} : { before }),
        });
        return respond(
          context,
          await dependencies
            .listHistory(request)
            .catch(pageHistoryTransportFailure),
        );
      } catch (error) {
        return respond(context, invalidResult(error));
      }
    },
  );
};
