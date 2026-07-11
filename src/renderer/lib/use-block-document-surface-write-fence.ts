import { useSyncExternalStore } from "react";
import type { BlockDocumentSurfaceWriteFence } from "./block-document-surface-runtime";

const subscribeNever = (): (() => void) => () => undefined;
const getNotFrozen = (): boolean => false;

/** Subscribe only to the derived write-fence bit, not the full sync status. */
export const useBlockDocumentSurfaceWriteFrozen = (
  fence: BlockDocumentSurfaceWriteFence | null | undefined,
): boolean =>
  useSyncExternalStore(
    fence?.subscribe ?? subscribeNever,
    fence?.getWriteFrozen ?? getNotFrozen,
    fence?.getWriteFrozen ?? getNotFrozen,
  );
