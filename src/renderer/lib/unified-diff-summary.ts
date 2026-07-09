export interface UnifiedDiffChangeSummary {
  additions: number;
  deletions: number;
}

export function summarizeUnifiedDiffChanges(
  diffText: string | null | undefined,
): UnifiedDiffChangeSummary {
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

export function hasUnifiedDiffChanges(diffText: string | null | undefined): boolean {
  const summary = summarizeUnifiedDiffChanges(diffText);
  return summary.additions > 0 || summary.deletions > 0;
}
