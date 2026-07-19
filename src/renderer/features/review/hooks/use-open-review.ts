import { useCallback } from "react";
import { toast } from "@/components/ui/toast";
import { useSetScopedAtom } from "@/lib/maitai";
import {
  prepareReviewOpenAtom,
  type ReviewOpenIntent,
} from "../model/review-view-state";

export interface UseOpenReviewOptions {
  readonly activateReviewTab: () => Promise<void>;
}

export function useOpenReview({
  activateReviewTab,
}: UseOpenReviewOptions): (intent: ReviewOpenIntent) => Promise<void> {
  const prepareReviewOpen = useSetScopedAtom(prepareReviewOpenAtom);

  return useCallback(async (intent: ReviewOpenIntent) => {
    prepareReviewOpen(intent);
    try {
      await activateReviewTab();
    } catch (error) {
      toast.danger(
        error instanceof Error ? error.message : "Could not open Review.",
      );
    }
  }, [activateReviewTab, prepareReviewOpen]);
}
