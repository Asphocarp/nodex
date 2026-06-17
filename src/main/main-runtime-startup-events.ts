import type { BootstrapRuntimeEvent } from "./bootstrap-events";

export interface MainRuntimeStartupEventContext {
  initialArgv: string[];
  startupEvents?: BootstrapRuntimeEvent[];
}

export interface MainRuntimeStartupEventHandlers {
  consumeArgvDeepLink: (argv: string[]) => boolean;
  consumeOpenUrlDeepLink: (url: string) => void;
}

export function collectSecondInstancesForStartupReplay(
  context: MainRuntimeStartupEventContext,
  handlers: MainRuntimeStartupEventHandlers,
): string[][] {
  handlers.consumeArgvDeepLink(context.initialArgv);
  const secondInstancesWithoutDeepLinks: string[][] = [];

  for (const event of context.startupEvents ?? []) {
    if (event.type === "open-url") {
      handlers.consumeOpenUrlDeepLink(event.url);
      continue;
    }

    if (!handlers.consumeArgvDeepLink(event.argv)) {
      secondInstancesWithoutDeepLinks.push(event.argv);
    }
  }

  return secondInstancesWithoutDeepLinks;
}
