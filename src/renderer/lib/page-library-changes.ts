import { rendererLocalCommitIngress } from "./local-commit-ingress";

interface PageFileLibraryEvent {
  readonly page_file_manifest_revisions: Readonly<Record<string, number>>;
  readonly page_file_body_usage_revisions: Readonly<Record<string, number>>;
}

export interface PageFileChange {
  readonly manifestRevision: number | null;
  readonly bodyUsageRevision: number | null;
}

export const pageFileManifestRevisionFromLibraryEvent = (
  event: PageFileLibraryEvent,
  pageId: string,
): number | null => {
  const revision = event.page_file_manifest_revisions[pageId];
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
};

export const pageFileBodyUsageRevisionFromLibraryEvent = (
  event: PageFileLibraryEvent,
  pageId: string,
): number | null => {
  const revision = event.page_file_body_usage_revisions[pageId];
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
};

/** Subscribe only to authorized commits that changed this Page's File inventory projection. */
export const subscribePageFileChanges = (
  pageId: string,
  listener: (change: PageFileChange) => void,
): (() => void) =>
  rendererLocalCommitIngress.subscribeAtoms((_packet, atom) => {
    const payload = atom.payload;
    if (payload.module !== "library") return;
    const manifestRevision = pageFileManifestRevisionFromLibraryEvent(payload.event, pageId);
    const bodyUsageRevision = pageFileBodyUsageRevisionFromLibraryEvent(payload.event, pageId);
    if (manifestRevision === null && bodyUsageRevision === null) return;
    listener({ manifestRevision, bodyUsageRevision });
  });
