import type { CodexComposerAppshotContext } from "./types";

export const CODEX_APPSHOTS_ADDITIONAL_CONTEXT_KEY = "appshots";

function escapeAppshotAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAppshotText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function serializeCodexAppshotContext(context: CodexComposerAppshotContext): string {
  const attributes = [
    `app="${escapeAppshotAttribute(context.appName)}"`,
    `bundle-identifier="${escapeAppshotAttribute(context.bundleIdentifier)}"`,
  ];
  const windowTitle = context.windowTitle?.trim();
  if (windowTitle) {
    attributes.push(`window-title="${escapeAppshotAttribute(windowTitle)}"`);
  }
  if (context.imageName.trim()) {
    attributes.push(`image="${escapeAppshotAttribute(context.imageName)}"`);
  }
  return [
    `<appshot ${attributes.join(" ")}>`,
    escapeAppshotText(context.axTree),
    "</appshot>",
  ].join("\n");
}

export function serializeCodexAppshotContextsForPrompt(
  contexts: readonly CodexComposerAppshotContext[],
): string {
  return [
    "# Applications mentioned by the user:",
    ...contexts.map((context) => `\n${serializeCodexAppshotContext(context)}`),
  ].join("\n");
}
