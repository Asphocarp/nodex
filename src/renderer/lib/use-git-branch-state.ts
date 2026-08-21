import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  createGitLiveWorkerQuery,
  createGitWorkerQuery,
  getGitLiveQueryCoordinator,
  type GitQueryRepositoryIdentity,
} from "@/features/review/data/git-query";

interface UseGitBranchStateOptions {
  enabled?: boolean;
  watch?: boolean;
}

export function useGitBranchState(
  cwd: string | null | undefined,
  options: UseGitBranchStateOptions = {},
) {
  const queryClient = useQueryClient();
  const normalizedCwd = cwd?.trim() ?? "";
  const enabled = options.enabled !== false && normalizedCwd.length > 0;
  const metadata = useQuery({
    ...(options.watch === true
      ? createGitLiveWorkerQuery({
          method: "stable-metadata",
          params: { cwd: normalizedCwd },
        })
      : createGitWorkerQuery({
          method: "stable-metadata",
          params: { cwd: normalizedCwd },
        })),
    enabled,
  });
  const repository = useMemo<GitQueryRepositoryIdentity | null>(() => {
    if (!metadata.data?.isGitRepository || !metadata.data.commonDir || !metadata.data.root)
      return null;
    return {
      hostId: "local",
      commonDir: metadata.data.commonDir,
      root: metadata.data.root,
    };
  }, [metadata.data]);
  const branchInput = useMemo(
    () => ({
      method: "branch-metadata" as const,
      params: { cwd: repository?.root ?? normalizedCwd },
      repository,
    }),
    [normalizedCwd, repository],
  );
  const branchOptions =
    options.watch === true
      ? createGitLiveWorkerQuery(branchInput)
      : createGitWorkerQuery(branchInput);
  const branch = useQuery({
    ...branchOptions,
    enabled: enabled && repository !== null,
  });
  getGitLiveQueryCoordinator(queryClient);
  return branch;
}
