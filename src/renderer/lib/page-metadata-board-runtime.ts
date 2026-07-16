import { toDatabasePageSummary } from "../../shared/page-summary";
import type {
  DatabasePage,
  PageInput,
  PageUpdateField,
  PageUpdateResult,
} from "./types";
import { invoke } from "./api";
import {
  commitPageDetailMetadataPatch,
  isPageMetadataPatch,
} from "./page-detail-metadata-runtime";
import type { PageStageMetadataMutationResult } from "./page-stage-page";

export interface PageMetadataBoardRuntimeDependencies {
  readonly commit: (input: {
    readonly projectId: string;
    readonly pageId: string;
    readonly operationId: string;
    readonly clientSessionId?: string;
    readonly patch: Partial<PageInput>;
  }) => Promise<PageStageMetadataMutationResult>;
  readonly readBoardProjection: (
    projectId: string,
    pageId: string,
  ) => Promise<DatabasePage | null>;
}

const DEFAULT_DEPENDENCIES: PageMetadataBoardRuntimeDependencies = {
  commit: commitPageDetailMetadataPatch,
  readBoardProjection: async (projectId, pageId) =>
    (await invoke("database-row:get", projectId, pageId)) as DatabasePage | null,
};

const readScopedBoardProjection = async (
  projectId: string,
  pageId: string,
  dependencies: PageMetadataBoardRuntimeDependencies,
): Promise<DatabasePage | null> => {
  const card = await dependencies.readBoardProjection(projectId, pageId);
  if (!card || card.id === pageId) return card;
  throw new Error(
    `Board projection returned Page ${card.id} for requested Page ${pageId}`,
  );
};

const changedFields = (
  patch: Partial<PageInput>,
  didMutate: boolean,
): readonly PageUpdateField[] =>
  didMutate ? Object.keys(patch) as PageUpdateField[] : [];

/**
 * Adapts the canonical Page metadata command to the legacy Board result shape.
 * It owns no metadata authority; the post-write Page read is only a visual
 * projection used by the current single-Source Board.
 */
export const commitPageMetadataPatchForBoard = async (input: {
  readonly projectId: string;
  readonly pageId: string;
  readonly operationId: string;
  readonly clientSessionId?: string;
  readonly patch: Partial<PageInput>;
  readonly dependencies?: PageMetadataBoardRuntimeDependencies;
}): Promise<PageUpdateResult> => {
  if (!isPageMetadataPatch(input.patch)) {
    throw new TypeError("Page metadata patch contains unsupported fields");
  }
  const dependencies = input.dependencies ?? DEFAULT_DEPENDENCIES;
  const result = await dependencies.commit({
    projectId: input.projectId,
    pageId: input.pageId,
    operationId: input.operationId,
    ...(input.clientSessionId
      ? { clientSessionId: input.clientSessionId }
      : {}),
    patch: input.patch,
  });
  if (result.status === "not_found") return result;
  if (result.status === "error") throw new Error(result.error);

  const page = await readScopedBoardProjection(
    input.projectId,
    input.pageId,
    dependencies,
  );
  if (!page) return { status: "not_found" };
  if (result.status === "conflict") return { status: "conflict", page };
  return {
    status: "updated",
    projectId: input.projectId,
    pageId: input.pageId,
    revision: page.revision ?? 0,
    summary: toDatabasePageSummary(page),
    changedFields: [...changedFields(input.patch, result.didMutate)],
    didMutate: result.didMutate,
  };
};
