import type { FileDiffMetadata } from "@pierre/diffs/react";
import { Tooltip } from "../../../../../components/ui/tooltip";
import { cn } from "../../../../../lib/utils";

export interface DiffSummary {
  additions: number;
  deletions: number;
}

export function summarizeFileDiffMetadata(fileDiff: FileDiffMetadata): DiffSummary {
  return fileDiff.hunks.reduce(
    (summary, hunk) => ({
      additions: summary.additions + hunk.additionLines,
      deletions: summary.deletions + hunk.deletionLines,
    }),
    { additions: 0, deletions: 0 },
  );
}

export function normalizeSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}

export function stripPatchPrefix(value: string): string {
  return normalizeSlashes(value).replace(/^([ab])\//, "");
}

export function basename(filePath: string): string {
  const cleaned = stripPatchPrefix(filePath);
  const parts = cleaned.split("/").filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? cleaned;
}

export function normalizePathSegments(value: string): string {
  const isAbsolute = value.startsWith("/");
  const segments = normalizeSlashes(value).split("/");
  const normalized: string[] = [];

  for (const segment of segments) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      if (normalized.length > 0 && normalized[normalized.length - 1] !== "..") {
        normalized.pop();
        continue;
      }
      if (!isAbsolute) normalized.push(segment);
      continue;
    }

    normalized.push(segment);
  }

  if (isAbsolute) return `/${normalized.join("/")}`;
  return normalized.join("/");
}

export function resolveOpenPath(path: string | null, basePath: string | null): string | null {
  if (!path) return null;

  const normalizedPath = normalizePathSegments(stripPatchPrefix(path));
  if (normalizedPath.length === 0) return null;
  if (normalizedPath.startsWith("/")) return normalizedPath;
  if (/^[a-zA-Z]:\//.test(normalizedPath)) return normalizedPath;

  if (!basePath) return null;
  const normalizedBase = normalizePathSegments(basePath);
  if (normalizedBase.length === 0) return null;
  return normalizePathSegments(`${normalizedBase}/${normalizedPath}`);
}

export function summarizeDiff(diffText: string | undefined): DiffSummary {
  if (!diffText) return { additions: 0, deletions: 0 };

  let additions = 0;
  let deletions = 0;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }

  return { additions, deletions };
}

export function DiffStats({
  additions,
  deletions,
  className,
}: DiffSummary & {
  className?: string;
}) {
  if (additions === 0 && deletions === 0) return null;

  return (
    <span
      data-thread-find-skip="true"
      className={cn("inline-flex items-center gap-1 disambiguated-digits tabular-nums tracking-tight", className)}
    >
      <span className="flex-shrink-0 text-token-git-decoration-added-resource-foreground">+{additions}</span>
      <span className="flex-shrink-0 text-token-git-decoration-deleted-resource-foreground">-{deletions}</span>
    </span>
  );
}

export function Chevron({ expanded, className }: { expanded: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-chevron ml-1 text-token-input-placeholder-foreground transition-opacity duration-200 opacity-0 group-hover:opacity-100",
        expanded && "opacity-100",
        className,
      )}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn("icon-2xs text-current transition-transform duration-200", expanded && "rotate-90")}
        aria-hidden="true"
      >
        <path
          d="M7.52925 3.7793C7.75652 3.55203 8.10803 3.52383 8.36616 3.69434L8.47065 3.7793L14.2207 9.5293C14.4804 9.789 14.4804 10.211 14.2207 10.4707L8.47065 16.2207C8.21095 16.4804 7.78895 16.4804 7.52925 16.2207C7.26955 15.961 7.26955 15.539 7.52925 15.2793L12.8085 10L7.52925 4.7207L7.44429 4.61621C7.27378 4.35808 7.30198 4.00657 7.52925 3.7793Z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}

export function FilenameButton({
  displayPath,
  onOpen,
  dataState,
  className,
}: {
  displayPath: string;
  onOpen: (() => void) | null;
  dataState?: "open" | "closed";
  className: string;
}) {
  const button = (
    <button
      type="button"
      className={className}
      onClick={(event) => {
        event.stopPropagation();
        onOpen?.();
      }}
      data-state={dataState}
      disabled={!onOpen}
    >
      {basename(displayPath)}
    </button>
  );

  return (
    <Tooltip
      content={<span className="font-mono">{displayPath}</span>}
      side="top"
      sideOffset={8}
      delayDuration={0}
      contentClassName="rounded-[18px] px-3 py-1.5 text-[13px] font-medium tracking-[-0.01em]"
    >
      {button}
    </Tooltip>
  );
}
