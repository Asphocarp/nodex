export type RelationTargetPreview =
  | {
      readonly kind: "visible";
      readonly pageId: string;
      readonly title: string;
      readonly lifecycle: string;
      readonly membershipState: string;
    }
  | { readonly kind: "restricted" };

export interface RelationValuePreview {
  readonly valueRevision: number;
  readonly totalCount: number;
  readonly targets: readonly RelationTargetPreview[];
  readonly restrictedCount: number;
  readonly hasMore: boolean;
}

export interface RelationTargetWindow {
  readonly valueRevision: number;
  readonly totalCount: number;
  readonly targets: readonly RelationTargetPreview[];
  readonly nextCursor: string | null;
  readonly projectionRevision: number;
}

export interface RelationCandidateWindow {
  readonly candidates: readonly { readonly pageId: string; readonly title: string }[];
  readonly nextCursor: string | null;
  readonly projectionRevision: number;
}

const record = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;

const nonnegativeSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const readTarget = (input: unknown): RelationTargetPreview | null => {
  const target = record(input);
  if (!target) return null;
  if (
    target.kind !== "visible"
    || typeof target.page_id !== "string"
    || target.page_id.length === 0
    || typeof target.title !== "string"
    || typeof target.lifecycle !== "string"
    || typeof target.membership_state !== "string"
  ) return null;
  return {
    kind: "visible",
    pageId: target.page_id,
    title: target.title,
    lifecycle: target.lifecycle,
    membershipState: target.membership_state,
  };
};

export const readRelationValuePreview = (
  input: unknown,
): RelationValuePreview | null => {
  const tagged = record(input);
  const value = tagged?.kind === "relation" ? record(tagged.value) : null;
  if (
    !value
    || !Array.isArray(value.targets)
    || !nonnegativeSafeInteger(value.value_revision)
    || !nonnegativeSafeInteger(value.total_count)
    || !nonnegativeSafeInteger(value.restricted_count)
    || typeof value.has_more !== "boolean"
  ) return null;
  const targets = value.targets.map(readTarget);
  const visibleIds = new Set(
    targets.flatMap((target) => target?.kind === "visible" ? [target.pageId] : []),
  );
  if (
    targets.some((target) => target === null)
    || targets.length > 3
    || visibleIds.size !== targets.length
    || value.total_count < value.restricted_count + targets.length
    || value.has_more !== (value.total_count > targets.length)
  ) return null;
  return {
    valueRevision: value.value_revision,
    totalCount: value.total_count,
    targets: targets as readonly RelationTargetPreview[],
    restrictedCount: value.restricted_count,
    hasMore: value.has_more,
  };
};
