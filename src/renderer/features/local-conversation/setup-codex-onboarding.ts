export const CODEX_SETUP_ROLE_IDS = [
  "engineering",
  "data_science",
  "product_management",
  "design",
  "marketing",
  "sales",
  "finance",
  "operations",
  "people_hr",
  "legal",
  "student",
  "something_else",
] as const;

export type CodexSetupRoleId = (typeof CODEX_SETUP_ROLE_IDS)[number];

export interface CodexSetupTaskSuggestion {
  readonly title: string;
  readonly prompt: string;
}

const ROLE_LABELS: Readonly<Record<CodexSetupRoleId, string>> = {
  engineering: "Engineering",
  data_science: "Data science",
  product_management: "Product",
  design: "Design",
  marketing: "Marketing",
  sales: "Sales",
  finance: "Finance",
  operations: "Operations",
  people_hr: "People & HR",
  legal: "Legal",
  student: "Student",
  something_else: "Something else",
};

const TASK_SUGGESTIONS: Readonly<Record<CodexSetupRoleId, readonly CodexSetupTaskSuggestion[]>> = {
  engineering: [
    {
      title: "Debug an issue",
      prompt:
        "Use GitHub, Linear, or my uploaded logs/code to investigate a bug, PR, build failure, or issue I choose. If missing, ask what to inspect. Identify likely root cause, fix path, and tests.",
    },
    {
      title: "Plan implementation",
      prompt:
        "Use GitHub, Linear, or my uploaded spec to plan implementation for a feature or bug. If I have not named one, ask me which issue. Include likely files, edge cases, and test plan.",
    },
    {
      title: "Review a PR",
      prompt:
        "Use GitHub or an uploaded diff to review a specific PR. If no PR is provided, ask which PR to review. Check correctness, risk, edge cases, missing tests, and alignment with the issue or spec.",
    },
  ],
  product_management: [
    {
      title: "Review a PRD",
      prompt:
        "If I uploaded or attached a PRD, use that first. Otherwise ask me which PRD, feature, or product area to review. Critique it for unclear requirements, missing metrics, risks, open questions, and next decisions.",
    },
    {
      title: "Prep a launch",
      prompt:
        "Use Linear or my uploaded context to prep a launch-readiness brief. If I have not named the launch, ask me which one. Summarize blockers, owners, risks, unresolved decisions, and next actions.",
    },
    {
      title: "Summarize stakeholder asks",
      prompt:
        "Use Gmail, Slack, or my uploaded notes to summarize stakeholder asks on a product topic I choose. If missing, ask for the topic. Group asks by theme and recommend what to do next.",
    },
  ],
  finance: [
    {
      title: "Prep a finance review",
      prompt:
        "Use Google Calendar, Google Drive, Gmail, or my uploaded docs to prep for a finance review, budget, forecast, close item, or model I choose. If missing, ask which topic. Summarize key numbers, risks, decisions, and likely questions.",
    },
    {
      title: "Triage finance asks",
      prompt:
        "Use Gmail, Slack, or my uploaded notes to find finance asks for a topic I choose. Create a tracker with requester, ask, amount if mentioned, deadline, status, missing info, and next step.",
    },
    {
      title: "Review a model",
      prompt:
        "Use Google Drive or my uploaded spreadsheet/model to review a forecast, budget, close package, or results file. Summarize what changed, what looks off, follow-ups, and a leadership-ready narrative.",
    },
  ],
  marketing: [
    {
      title: "Review a campaign brief",
      prompt:
        "If I uploaded or attached a campaign brief, use that first. Otherwise ask me which campaign, launch, audience, or message to review. Summarize positioning, gaps, risks, open questions, and next assets needed.",
    },
    {
      title: "Turn feedback into direction",
      prompt:
        "Use Slack, Gmail, or my uploaded feedback to analyze campaign feedback for a topic I choose. Separate signal from noise, identify repeated concerns, and recommend messaging changes.",
    },
    {
      title: "Draft asset concepts",
      prompt:
        "Use Google Drive or my uploaded brief to create 3 asset concepts for a campaign or audience I choose. Include audience, message, visual direction, headline copy, and channel fit.",
    },
  ],
  sales: [
    {
      title: "Prep a customer meeting",
      prompt:
        "Use Google Calendar, Gmail, Google Drive, Slack, or my uploaded account notes to prep for a customer meeting I choose. If missing, ask which account. Give me context, buyer priorities, talk track, objections, risks, and next steps.",
    },
    {
      title: "Draft a follow-up",
      prompt:
        "Use Gmail or my uploaded meeting notes to draft a follow-up for an account or prospect I choose. Summarize context, infer buyer priorities, identify missing info, and write the follow-up.",
    },
    {
      title: "Inspect deal risk",
      prompt:
        "Use Slack, Gmail, or my uploaded notes to inspect a deal, account, or territory I choose. Create a risk table with latest signal, risk, owner, next action, and suggested message.",
    },
  ],
  operations: [
    {
      title: "Prep an operating review",
      prompt:
        "Use Google Calendar, Google Drive, Slack, or my uploaded docs to prep an operating review for an initiative I choose. If missing, ask which initiative. Summarize goals, blockers, owners, decisions needed, escalation points, and next steps.",
    },
    {
      title: "Map dependencies",
      prompt:
        "Use Google Drive, Slack, or my uploaded project plan to map dependencies for a workstream I choose. Include owner, status, risk, dependency, decision needed, and recommended next action.",
    },
    {
      title: "Prioritize stakeholder asks",
      prompt:
        "Use Gmail, Slack, Google Calendar, or my uploaded notes to summarize stakeholder asks for an initiative I choose. Prioritize them by urgency, impact, and deadline, then suggest responses.",
    },
  ],
  people_hr: [
    {
      title: "Prep an operating review",
      prompt:
        "Use Google Calendar, Google Drive, Slack, Gmail, and my uploaded docs where available to prep an operating review for an initiative I choose. If missing, ask which initiative. Summarize goals, blockers, owners, decisions needed, escalation points, and next steps.",
    },
    {
      title: "Triage cross-functional partner asks",
      prompt:
        "Use Gmail, Slack, or Teams, or my uploaded notes to find cross-functional team or partner asks for a topic I choose. Create a tracker with requester, ask, amount if mentioned, deadline, status, missing info, and next step.",
    },
    {
      title: "Structure a messy business problem",
      prompt:
        "Use problem structuring to turn an ambiguous business question I choose into a clear decision frame. Identify the core question, sub-questions, assumptions, evidence needed, stakeholders, and recommended workplan.",
    },
  ],
  legal: [
    {
      title: "Prep an operating review",
      prompt:
        "Use Google Calendar, Google Drive, Slack, Gmail, and my uploaded docs where available to prep an operating review for an initiative I choose. If missing, ask which initiative. Summarize goals, blockers, owners, decisions needed, escalation points, and next steps.",
    },
    {
      title: "Draft a leadership memo",
      prompt:
        "Use available docs, Slack context, Gmail, and uploaded notes to draft a crisp leadership memo on a topic I choose. Include the situation, decision needed, evidence, options, risks, and recommended next step.",
    },
    {
      title: "Structure a messy business problem",
      prompt:
        "Use problem structuring to turn an ambiguous business question I choose into a clear decision frame. Identify the core question, sub-questions, assumptions, evidence needed, stakeholders, and recommended workplan.",
    },
  ],
  data_science: [
    {
      title: "Investigate a metric",
      prompt:
        "Use Google Drive, Slack, GitHub, or my uploaded data/readout to investigate a metric, experiment, or dashboard I choose. If missing, ask which one. Summarize the business question, evidence, caveats, likely drivers, and next analysis.",
    },
    {
      title: "Review a notebook",
      prompt:
        "Use GitHub or my uploaded notebook/code to review a notebook, model, pipeline, or data issue. Explain what changed, why it matters, what could break, and how to validate it.",
    },
    {
      title: "Triage analysis requests",
      prompt:
        "Use Gmail, Slack, or my uploaded notes to triage data science requests for an area I choose. Rank them by business impact, urgency, data availability, ambiguity, and recommended priority.",
    },
  ],
  design: [
    {
      title: "Critique a design",
      prompt:
        "Use Figma or my uploaded screenshot/prototype to critique a design, flow, or screen I choose. Review hierarchy, interaction clarity, accessibility, edge cases, and product goal alignment, then suggest 5 improvements.",
    },
    {
      title: "Synthesize design feedback",
      prompt:
        "Use Slack, Gmail, Figma, or my uploaded feedback to synthesize feedback for a design project I choose. Group themes, identify contradictions, recommend what to accept or push back on, and draft an alignment reply.",
    },
    {
      title: "Review spec to design",
      prompt:
        "Use Google Drive, Figma, or my uploaded spec/design to compare a product spec with the design. Identify mismatches, missing states, UX risks, and decisions needed before handoff.",
    },
  ],
  student: [
    {
      title: "Build a study plan",
      prompt:
        "Use Google Calendar, Gmail, Google Drive, or my uploaded syllabus/notes to build a study plan for a class, exam, assignment, or paper I choose. If missing, ask which one. Include deadlines, priorities, and daily next steps.",
    },
    {
      title: "Debug my assignment",
      prompt:
        "Use GitHub or my uploaded code/course materials to help debug a coding assignment or project. Explain the issue in plain English, suggest a fix path, and list what to test.",
    },
    {
      title: "Summarize class materials",
      prompt:
        "Use Gmail, Google Drive, or my uploaded lecture notes/readings to summarize a class topic I choose. Pull out key concepts, deadlines, assignments, and what I should study next.",
    },
  ],
  something_else: [
    {
      title: "Summarize updates",
      prompt: "Summarize updates across Slack, Gmail, and docs, then draft a to-do list for me",
    },
    {
      title: "Draft follow-ups",
      prompt: "Review recent unread Gmail messages and draft personalized follow-ups",
    },
    {
      title: "Prep for meetings",
      prompt:
        "Prep me for today's meetings using Google Calendar, Gmail, Google Drive, and Slack: context, agenda items, and key decisions",
    },
  ],
};

const ROLE_ID_SET = new Set<string>(CODEX_SETUP_ROLE_IDS);

function normalizeRole(role: string): CodexSetupRoleId {
  if (role === "default") return "engineering";
  return ROLE_ID_SET.has(role) ? (role as CodexSetupRoleId) : "something_else";
}

export function getCodexSetupRoleLabel(role: CodexSetupRoleId): string {
  return ROLE_LABELS[role];
}

export function shuffleCodexSetupRoles(random: () => number = Math.random): CodexSetupRoleId[] {
  const roles = CODEX_SETUP_ROLE_IDS.filter((role) => role !== "something_else");
  for (let index = roles.length - 1; index > 0; index -= 1) {
    const targetIndex = Math.floor(random() * (index + 1));
    [roles[index], roles[targetIndex]] = [roles[targetIndex]!, roles[index]!];
  }
  return [...roles, "something_else"];
}

export function resolveCodexSetupTaskSuggestions(
  roles: readonly string[],
  limit = 3,
): CodexSetupTaskSuggestion[] {
  const normalizedRoles = Array.from(
    new Set((roles.length > 0 ? roles : ["something_else"]).map(normalizeRole)),
  );
  const suggestionsByRole = normalizedRoles.map((role) => TASK_SUGGESTIONS[role]);
  const indexes = suggestionsByRole.map(() => 0);
  const suggestions: CodexSetupTaskSuggestion[] = [];
  const seen = new Set<CodexSetupTaskSuggestion>();

  for (const [roleIndex, roleSuggestions] of suggestionsByRole.entries()) {
    const suggestion = roleSuggestions[indexes[roleIndex]!] ?? null;
    indexes[roleIndex] += 1;
    if (!suggestion || seen.has(suggestion)) continue;
    seen.add(suggestion);
    suggestions.push(suggestion);
    if (suggestions.length >= limit) return suggestions;
  }

  while (suggestions.length < limit) {
    let added = false;
    for (const [roleIndex, roleSuggestions] of suggestionsByRole.entries()) {
      const suggestion = roleSuggestions[indexes[roleIndex]!] ?? null;
      indexes[roleIndex] += 1;
      if (!suggestion || seen.has(suggestion)) continue;
      seen.add(suggestion);
      suggestions.push(suggestion);
      added = true;
      if (suggestions.length >= limit) break;
    }
    if (!added) break;
  }

  return suggestions;
}

export function normalizeCodexSetupRoles(value: unknown): CodexSetupRoleId[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter(
        (role): role is CodexSetupRoleId => typeof role === "string" && ROLE_ID_SET.has(role),
      ),
    ),
  );
}
