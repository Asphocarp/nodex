import type { BootstrapRuntimeEvent } from "./bootstrap-events";

export interface MainRuntimeStartupEventContext {
  initialArgv: string[];
  startupEvents?: BootstrapRuntimeEvent[];
}

export interface MainRuntimeStartupEventHandlers {
  consumeArgvDeepLink: (argv: string[]) => boolean | Promise<boolean>;
  consumeOpenUrlDeepLink: (url: string) => void | Promise<void>;
}

export function requestsExplicitNewWindow(argv: string[]): boolean {
  return argv.includes("--new-window");
}

export async function collectSecondInstancesForStartupReplay(
  context: MainRuntimeStartupEventContext,
  handlers: MainRuntimeStartupEventHandlers,
): Promise<string[][]> {
  await handlers.consumeArgvDeepLink(context.initialArgv);
  const secondInstancesWithoutDeepLinks: string[][] = [];

  for (const event of context.startupEvents ?? []) {
    if (event.type === "open-url") {
      await handlers.consumeOpenUrlDeepLink(event.url);
      continue;
    }

    if (!(await handlers.consumeArgvDeepLink(event.argv))) {
      secondInstancesWithoutDeepLinks.push(event.argv);
    }
  }

  return secondInstancesWithoutDeepLinks;
}
