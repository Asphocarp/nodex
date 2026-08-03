import type { PageTargetReadModel } from "../../shared/page-targets";
import type { Page } from "../../shared/page";
import type { ContentAccessContext } from "../../shared/content-access-context";

export type PageOutlinerRelationship = "child" | "reference";

export interface PageOutlinerTargetInput {
  readonly relationship: PageOutlinerRelationship;
  readonly targetBlockId: string;
  readonly model: PageTargetReadModel | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly contentAccessContext: ContentAccessContext;
  readonly documentScopeId: string;
  readonly hostPageId: string | null;
  readonly ancestorPageIds: readonly string[];
}

interface PageOutlinerUnavailableTarget {
  readonly relationship: PageOutlinerRelationship;
  readonly targetBlockId: string;
  readonly fallbackTitle: string;
}

export type PageOutlinerTarget =
  | (PageOutlinerUnavailableTarget & { readonly status: "loading" })
  | (PageOutlinerUnavailableTarget & {
      readonly status: "error";
      readonly message: string;
    })
  | (PageOutlinerUnavailableTarget & { readonly status: "missing" })
  | (PageOutlinerUnavailableTarget & { readonly status: "invalid_reference" })
  | (PageOutlinerUnavailableTarget & { readonly status: "deleted" })
  | (PageOutlinerUnavailableTarget & {
      readonly status: "invalid_target";
      readonly actualBlockType: string;
    })
  | {
      readonly status: "available";
      readonly relationship: PageOutlinerRelationship;
      readonly targetBlockId: string;
      readonly contentAccessContext: ContentAccessContext;
      readonly documentScopeId: string;
      readonly page: Page;
      readonly fallbackTitle: string;
      readonly lifecycle: "active" | "archived";
      readonly inlineMode: "editable" | "self" | "cycle" | "archived";
    };

export const resolvePageOutlinerTarget = ({
  relationship,
  targetBlockId: rawTargetBlockId,
  model,
  loading,
  error,
  contentAccessContext,
  documentScopeId,
  hostPageId,
  ancestorPageIds,
}: PageOutlinerTargetInput): PageOutlinerTarget => {
  const targetBlockId = rawTargetBlockId.trim();
  const unavailable = {
    relationship,
    targetBlockId,
  } as const;

  if (targetBlockId.length === 0) {
    return {
      ...unavailable,
      status: "invalid_reference",
      fallbackTitle: "Invalid Page mention",
    };
  }

  if (loading) {
    return {
      ...unavailable,
      status: "loading",
      fallbackTitle: "Loading Page…",
    };
  }
  if (error) {
    return {
      ...unavailable,
      status: "error",
      fallbackTitle: "Page unavailable",
      message: error.message || "Couldn’t load this Page",
    };
  }
  if (!model || model.status === "missing") {
    return {
      ...unavailable,
      status: "missing",
      fallbackTitle: "Page unavailable",
    };
  }
  if (model.status === "deleted") {
    return {
      ...unavailable,
      status: "deleted",
      fallbackTitle: "Deleted Page",
    };
  }
  if (model.status === "invalid_target") {
    return {
      ...unavailable,
      status: "invalid_target",
      fallbackTitle: "Invalid Page mention",
      actualBlockType: model.actualBlockType,
    };
  }

  const referencesSelf = hostPageId === model.page.pageId;
  const closesAncestorCycle = ancestorPageIds.includes(model.page.pageId);
  const inlineMode =
    model.page.lifecycle === "archived"
      ? "archived"
      : referencesSelf
        ? "self"
        : closesAncestorCycle
          ? "cycle"
          : "editable";

  return {
    status: "available",
    relationship,
    targetBlockId: model.page.pageId,
    contentAccessContext,
    documentScopeId,
    page: model.page,
    fallbackTitle: "Untitled",
    lifecycle: model.page.lifecycle,
    inlineMode,
  };
};

export type AvailablePageOutlinerTarget = Extract<
  PageOutlinerTarget,
  { readonly status: "available" }
>;

export const pageOutlinerPlainTitle = (target: PageOutlinerTarget): string => {
  if (target.status !== "available") return target.fallbackTitle;
  return target.page.title.trim() || target.fallbackTitle;
};

export const pageOutlinerInlineStateLabel = (
  target: PageOutlinerTarget,
): string | null => {
  if (target.status === "loading") return "Loading";
  if (target.status === "error") return "Unavailable";
  if (target.status === "missing") return "Missing";
  if (target.status === "invalid_reference") return "Invalid reference";
  if (target.status === "deleted") return "Deleted";
  if (target.status === "invalid_target") return "Invalid target";
  if (target.inlineMode === "archived") return "Archived";
  if (target.inlineMode === "self") return "Self";
  if (target.inlineMode === "cycle") return "Cycle";
  return null;
};
