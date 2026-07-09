import type {
  CodexCanonicalHookRun,
} from "../../../../shared/codex-conversation-state/codex-conversation-state";
import {
  buildCodexHooksSettingsPath,
  resolveHookFeedbackSettingsTarget,
} from "../../../lib/codex-hooks-route";

export type HookFeedbackSource = CodexCanonicalHookRun["run"]["source"];

export function collectHookFeedbackSources(
  hookRuns: readonly CodexCanonicalHookRun[] | undefined,
  message: string,
): HookFeedbackSource[] {
  const target = message.trim();
  if (!target || !hookRuns) return [];

  return hookRuns.flatMap((hook): HookFeedbackSource[] => {
    if (hook.run.eventName !== "stop") return [];
    const matches = hook.run.entries.some((entry) => (
      entry.kind === "feedback"
      && entry.text.trim() === target
    ));
    return matches ? [hook.run.source] : [];
  });
}

export function buildHookFeedbackSettingsHref(input: {
  hostId: string;
  cwd: string | null | undefined;
  sources: readonly HookFeedbackSource[] | undefined;
}): string {
  return buildCodexHooksSettingsPath(resolveHookFeedbackSettingsTarget(input));
}
