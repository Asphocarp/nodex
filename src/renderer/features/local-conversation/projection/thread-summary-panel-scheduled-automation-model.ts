import type { CodexScheduledAutomation } from "@/lib/types";
import {
  formatCodexScheduledAutomationNextRunLabel,
  formatCodexScheduledAutomationRruleSummary,
} from "@/lib/codex-scheduled-automation-display";
import type { ThreadSummaryPanelScheduledAutomationRow } from "../thread-stage-types";

interface BuildThreadSummaryPanelScheduledAutomationRowInput {
  automations: readonly CodexScheduledAutomation[];
  conversationId: string | null;
  now?: Date;
}

function isActiveHeartbeatAutomationForThread(
  automation: CodexScheduledAutomation,
  conversationId: string,
): boolean {
  return (
    automation.kind === "heartbeat" &&
    automation.status === "ACTIVE" &&
    automation.targetThreadId === conversationId
  );
}

export function buildThreadSummaryPanelScheduledAutomationRow({
  automations,
  conversationId,
  now = new Date(),
}: BuildThreadSummaryPanelScheduledAutomationRowInput): ThreadSummaryPanelScheduledAutomationRow | null {
  if (!conversationId) return null;

  const automation = automations.find((candidate) =>
    isActiveHeartbeatAutomationForThread(candidate, conversationId),
  );
  if (!automation) return null;

  return {
    id: automation.id,
    name: automation.name,
    scheduleSummary: formatCodexScheduledAutomationRruleSummary(automation.rrule),
    nextRunLabel: formatCodexScheduledAutomationNextRunLabel(automation.nextRunAt, now),
  };
}
