import { describe, expect, test } from "bun:test";
import {
  buildThreadTitleGenerationPrompt,
  CODEX_THREAD_TITLE_MODEL,
  CODEX_THREAD_TITLE_OUTPUT_SCHEMA,
  CODEX_THREAD_TITLE_REASONING_EFFORT,
  CODEX_THREAD_TITLE_TIMEOUT_MS,
  parseGeneratedThreadTitleResponse,
} from "./thread-title-generator";

describe("thread title generator parity helpers", () => {
  test("builds the Codex Electron title prompt", () => {
    const prompt = buildThreadTitleGenerationPrompt("Fix login bug");

    expect(prompt).toBe([
      "You are a helpful assistant. You will be presented with a user prompt, and your job is to provide a short title for a task that will be created from that prompt.",
      "The tasks typically have to do with coding-related tasks, for example requests for bug fixes or questions about a codebase. The title you generate will be shown in the UI to represent the prompt.",
      "Generate a concise UI title (up to 36 characters) for this task.",
      "Fill the structured title field with plain text.",
      "Do not include quotes, markdown, formatting characters, or trailing punctuation in the title value.",
      "If the task includes a ticket reference (e.g. ABC-123), include it verbatim.",
      "",
      "Generate a clear, informative task title based solely on the prompt provided. Follow the rules below to ensure consistency, readability, and usefulness.",
      "",
      "How to write a good title:",
      "Generate a single-line title that captures the question or core change requested. The title should be easy to scan and useful in changelogs or review queues.",
      "- Use an imperative verb first: \"Add\", \"Fix\", \"Update\", \"Refactor\", \"Remove\", \"Locate\", \"Find\", etc.",
      "- Keep it under 36 characters and under 5 words where possible.",
      "- If the user's prompt is already a short clear title, reuse it verbatim.",
      "- Capitalize only the first word (unless locale requires otherwise).",
      "- Write the title in the user's locale.",
      "- Do not use punctuation at the end.",
      "- Output the title as plain text with no surrounding quotes or backticks.",
      "- Use precise, non-redundant language.",
      "- Translate fixed phrases into the user's locale (e.g., \"Fix bug\" -> \"Corrige el error\" in Spanish-ES), but leave code terms in English unless a widely adopted translation exists.",
      "- If the user provides a title explicitly, reuse it (translated if needed) and skip generation logic.",
      "- Make it clear when the user is requesting changes (use verbs like \"Fix\", \"Add\", etc) vs asking a question (use verbs like \"Find\", \"Locate\", \"Count\").",
      "- Do NOT respond to the user, answer questions, or attempt to solve the problem; just write a title that can represent the user's query.",
      "",
      "Examples:",
      "- User: \"Can we add dark-mode support to the settings page?\" -> Add dark-mode support",
      "- User: \"Fehlerbehebung: Beim Anmelden erscheint 500.\" (de-DE) -> Login-Fehler 500 beheben",
      "- User: \"Refactoriser le composant sidebar pour réduire le code dupliqué.\" (fr-FR) -> Refactoriser composant sidebar",
      "- User: \"How do I fix our login bug?\" -> Troubleshoot login bug",
      "- User: \"Where in the codebase is foo_bar created\" -> Locate foo_bar",
      "- User: \"what's 2+2\" -> Calculate 2+2",
      "",
      "By following these conventions, your titles will be readable, changelog-friendly, and helpful to both users and downstream tools.",
      "",
      "User prompt:",
      "Fix login bug",
    ].join("\n"));
  });

  test("keeps Electron model, reasoning, timeout, and schema constants", () => {
    expect(CODEX_THREAD_TITLE_MODEL).toBe("gpt-5.4-mini");
    expect(CODEX_THREAD_TITLE_REASONING_EFFORT).toBe("low");
    expect(CODEX_THREAD_TITLE_TIMEOUT_MS).toBe(30_000);
    expect(JSON.stringify(CODEX_THREAD_TITLE_OUTPUT_SCHEMA)).toBe(JSON.stringify({
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        title: {
          type: "string",
          minLength: 1,
          maxLength: 36,
        },
      },
      required: ["title"],
      additionalProperties: false,
    }));
  });

  test("truncates the source prompt before wrapping", () => {
    const prompt = buildThreadTitleGenerationPrompt("x".repeat(2_500));
    const userPrompt = prompt.split("User prompt:\n")[1] ?? "";

    expect(userPrompt.length).toBe(2_000);
  });

  test("parses structured JSON title responses only", () => {
    expect(parseGeneratedThreadTitleResponse("{\"title\":\"title: \\\"Fix flaky test.\\\"\"}")).toBe("Fix flaky test");
    expect(parseGeneratedThreadTitleResponse("{\"title\":\"This title is definitely longer than thirty six chars\"}")).toBe(null);
    expect(parseGeneratedThreadTitleResponse("{\"title\":\"\"}")).toBe(null);
    expect(parseGeneratedThreadTitleResponse("{\"name\":\"Fix flaky test\"}")).toBe(null);
    expect(parseGeneratedThreadTitleResponse("Fix flaky test")).toBe(null);
  });
});
