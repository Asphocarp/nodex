export const DOCUMENT_REVISION_KEEP_ALL_MS = 7 * 24 * 60 * 60_000;
export const DOCUMENT_REVISION_KEEP_HOURLY_MS = 30 * 24 * 60 * 60_000;
export const DOCUMENT_REVISION_KEEP_DAILY_MS = 90 * 24 * 60 * 60_000;
export const MAX_UNPINNED_DOCUMENT_REVISIONS = 500;

export interface DocumentRevisionRetentionCandidate {
  readonly versionId: string;
  readonly createdAt: string;
  readonly pinned: boolean;
}

export interface DocumentRevisionRetentionPlan {
  readonly retainedVersionIds: readonly string[];
  readonly deletedVersionIds: readonly string[];
}

const timestampMs = (value: string, field: string): number => {
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed) && new Date(parsed).toISOString() === value) {
    return parsed;
  }
  throw new TypeError(`${field} must be a canonical ISO timestamp`);
};

export const planDocumentRevisionRetention = (
  candidates: readonly DocumentRevisionRetentionCandidate[],
  now: string,
): DocumentRevisionRetentionPlan => {
  const nowMs = timestampMs(now, "now");
  const ordered = [...candidates].sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      right.versionId.localeCompare(left.versionId),
  );
  const pinned = ordered.filter((candidate) => candidate.pinned);
  const selectedUnpinned: DocumentRevisionRetentionCandidate[] = [];
  const hourlyBuckets = new Set<string>();
  const dailyBuckets = new Set<string>();
  for (const candidate of ordered) {
    timestampMs(candidate.createdAt, `revision ${candidate.versionId}`);
    if (candidate.pinned) continue;
    const age = Math.max(0, nowMs - Date.parse(candidate.createdAt));
    if (age < DOCUMENT_REVISION_KEEP_ALL_MS) {
      selectedUnpinned.push(candidate);
      continue;
    }
    if (age < DOCUMENT_REVISION_KEEP_HOURLY_MS) {
      const bucket = candidate.createdAt.slice(0, 13);
      if (hourlyBuckets.has(bucket)) continue;
      hourlyBuckets.add(bucket);
      selectedUnpinned.push(candidate);
      continue;
    }
    if (age < DOCUMENT_REVISION_KEEP_DAILY_MS) {
      const bucket = candidate.createdAt.slice(0, 10);
      if (dailyBuckets.has(bucket)) continue;
      dailyBuckets.add(bucket);
      selectedUnpinned.push(candidate);
    }
  }
  const retainedUnpinned = selectedUnpinned.slice(
    0,
    MAX_UNPINNED_DOCUMENT_REVISIONS,
  );
  const retained = new Set([
    ...pinned.map((candidate) => candidate.versionId),
    ...retainedUnpinned.map((candidate) => candidate.versionId),
  ]);
  return {
    retainedVersionIds: ordered
      .filter((candidate) => retained.has(candidate.versionId))
      .map((candidate) => candidate.versionId),
    deletedVersionIds: ordered
      .filter((candidate) => !retained.has(candidate.versionId))
      .map((candidate) => candidate.versionId),
  };
};

