import type { PageTargetReadModel } from "../../shared/page-targets";

export interface PageStageBreadcrumbNavigationTarget {
  readonly pageId: string;
  readonly title: string;
}

export interface PageStageBreadcrumbTarget {
  readonly title: string;
  readonly navigationTarget: PageStageBreadcrumbNavigationTarget | null;
}

export interface PageStageBreadcrumbTargetInput {
  readonly targetBlockId: string;
  readonly model: PageTargetReadModel | null;
  readonly loading: boolean;
  readonly error: Error | null;
}

/**
 * Derive breadcrumb chrome from the membership-independent Page target model.
 * The navigation path owns Page identity only. The caller retains the current
 * requesting Project as the authorization context.
 */
export function resolvePageStageBreadcrumbTarget({
  targetBlockId,
  model,
  loading,
  error,
}: PageStageBreadcrumbTargetInput): PageStageBreadcrumbTarget {
  if (loading) {
    return { title: "Loading Page…", navigationTarget: null };
  }
  if (error || !model || model.status === "missing") {
    return { title: "Page unavailable", navigationTarget: null };
  }
  if (model.status === "deleted") {
    return { title: "Deleted Page", navigationTarget: null };
  }
  if (model.status === "invalid_target") {
    return { title: "Invalid Page", navigationTarget: null };
  }

  const title = model.page.title.trim() || "Untitled";
  return {
    title,
    navigationTarget: {
      pageId: model.page.pageId || targetBlockId,
      title,
    },
  };
}
