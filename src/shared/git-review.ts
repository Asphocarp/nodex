export type GitStatusSummaryFailureReason =
  | "canceled"
  | "not-a-repository"
  | "status-config"
  | "status-command"
  | "untracked-paths"
  | "timed-out";

export interface GitStatusSummaryRequest {
  cwd: string;
  includeUntrackedFiles?: boolean;
}

export type GitStatusSummaryResult =
  | {
      type: "success";
      stagedCount: number;
      unstagedCount: number;
      untrackedCount: number | null;
      snapshotGeneration: number;
    }
  | {
      type: "error";
      failureReason: GitStatusSummaryFailureReason;
      errorMessage: string | null;
    };

export type {
  BranchDiffStatsRequest,
  BranchDiffStatsResult,
  GitMergeBaseRequest,
  GitMergeBaseResult,
  GitReviewBaseBranchRequest,
  GitReviewBaseBranchResult,
  GitReviewBlameInput,
  GitReviewBlameResult,
  GitReviewBranchCommitsRequest,
  GitReviewBranchCommitsResult,
  GitReviewCatFileInput,
  GitReviewCatFileOutput,
  GitReviewPatchRequest,
  GitReviewPatchResult,
  GitReviewRepositoryMetadataRequest,
  GitReviewRepositoryMetadataResult,
  GitReviewSearchInput,
  GitReviewSearchResult,
  GitReviewSource,
  GitReviewSummaryRequest,
  GitReviewSummaryResult,
  ReviewDiffRequest,
  ReviewDiffResult,
} from "./types";

export interface GitReviewStaleSnapshotResult {
  type: "stale-snapshot";
  source?: import("./types").GitReviewSource;
}

export type GitWorkerSnapshotResult<Result> = Result | GitReviewStaleSnapshotResult;

export type GitWorkerReviewSummaryResult = GitWorkerSnapshotResult<
  import("./types").GitReviewSummaryResult
>;

export type GitWorkerCatFileResult =
  | {
      type: "success";
      value: import("./types").GitReviewCatFileOutput;
    }
  | GitReviewStaleSnapshotResult;

export type GitWorkerBranchMutationResult =
  | {
      type: "success";
      value: import("./types").GitBranchMetadataResult;
    }
  | {
      type: "error";
      errorMessage: string;
    };

export interface GitRefreshRepositoryRequest {
  cwd: string;
}

export type GitRefreshRepositoryResult =
  | {
      type: "success";
      generation: number;
    }
  | {
      type: "error";
      failureReason: "not-a-repository";
    };
