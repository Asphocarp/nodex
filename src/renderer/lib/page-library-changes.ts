import { rendererLocalCommitIngress } from "./local-commit-ingress";

interface PageFileLibraryEvent {
  readonly page_file_manifest_revisions: Readonly<Record<string, number>>;
}

export const pageFileManifestRevisionFromLibraryEvent = (
  event: PageFileLibraryEvent,
  pageId: string,
): number | null => {
  const revision = event.page_file_manifest_revisions[pageId];
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
};

/** Subscribe only to authorized commits that advanced this Page's File manifest. */
export const subscribePageFileChanges = (
  pageId: string,
  listener: (revision: number) => void,
): (() => void) =>
  rendererLocalCommitIngress.subscribeAtoms((_packet, atom) => {
    const payload = atom.payload;
    if (payload.module !== "library") return;
    const revision = pageFileManifestRevisionFromLibraryEvent(payload.event, pageId);
    if (revision === null) return;
    listener(revision);
  });
