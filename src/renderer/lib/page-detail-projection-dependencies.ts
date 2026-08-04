import type { LibraryPageDetail, PageDetail } from "../../shared/page-detail";
import type { ProjectionDependencies } from "./projection-invalidation-registry";

type AnyPageDetail = PageDetail | LibraryPageDetail;

export const pageDetailDataDependencies = (
  detail: AnyPageDetail | null,
  pageId: string,
): ProjectionDependencies => {
  if (!detail || detail.dataSourceContext.kind !== "member") {
    return { pageIds: [pageId] };
  }
  return {
    pageIds: [pageId],
    databaseIds: [detail.dataSourceContext.database.databaseId],
    dataSourceIds: [detail.dataSourceContext.dataSource.dataSourceId],
  };
};

export const pageDetailDocumentDependencies = (
  detail: AnyPageDetail | null,
  pageId: string,
): ProjectionDependencies => ({
  pageIds: [pageId],
  documentIds: detail ? [detail.page.documentId] : [],
});
