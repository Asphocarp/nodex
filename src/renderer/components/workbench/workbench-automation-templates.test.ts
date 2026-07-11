import { describe, expect, test } from "vitest";
import {
  WORKBENCH_AUTOMATION_CREATE_WITH_CHAT_PROMPT,
  WORKBENCH_AUTOMATION_TEMPLATES,
  buildWorkbenchAutomationTemplatePersonalizationPrompt,
  createWorkbenchAutomationDraftFromTemplate,
  filterWorkbenchAutomationTemplates,
} from "./workbench-automation-templates";

describe("workbench automation templates", () => {
  test("exposes the system automation catalog in reference order", () => {
    expect(WORKBENCH_AUTOMATION_TEMPLATES.length).toBe(18);
    expect(WORKBENCH_AUTOMATION_TEMPLATES[0]?.id).toBe("daily-bug-scan");
    expect(WORKBENCH_AUTOMATION_TEMPLATES[17]?.id).toBe("changelog-update");
  });

  test("exposes the create-with-chat prompt", () => {
    expect(WORKBENCH_AUTOMATION_CREATE_WITH_CHAT_PROMPT).toBe(
      "Let's set up a scheduled task together. First, explain how scheduled tasks work in Codex. Then interview me to figure out what I need scheduled and when it should run.",
    );
  });

  test("filters templates by name, prompt, and schedule label", () => {
    const ciMatches = filterWorkbenchAutomationTemplates(WORKBENCH_AUTOMATION_TEMPLATES, "ci failures");
    expect(ciMatches.length).toBe(2);
    expect(ciMatches[0]?.id).toBe("nightly-ci-report");
    expect(ciMatches[1]?.id).toBe("ci-monitor");

    const scheduleMatches = filterWorkbenchAutomationTemplates(WORKBENCH_AUTOMATION_TEMPLATES, "720 hours");
    expect(scheduleMatches.length).toBe(1);
    expect(scheduleMatches[0]?.id).toBe("dependency-sweep");
  });

  test("creates a manual draft from a selected template", () => {
    const template = WORKBENCH_AUTOMATION_TEMPLATES[0];
    if (!template) throw new Error("Expected a template");

    const draft = createWorkbenchAutomationDraftFromTemplate(template);

    expect(draft.kind).toBe("cron");
    expect(draft.executionEnvironment).toBe("worktree");
    expect(draft.name).toBe("Daily bug scan");
    expect(draft.prompt.includes("Scan recent commits")).toBe(true);
    expect(draft.rrule).toBe("FREQ=DAILY;BYHOUR=9;BYMINUTE=0");
    expect(draft.cwds.length).toBe(0);
  });

  test("builds the template personalization prompt for suggested create", () => {
    const template = WORKBENCH_AUTOMATION_TEMPLATES[0];
    if (!template) throw new Error("Expected a template");

    const prompt = buildWorkbenchAutomationTemplatePersonalizationPrompt(template);

    expect(prompt.includes("Personalize this scheduled task")).toBe(true);
    expect(prompt.includes("automation_update")).toBe(true);
    expect(prompt.includes("mode: \"suggested_create\"")).toBe(true);
    expect(prompt.includes("Template: \"Daily bug scan\"")).toBe(true);
  });
});
