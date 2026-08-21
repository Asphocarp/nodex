import { useState } from "react";
import { SettingsAgentIcon } from "@/components/shared/icons";
import { toast } from "@/components/ui/toast";
import type { ThreadStageActions } from "../../thread-stage-types";
import { useAutoReviewApprovalNudgeActions } from "../../auto-review-approval-nudge-state";

const AUTO_REVIEW_LEARN_MORE_URL =
  "https://developers.openai.com/codex/concepts/sandboxing/auto-review";

export function AutoReviewApprovalNudge({
  threadId,
  actions,
}: {
  threadId: string;
  actions: Pick<ThreadStageActions, "onPermissionModeChange">;
}) {
  const [isEnabling, setIsEnabling] = useState(false);
  const { dismissNudges, resolveNudge } = useAutoReviewApprovalNudgeActions();

  const enableAutoReview = async () => {
    if (isEnabling) return;
    setIsEnabling(true);
    try {
      await actions.onPermissionModeChange("guardian-approvals");
      resolveNudge(threadId);
    } catch {
      toast.danger("Could not enable Auto-review — try again");
    } finally {
      setIsEnabling(false);
    }
  };

  return (
    <div
      data-auto-review-approval-nudge="true"
      className="flex flex-col overflow-hidden rounded-3xl bg-token-input-background text-token-foreground extension:border extension:border-token-border electron:elevation-prominent focus:outline-none"
    >
      <form
        className="flex flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          void enableAutoReview();
        }}
      >
        <div className="flex flex-col gap-5 px-4 pt-4 pb-5">
          <div className="flex items-center gap-2 text-sm text-token-description-foreground">
            <SettingsAgentIcon className="icon-sm shrink-0" />
            <span>Want fewer approval prompts?</span>
          </div>
          <div className="text-base leading-6">
            Nodex can automatically approve eligible actions while it works. This may use more
            credits.{" "}
            <a
              className="cursor-interaction rounded-sm underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-token-focus-border"
              href={AUTO_REVIEW_LEARN_MORE_URL}
              target="_blank"
              rel="noreferrer"
            >
              Learn more.
            </a>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-token-border/50 px-3 py-2">
          <button
            type="button"
            disabled={isEnabling}
            className="border-token-border user-select-none no-drag cursor-interaction flex h-token-button-composer items-center gap-1 rounded-lg border bg-token-bg-fog px-2 py-0 text-base leading-[18px] whitespace-nowrap text-token-button-tertiary-foreground select-none focus:outline-none enabled:hover:bg-token-list-hover-background disabled:cursor-not-allowed disabled:opacity-40 data-[state=open]:bg-token-list-hover-background"
            onClick={() => {
              void dismissNudges();
            }}
          >
            Keep manual approvals
          </button>
          <button
            autoFocus
            type="submit"
            disabled={isEnabling}
            className="border-token-border user-select-none no-drag cursor-interaction flex h-token-button-composer items-center gap-1 rounded-lg border border-transparent bg-token-foreground px-2 py-0 text-base leading-[18px] whitespace-nowrap text-token-dropdown-background select-none focus:outline-none enabled:hover:bg-token-foreground/80 disabled:cursor-not-allowed disabled:opacity-40 data-[state=open]:bg-token-foreground/80"
          >
            <span>Approve for me</span>
            <kbd
              aria-hidden
              className="inline-flex h-4 min-w-4 items-center justify-center rounded-md border-0 bg-current/10 px-1.5 py-0 font-sans text-xs leading-4 text-token-dropdown-background shadow-none"
            >
              ⏎
            </kbd>
          </button>
        </div>
      </form>
    </div>
  );
}
