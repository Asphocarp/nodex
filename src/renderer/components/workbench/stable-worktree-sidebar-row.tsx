import { WorktreeStatusIcon } from "@/components/shared/icons";
import type { StableWorktreeEntry } from "./stable-worktree-production";

export function StableWorktreeSidebarRows({
  entries,
  onOpen,
}: {
  entries: readonly StableWorktreeEntry[];
  onOpen: (pendingWorktreeId: string) => void;
}) {
  if (entries.length === 0) return null;

  return (
    <div role="list" className="mb-1">
      {entries.map((entry) => (
        <div
          key={`pending-stable-root:${entry.id}`}
          role="listitem"
          className="group/folder-row flex h-[var(--height-token-nav-row)] items-center justify-between overflow-x-hidden rounded-[var(--radius-token-row)] text-sm text-token-foreground electron:opacity-75 hover:bg-token-list-hover-background focus-visible:outline focus-visible:outline-offset-2"
        >
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1 pr-1.5 pl-1 text-left"
            aria-label={entry.label}
            onClick={() => onOpen(entry.id)}
          >
            <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
              <WorktreeStatusIcon className="icon-xs shrink-0" />
            </span>
            <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
              <span className="block w-full min-w-0 overflow-hidden pr-1 whitespace-nowrap text-clip [-webkit-mask-image:linear-gradient(to_right,#000_calc(100%_-_var(--text-fade-truncate-distance,1rem)),transparent)] [mask-image:linear-gradient(to_right,#000_calc(100%_-_var(--text-fade-truncate-distance,1rem)),transparent)]">
                {entry.label}
              </span>
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}
