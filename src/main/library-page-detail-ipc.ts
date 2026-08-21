import type { LibraryPageDetailResult } from "../shared/page-detail";

export const LIBRARY_PAGE_DETAIL_IPC_CHANNEL = "library-pages:detail:get" as const;

export interface LibraryPageDetailIpcDependencies {
  readonly registerHandle: (
    channel: typeof LIBRARY_PAGE_DETAIL_IPC_CHANNEL,
    listener: (
      event: unknown,
      pageId: string,
      minimumCommitSeq?: number,
    ) => Promise<LibraryPageDetailResult>,
  ) => void;
  readonly isTrustedEvent: (event: unknown) => boolean;
  readonly read: (pageId: string, minimumCommitSeq?: number) => Promise<LibraryPageDetailResult>;
}

export const registerLibraryPageDetailIpcHandler = (
  dependencies: LibraryPageDetailIpcDependencies,
): void => {
  dependencies.registerHandle(
    LIBRARY_PAGE_DETAIL_IPC_CHANNEL,
    async (event, pageId, minimumCommitSeq) => {
      if (!dependencies.isTrustedEvent(event)) {
        return {
          ok: false,
          error: {
            code: "authorization_denied",
            message: "Library Page Detail is restricted to a trusted application window",
            retryable: false,
          },
        };
      }
      try {
        return await dependencies.read(pageId, minimumCommitSeq);
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "unknown",
            message: error instanceof Error ? error.message : "Library Page Detail is unavailable",
            retryable: true,
          },
        };
      }
    },
  );
};
