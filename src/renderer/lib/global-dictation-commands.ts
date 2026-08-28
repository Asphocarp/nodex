import type { GlobalDictationRendererCommand } from "../../shared/global-dictation";

type RoutedGlobalDictationCommand = Extract<
  GlobalDictationRendererCommand,
  { readonly sessionId: string }
>;

/** Central renderer boundary for Main-owned global dictation commands. */
export function subscribeGlobalDictationCommands(
  listener: (command: RoutedGlobalDictationCommand) => void,
): () => void {
  if (!window.api) return () => undefined;
  return window.api.on("global-dictation:command", (value) => {
    if (!value || typeof value !== "object" || !("sessionId" in value)) return;
    listener(value as RoutedGlobalDictationCommand);
  });
}
