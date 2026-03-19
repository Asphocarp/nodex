import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, PatchDiff, type FileDiffMetadata } from "@pierre/diffs/react";
import { useMemo } from "react";
import {
  NODEX_DIFF_HOST_CLASS,
  getNodexDiffHostStyle,
  getNodexDiffOptions,
} from "../../../../../lib/diff-presentation";
import { useTheme } from "../../../../../lib/use-theme";
import type { CodexTranscriptEntry } from "../../../../../lib/types";

interface DiffSummary {
  fileCount: number;
  additions: number;
  deletions: number;
}

function extractUnifiedDiff(item: CodexTranscriptEntry): string | undefined {
  const rawItem = item.rawItem;
  if (typeof rawItem === "object" && rawItem !== null) {
    const unifiedDiff = (rawItem as { unifiedDiff?: unknown }).unifiedDiff;
    if (typeof unifiedDiff === "string" && unifiedDiff.trim().length > 0) {
      return unifiedDiff;
    }
  }

  const toolResult = item.toolCall?.result;
  if (typeof toolResult === "object" && toolResult !== null) {
    const diff = (toolResult as { diff?: unknown }).diff;
    if (typeof diff === "string" && diff.trim().length > 0) {
      return diff;
    }
  }

  return undefined;
}

function summarizeDiff(diffText: string | undefined): DiffSummary {
  if (!diffText) return { fileCount: 0, additions: 0, deletions: 0 };

  let fileCount = 0;
  try {
    fileCount = parsePatchFiles(diffText).reduce((count, patch) => count + patch.files.length, 0);
  } catch {
    fileCount = 0;
  }

  const lines = diffText.split("\n");
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }

  return { fileCount, additions, deletions };
}

function parseDiffFiles(diffText: string | undefined): FileDiffMetadata[] {
  if (!diffText) return [];

  try {
    const patches = parsePatchFiles(diffText);
    return patches.flatMap((patch) => patch.files);
  } catch {
    return [];
  }
}

function DiffStats({ additions, deletions }: Pick<DiffSummary, "additions" | "deletions">) {
  if (additions === 0 && deletions === 0) return null;

  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-(--green-text)">+{additions}</span>
      <span className="text-(--red-text)">-{deletions}</span>
    </span>
  );
}

function FileCountLabel({ fileCount }: { fileCount: number }) {
  if (fileCount <= 0) return null;
  return <span>{fileCount} {fileCount === 1 ? "file" : "files"} changed</span>;
}

export function TurnDiffToolCall({ item }: {
  item: CodexTranscriptEntry;
  projectWorkspacePath?: string;
  threadCwd?: string;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const diffText = extractUnifiedDiff(item);
  const { resolved } = useTheme();
  const summary = useMemo(() => summarizeDiff(diffText), [diffText]);
  const fileDiffs = useMemo(() => parseDiffFiles(diffText), [diffText]);
  const isSingleFile = fileDiffs.length <= 1;
  const diffOptions = useMemo(() => getNodexDiffOptions(resolved, isSingleFile), [resolved, isSingleFile]);
  const diffHostStyle = useMemo(() => getNodexDiffHostStyle(resolved), [resolved]);
  const diffHostClassName = `${NODEX_DIFF_HOST_CLASS} max-h-[320px] overflow-y-auto`;

  if (!diffText || (summary.fileCount === 0 && summary.additions === 0 && summary.deletions === 0)) {
    return null;
  }

  if (item.status === "inProgress") {
    return (
      <div className="rounded-xl border border-(--border) bg-(--background-secondary) px-3 py-2 text-size-chat text-(--foreground-secondary)">
        <div className="flex items-center gap-3">
          <FileCountLabel fileCount={summary.fileCount} />
          <DiffStats additions={summary.additions} deletions={summary.deletions} />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-(--border) bg-(--background-secondary) p-3">
      <div className="mb-3 flex items-center gap-3 text-size-chat text-(--foreground-secondary)">
        <FileCountLabel fileCount={summary.fileCount} />
        <DiffStats additions={summary.additions} deletions={summary.deletions} />
      </div>
      <div className="overflow-hidden rounded-lg border border-token-input-background bg-token-text-code-block-background">
        <div className={diffHostClassName} style={diffHostStyle}>
          {fileDiffs.map((fileDiff, index) => {
            const key = `${fileDiff.name}:${index}`;
            return isSingleFile ? (
              <PatchDiff
                key={key}
                patch={diffText}
                className={diffHostClassName}
                style={diffHostStyle}
                options={diffOptions}
              />
            ) : (
              <FileDiff
                key={key}
                fileDiff={fileDiff}
                className={diffHostClassName}
                style={diffHostStyle}
                options={diffOptions}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
