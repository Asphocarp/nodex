import type { PageDetailResult } from "../shared/page-detail";

export const PAGE_DETAIL_IPC_CHANNEL = "pages:detail:get" as const;

export interface PageDetailIpcDependencies {
  readonly registerHandle: (
    channel: typeof PAGE_DETAIL_IPC_CHANNEL,
    listener: (
      event: unknown,
      projectId: string,
      pageId: string,
      minimumCommitSeq?: number,
    ) => Promise<PageDetailResult>,
  ) => void;
  readonly isTrustedEvent: (event: unknown) => boolean;
  readonly read: (
    projectId: string,
    pageId: string,
    minimumCommitSeq?: number,
  ) => Promise<PageDetailResult>;
}

export const registerPageDetailIpcHandler = (
  dependencies: PageDetailIpcDependencies,
): void => {
  dependencies.registerHandle(
    PAGE_DETAIL_IPC_CHANNEL,
    async (event, projectId, pageId, minimumCommitSeq) => {
      if (!dependencies.isTrustedEvent(event)) {
        return {
          ok: false,
          error: {
            code: "authorization_denied",
            message: "Page Detail is restricted to a trusted application window",
            retryable: false,
          },
        };
      }
      try {
        return await dependencies.read(projectId, pageId, minimumCommitSeq);
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "unknown",
            message: error instanceof Error ? error.message : "Page Detail is unavailable",
            retryable: true,
          },
        };
      }
    },
  );
};
