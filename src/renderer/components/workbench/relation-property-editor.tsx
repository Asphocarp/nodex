import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

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

const record = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;

export const readRelationValuePreview = (
  input: unknown,
): RelationValuePreview | null => {
  const tagged = record(input);
  const value = tagged?.kind === "relation" ? record(tagged.value) : null;
  if (!value || !Array.isArray(value.targets)) return null;
  const targets = value.targets.flatMap((rawTarget): RelationTargetPreview[] => {
    const target = record(rawTarget);
    if (target?.kind === "restricted") return [{ kind: "restricted" }];
    if (
      target?.kind === "visible"
      && typeof target.page_id === "string"
      && typeof target.title === "string"
      && typeof target.lifecycle === "string"
      && typeof target.membership_state === "string"
    ) {
      return [{
        kind: "visible",
        pageId: target.page_id,
        title: target.title,
        lifecycle: target.lifecycle,
        membershipState: target.membership_state,
      }];
    }
    return [];
  });
  if (
    typeof value.value_revision !== "number"
    || typeof value.total_count !== "number"
    || typeof value.restricted_count !== "number"
    || typeof value.has_more !== "boolean"
  ) return null;
  return {
    valueRevision: value.value_revision,
    totalCount: value.total_count,
    targets,
    restrictedCount: value.restricted_count,
    hasMore: value.has_more,
  };
};

export function RelationPropertyEditor({
  label,
  value,
  candidates,
  disabled,
  targetMatchesCurrentSource,
  onPatch,
  onClear,
  onLoadMore,
  onSearchCandidates,
}: {
  readonly label: string;
  readonly value: unknown;
  readonly candidates: readonly { readonly pageId: string; readonly title: string }[];
  readonly disabled: boolean;
  readonly targetMatchesCurrentSource: boolean;
  readonly onPatch: (delta: {
    readonly addPageIds: readonly string[];
    readonly removePageIds: readonly string[];
  }) => void;
  readonly onClear: () => void;
  readonly onLoadMore?: (after: string | null) => Promise<{
    readonly targets: readonly RelationTargetPreview[];
    readonly nextCursor: string | null;
  }>;
  readonly onSearchCandidates?: (query: string) => Promise<readonly {
    readonly pageId: string;
    readonly title: string;
  }[]>;
}) {
  const preview = readRelationValuePreview(value) ?? {
    valueRevision: 0,
    totalCount: 0,
    targets: [],
    restrictedCount: 0,
    hasMore: false,
  };
  const [candidateId, setCandidateId] = useState("");
  const [expandedTargets, setExpandedTargets] = useState<readonly RelationTargetPreview[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [remoteCandidates, setRemoteCandidates] = useState<readonly {
    readonly pageId: string;
    readonly title: string;
  }[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const searchGeneration = useRef(0);
  useEffect(() => {
    loadGeneration.current += 1;
    searchGeneration.current += 1;
    setCandidateId("");
    setExpandedTargets(null);
    setNextCursor(null);
    setRemoteCandidates([]);
    setLoading(false);
    setSearching(false);
    setError(null);
  }, [label, preview.valueRevision]);
  const presentedTargets = expandedTargets ?? preview.targets;
  const selected = new Set(
    presentedTargets.flatMap((target) => target.kind === "visible" ? [target.pageId] : []),
  );
  const candidatePool = [
    ...(targetMatchesCurrentSource ? candidates : []),
    ...remoteCandidates,
  ].filter((candidate, index, all) =>
    all.findIndex((entry) => entry.pageId === candidate.pageId) === index
  );
  const available = candidatePool.filter((candidate) => !selected.has(candidate.pageId));
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1" aria-label={`${label} relation`}>
      <span className="shrink-0 text-[11px] text-token-description-foreground">{label}</span>
      {presentedTargets.map((target) => target.kind === "restricted" ? null : (
        <button
          key={target.pageId}
          type="button"
          disabled={disabled}
          title={`${target.title} · ${target.membershipState}`}
          onClick={() => onPatch({ addPageIds: [], removePageIds: [target.pageId] })}
          className={cn(
            "max-w-36 truncate rounded bg-(--accent-blue)/10 px-1.5 py-0.5 text-[11px] text-(--accent-blue)",
            "disabled:opacity-60",
          )}
        >
          {target.title || "Untitled"} ×
        </button>
      ))}
      {preview.restrictedCount > 0 ? (
        <span className="rounded bg-token-foreground/5 px-1.5 py-0.5 text-[11px] text-token-description-foreground">
          {preview.restrictedCount} restricted
        </span>
      ) : null}
      {(expandedTargets === null ? preview.hasMore : nextCursor !== null) && onLoadMore ? (
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => {
            const generation = ++loadGeneration.current;
            setLoading(true);
            setError(null);
            void onLoadMore(expandedTargets === null ? null : nextCursor)
              .then((page) => {
                if (generation !== loadGeneration.current) return;
                setExpandedTargets((current) => {
                  const combined = [...(current ?? []), ...page.targets];
                  const seen = new Set<string>();
                  return combined.filter((target) => {
                    if (target.kind === "restricted") return true;
                    if (seen.has(target.pageId)) return false;
                    seen.add(target.pageId);
                    return true;
                  });
                });
                setNextCursor(page.nextCursor);
              })
              .catch((cause: unknown) => {
                if (generation !== loadGeneration.current) return;
                setError(cause instanceof Error ? cause.message : "Unable to load relations");
              })
              .finally(() => {
                if (generation === loadGeneration.current) setLoading(false);
              });
          }}
          className="rounded px-1 text-[11px] text-token-text-secondary hover:bg-token-foreground/5 disabled:opacity-50"
        >
          {loading ? "Loading…" : expandedTargets === null
            ? `+${Math.max(0, preview.totalCount - preview.targets.length)} more`
            : "More…"}
        </button>
      ) : preview.hasMore ? (
        <span className="text-[11px] text-token-description-foreground">
          +{Math.max(0, preview.totalCount - preview.targets.length)}
        </span>
      ) : null}
      {available.length > 0 ? (
        <select
          aria-label={`Add ${label} relation`}
          value={candidateId}
          disabled={disabled || available.length === 0}
          onChange={(event) => {
            const pageId = event.target.value;
            setCandidateId("");
            if (pageId) onPatch({ addPageIds: [pageId], removePageIds: [] });
          }}
          className="h-6 max-w-32 rounded border border-transparent bg-token-foreground/5 px-1 text-[11px] text-token-text-secondary outline-none focus:border-token-focus-border"
        >
          <option value="">Add page…</option>
          {available.map((candidate) => (
            <option key={candidate.pageId} value={candidate.pageId}>
              {candidate.title || "Untitled"}
            </option>
          ))}
        </select>
      ) : null}
      {onSearchCandidates ? (
        <span className="inline-flex items-center gap-1">
          <input
            aria-label={`Search ${label} target pages`}
            value={query}
            disabled={disabled || searching}
            onChange={(event) => setQuery(event.target.value)}
            className="h-6 w-24 rounded border border-transparent bg-token-foreground/5 px-1 text-[11px] outline-none focus:border-token-focus-border"
            placeholder="Search pages"
          />
          <button
            type="button"
            disabled={disabled || searching}
            onClick={() => {
              const generation = ++searchGeneration.current;
              setSearching(true);
              setError(null);
              void onSearchCandidates(query)
                .then((nextCandidates) => {
                  if (generation === searchGeneration.current) {
                    setRemoteCandidates(nextCandidates);
                  }
                })
                .catch((cause: unknown) => {
                  if (generation !== searchGeneration.current) return;
                  setError(cause instanceof Error ? cause.message : "Unable to search pages");
                })
                .finally(() => {
                  if (generation === searchGeneration.current) setSearching(false);
                });
            }}
            className="rounded px-1 text-[11px] text-token-text-secondary hover:bg-token-foreground/5 disabled:opacity-50"
          >
            {searching ? "…" : "Find"}
          </button>
        </span>
      ) : available.length === 0 ? (
        <span className="text-[11px] text-token-description-foreground">Target unavailable</span>
      ) : null}
      {preview.totalCount > 0 ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            const warning = preview.restrictedCount > 0 || preview.hasMore
              ? `Clear all ${preview.totalCount} ${label} relations, including targets not shown here?`
              : `Clear all ${preview.totalCount} ${label} relations?`;
            if (window.confirm(warning)) onClear();
          }}
          className="rounded px-1 text-[11px] text-token-description-foreground hover:bg-token-foreground/5 disabled:opacity-50"
        >
          Clear all
        </button>
      ) : null}
      {error ? (
        <span role="status" className="text-[11px] text-token-error-foreground">
          {error}
        </span>
      ) : null}
    </div>
  );
}
