import { Archive, Database, FileText, Library, Plus, Search } from "lucide-react";
import { useDeferredValue, useMemo, useState, type ReactNode } from "react";

import type {
  LibraryCatalogEntry,
  LibraryRouteTarget,
} from "../../../shared/library-module";
import { useInfiniteLibraryCatalog } from "../../lib/use-library-navigation";
import { cn } from "../../lib/utils";
import { LibraryNewMenu } from "./library-new-menu";
import { NodexButton } from "../ui/button";
import {
  LibraryResourceActions,
  type LibraryProjectOption,
  type LibraryResourceTarget,
} from "./library-resource-actions";

export type LibraryKindFilter = "all" | "page" | "database";
export type LibraryLifecycleFilter = "active" | "archived";

export function LibraryHomeView({
  query,
  kind,
  lifecycle,
  items,
  loading = false,
  error = null,
  hasMore = false,
  onQueryChange,
  onKindChange,
  onLifecycleChange,
  onOpen,
  onLoadMore,
  onRetry,
  newAction,
  projects = [],
  onOpenInProject,
  mutationsEnabled = false,
}: {
  query: string;
  kind: LibraryKindFilter;
  lifecycle: LibraryLifecycleFilter;
  items: readonly LibraryCatalogEntry[];
  loading?: boolean;
  error?: string | null;
  hasMore?: boolean;
  onQueryChange: (value: string) => void;
  onKindChange: (value: LibraryKindFilter) => void;
  onLifecycleChange: (value: LibraryLifecycleFilter) => void;
  onOpen: (target: LibraryRouteTarget) => void;
  onLoadMore?: () => void;
  onRetry?: () => void;
  newAction?: ReactNode;
  projects?: readonly LibraryProjectOption[];
  onOpenInProject?: (
    projectId: string,
    target: LibraryResourceTarget,
    title: string,
  ) => void | Promise<void>;
  mutationsEnabled?: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-token-main-surface-primary">
      <div className="shrink-0 px-8 pt-8 pb-5">
        <div className="mx-auto flex w-full max-w-5xl items-end justify-between gap-6">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-token-text-secondary">
              <Library className="icon-sm" aria-hidden />
              <span className="text-xs font-medium tracking-wide uppercase">Your content</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-token-text-primary">
              Library
            </h1>
            <p className="mt-1 max-w-xl text-sm text-token-description-foreground">
              Pages and Databases stay here independently of Project lifecycle.
            </p>
          </div>
          {newAction}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-8 pb-10">
        <div className="mx-auto w-full max-w-5xl">
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-token-main-surface-primary py-3">
            <label className="flex h-9 min-w-64 flex-1 items-center gap-2 rounded-lg bg-token-bg-secondary px-3 text-token-text-secondary focus-within:ring-2 focus-within:ring-token-border">
              <Search className="icon-sm shrink-0" aria-hidden />
              <span className="sr-only">Search Library</span>
              <input
                type="search"
                value={query}
                placeholder="Search Pages and Databases"
                className="min-w-0 flex-1 bg-transparent text-sm text-token-text-primary outline-none placeholder:text-token-input-placeholder-foreground"
                onChange={(event) => onQueryChange(event.target.value)}
              />
            </label>
            <select
              aria-label="Content type"
              value={kind}
              className="h-9 rounded-lg bg-token-bg-secondary px-3 text-sm text-token-text-primary outline-none focus:ring-2 focus:ring-token-border"
              onChange={(event) => onKindChange(event.target.value as LibraryKindFilter)}
            >
              <option value="all">All types</option>
              <option value="page">Pages</option>
              <option value="database">Databases</option>
            </select>
            <select
              aria-label="Lifecycle"
              value={lifecycle}
              className="h-9 rounded-lg bg-token-bg-secondary px-3 text-sm text-token-text-primary outline-none focus:ring-2 focus:ring-token-border"
              onChange={(event) => onLifecycleChange(event.target.value as LibraryLifecycleFilter)}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </div>

          <div className="mt-2 border-y border-token-border/70">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(9rem,0.45fr)_8rem_2rem] gap-4 border-b border-token-border/70 px-3 py-2 text-xs font-medium text-token-text-secondary">
              <span>Name</span>
              <span>Location</span>
              <span className="text-right">Updated</span>
              <span className="sr-only">Actions</span>
            </div>
            {loading ? (
              <div className="px-3 py-10 text-center text-sm text-token-description-foreground">
                Loading Library…
              </div>
            ) : error ? (
              <div className="flex items-center justify-center gap-3 px-3 py-10 text-sm text-token-description-foreground">
                <span>{error}</span>
                {onRetry ? (
                  <button
                    type="button"
                    className="text-token-text-primary underline underline-offset-4"
                    onClick={onRetry}
                  >
                    Retry
                  </button>
                ) : null}
              </div>
            ) : items.length === 0 ? (
              <div className="px-3 py-12 text-center text-sm text-token-description-foreground">
                {lifecycle === "archived" ? (
                  <><Archive className="mx-auto mb-3 icon-lg opacity-60" />No archived content</>
                ) : "No matching Pages or Databases"}
              </div>
            ) : items.map((item) => (
              <div
                key={item.target.kind === "page"
                  ? `page:${item.target.pageId}`
                  : `database:${item.target.databaseId}`}
                className={cn(
                  "group grid h-11 w-full grid-cols-[minmax(0,1fr)_minmax(9rem,0.45fr)_8rem_2rem] items-center gap-4 px-3 text-left text-sm",
                  "hover:bg-token-list-hover-background",
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-2 text-token-text-primary focus-visible:outline focus-visible:outline-2"
                  onClick={() => onOpen(item.target)}
                >
                  {item.kind === "page"
                    ? <FileText className="icon-sm shrink-0 text-token-text-secondary" />
                    : <Database className="icon-sm shrink-0 text-token-text-secondary" />}
                  <span className="truncate">{item.title || "Untitled"}</span>
                </button>
                <span className="truncate text-token-description-foreground">
                  {item.locationLabel}
                </span>
                <time className="text-right text-xs text-token-description-foreground" dateTime={item.updatedAt}>
                  {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(item.updatedAt))}
                </time>
                {mutationsEnabled ? (
                <span className="opacity-0 focus-within:opacity-100 group-hover:opacity-100">
                  <LibraryResourceActions
                    target={item.target}
                    title={item.title || "Untitled"}
                    expectedLocationRevision={item.locationRevision}
                    expectedMetadataRevision={item.metadataRevision}
                    lifecycle={item.lifecycle}
                    projects={projects}
                    onOpenInProject={onOpenInProject}
                  />
                </span>
                ) : null}
              </div>
            ))}
          </div>
          {hasMore && onLoadMore ? (
            <button
              type="button"
              className="mt-3 h-9 rounded-lg px-3 text-sm text-token-text-secondary hover:bg-token-list-hover-background hover:text-token-text-primary"
              onClick={onLoadMore}
            >
              Load more
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function LibraryHome({
  onOpen,
  projects = [],
  onOpenInProject,
}: {
  onOpen: (target: LibraryRouteTarget) => void;
  projects?: readonly LibraryProjectOption[];
  onOpenInProject?: (
    projectId: string,
    target: LibraryResourceTarget,
    title: string,
  ) => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [kind, setKind] = useState<LibraryKindFilter>("all");
  const [lifecycle, setLifecycle] = useState<LibraryLifecycleFilter>("active");
  const catalog = useInfiniteLibraryCatalog({
    ...(deferredQuery ? { query: deferredQuery } : {}),
    ...(kind === "all" ? {} : { kinds: [kind] }),
    lifecycle,
    limit: 50,
  });
  const items = useMemo(
    () => catalog.data?.pages.flatMap((page) => page.items) ?? [],
    [catalog.data],
  );
  return (
      <LibraryHomeView
        query={query}
        kind={kind}
        lifecycle={lifecycle}
        items={items}
        loading={catalog.isPending}
        error={catalog.error instanceof Error ? catalog.error.message : null}
        hasMore={catalog.hasNextPage}
        onQueryChange={(value) => {
          setQuery(value);
        }}
        onKindChange={(value) => {
          setKind(value);
        }}
        onLifecycleChange={(value) => {
          setLifecycle(value);
        }}
        onOpen={onOpen}
        onLoadMore={() => void catalog.fetchNextPage()}
        onRetry={() => void catalog.refetch()}
        newAction={(
          <LibraryNewMenu
            onCreated={onOpen}
            triggerButton={(
              <NodexButton size="sm">
                <Plus className="icon-sm" />
                New
              </NodexButton>
            )}
          />
        )}
        projects={projects}
        onOpenInProject={onOpenInProject}
        mutationsEnabled
      />
  );
}
