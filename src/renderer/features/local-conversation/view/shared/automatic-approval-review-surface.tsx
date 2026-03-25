import { useState } from "react";
import { cn } from "../../../../lib/utils";
import type { CodexConversationItem } from "../../../../lib/types";
import {
  buildAutomaticApprovalReviewSummary,
  normalizeAutomaticApprovalReviewPayload,
  type CodexAutomaticApprovalReviewStatus,
} from "../../../../../shared/codex-transcript-special-items";

function getStatusLabel(status: CodexAutomaticApprovalReviewStatus): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "denied":
      return "Denied";
    case "aborted":
      return "Aborted";
    case "inProgress":
      return "Reviewing";
  }
}

function getRiskLabel(riskLevel: "high" | "medium" | "low"): string {
  switch (riskLevel) {
    case "high":
      return "High risk";
    case "medium":
      return "Medium risk";
    case "low":
      return "Low risk";
  }
}

function getStatusClasses(status: CodexAutomaticApprovalReviewStatus): string {
  if (status === "approved") return "text-token-success bg-token-success/15";
  if (status === "denied") return "text-token-danger bg-token-danger/15";
  if (status === "aborted") return "text-token-description-foreground bg-token-foreground/5";
  return "text-token-foreground";
}

export function AutomaticApprovalReviewSurface({ item }: { item: CodexConversationItem }) {
  const review = normalizeAutomaticApprovalReviewPayload(item.rawItem);
  if (!review) return null;

  const details = buildAutomaticApprovalReviewSummary(review);
  const hasDetails = details.trim().length > 0;
  const [expanded, setExpanded] = useState(false);
  const bodyId = `automatic-approval-review-summary-${item.entryId ?? item.itemId}`;
  const isInProgress = review.status === "inProgress";

  const content = (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="text-size-chat font-medium text-token-foreground">Automatic approval review</span>
      <span
        className={cn(
          "text-size-chat min-w-0 font-medium",
          !isInProgress && "rounded-full px-1.5 py-0.5",
          getStatusClasses(review.status),
          isInProgress && "loading-shimmer-pure-text",
        )}
      >
        {getStatusLabel(review.status)}
      </span>
      {review.riskLevel ? (
        <span className="text-size-chat min-w-0 text-token-description-foreground">
          {getRiskLabel(review.riskLevel)}
        </span>
      ) : null}
      {hasDetails ? (
        <svg
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={cn(
            "icon-2xs flex-shrink-0 text-token-input-placeholder-foreground transition-transform duration-200",
            expanded && "rotate-90",
          )}
          aria-hidden
        >
          <path
            d="M7.52925 3.7793C7.75652 3.55203 8.10803 3.52383 8.36616 3.69434L8.47065 3.7793L14.2207 9.5293C14.4804 9.789 14.4804 10.211 14.2207 10.4707L8.47065 16.2207C8.21095 16.4804 7.78895 16.4804 7.52925 16.2207C7.26955 15.961 7.26955 15.539 7.52925 15.2793L12.8085 10L7.52925 4.7207L7.44429 4.61621C7.27378 4.35808 7.30198 4.00657 7.52925 3.7793Z"
            fill="currentColor"
          />
        </svg>
      ) : null}
    </div>
  );

  return (
    <div className="min-w-0 py-0">
      <div className="flex flex-col gap-1">
        {hasDetails ? (
          <button
            type="button"
            className="group cursor-pointer text-left"
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={() => {
              setExpanded((current) => !current);
            }}
          >
            {content}
          </button>
        ) : content}
        {hasDetails && expanded ? (
          <p id={bodyId} className="text-size-chat whitespace-pre-wrap text-token-description-foreground">
            {details}
          </p>
        ) : null}
      </div>
    </div>
  );
}
