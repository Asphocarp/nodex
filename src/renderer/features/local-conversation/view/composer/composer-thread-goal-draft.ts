const GOAL_SLASH_COMMAND_PATTERN = /^\/go+al(?=$| )/u;
const GOAL_APP_LINK_PATTERN = /\[((?:\\.|[^\]])+)\]\((?:plugin|app):\/\/(?:\\.|[^)])+\)/gu;

export interface ComposerThreadGoalDraft {
  objective: string;
  hasAttachments: boolean;
}

export type ComposerThreadGoalDraftResult =
  | { status: "not-goal" }
  | { status: "empty" }
  | { status: "ready"; draft: ComposerThreadGoalDraft };

export function buildComposerThreadGoalDraft(input: {
  promptRaw: string;
  goalActionAvailable: boolean;
  goalModeActive: boolean;
  hasAttachments: boolean;
}): ComposerThreadGoalDraftResult {
  if (!input.goalActionAvailable) {
    return { status: "not-goal" };
  }

  const slashObjective = parseGoalSlashObjective(input.promptRaw);
  const objectiveRaw = slashObjective ?? (input.goalModeActive ? input.promptRaw : null);
  if (objectiveRaw === null) {
    return { status: "not-goal" };
  }

  const objective = stripGoalActionLinks(objectiveRaw).trim();
  if (objective.length === 0 && !input.hasAttachments) {
    return { status: "empty" };
  }

  return {
    status: "ready",
    draft: {
      objective,
      hasAttachments: input.hasAttachments,
    },
  };
}

function parseGoalSlashObjective(promptRaw: string): string | null {
  const trimmedStart = promptRaw.trimStart();
  const match = trimmedStart.match(GOAL_SLASH_COMMAND_PATTERN);
  if (!match) {
    return null;
  }

  return trimmedStart.slice(match[0].length).trimStart();
}

function stripGoalActionLinks(objective: string): string {
  return objective.replace(GOAL_APP_LINK_PATTERN, (_match, label: string) =>
    unescapeMarkdownLinkLabel(label),
  );
}

function unescapeMarkdownLinkLabel(label: string): string {
  return label.replaceAll("\\]\\(", "](").replaceAll("\\]", "]").replaceAll("\\\\", "\\");
}
