import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type * as Y from "yjs";

import {
  makePageTitleResourceKey,
  type PageTitleProjectionStore,
} from "./page-title-projection-store";

export interface PageTitleResourceIdentity {
  readonly libraryId: string;
  readonly pageId: string;
}

interface PageTitleProjectionContextValue {
  readonly currentLibraryId: string | null;
  readonly store: PageTitleProjectionStore;
}

const PageTitleProjectionContext = createContext<PageTitleProjectionContextValue | null>(null);

export function PageTitleProjectionProvider({
  currentLibraryId,
  store,
  children,
}: PageTitleProjectionContextValue & { readonly children: ReactNode }) {
  const value = useMemo(() => ({ currentLibraryId, store }), [currentLibraryId, store]);
  return (
    <PageTitleProjectionContext.Provider value={value}>
      {children}
    </PageTitleProjectionContext.Provider>
  );
}

export function usePresentedPageTitle(
  pageId: string | null,
  fallbackTitle: string,
  libraryId?: string | null,
): string {
  const context = useContext(PageTitleProjectionContext);
  const store = context?.store ?? null;
  const resolvedLibraryId = libraryId ?? context?.currentLibraryId ?? null;
  const source = useMemo(() => {
    if (!store || !resolvedLibraryId || !pageId) return null;
    return store.createSource(makePageTitleResourceKey(resolvedLibraryId, pageId), fallbackTitle);
  }, [fallbackTitle, pageId, resolvedLibraryId, store]);
  const subscribe = source?.subscribe ?? EMPTY_SOURCE.subscribe;
  const getSnapshot = source?.getSnapshot ?? (() => presentFallbackTitle(fallbackTitle));
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function PageTitleProjectionPublisher({
  identity,
  publisherId,
  title,
  children,
}: {
  readonly identity: PageTitleResourceIdentity;
  readonly publisherId: string;
  readonly title: Y.Text;
  readonly children: ReactNode;
}) {
  const context = useContext(PageTitleProjectionContext);
  const store = context?.store ?? null;
  const publisherLeaseId = useId();

  useLayoutEffect(() => {
    if (!store) return;
    const resourceKey = makePageTitleResourceKey(identity.libraryId, identity.pageId);
    const leasedPublisherId = `${publisherId}:${publisherLeaseId}`;
    const publish = () => {
      store.publishLive(resourceKey, leasedPublisherId, title.toString());
    };
    publish();
    title.observe(publish);
    return () => {
      title.unobserve(publish);
      store.releasePublisher(resourceKey, leasedPublisherId);
    };
  }, [identity.libraryId, identity.pageId, publisherId, publisherLeaseId, store, title]);

  return children;
}

const presentFallbackTitle = (title: string): string => title.trim() || "Untitled";

const EMPTY_SOURCE = {
  subscribe: () => () => undefined,
};
