export type UiLabCliArguments =
  | {
    readonly command: "open";
    readonly appMode: "prepared" | "dev";
    readonly target:
      | { readonly kind: "seed"; readonly scenarioId: string }
      | { readonly kind: "resume"; readonly sessionId: string };
  }
  | {
    readonly command: "verify";
    readonly scenarioId: string;
  };

const openUsage =
  "Usage: pnpm ui:lab -- --seed <scenario-id> [--dev] | --resume <session-id> [--dev]";

const requireValue = (
  arguments_: readonly string[],
  index: number,
  option: "--seed" | "--resume",
): string => {
  const value = arguments_[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value. ${openUsage}`);
  }
  return value;
};

export const parseUiLabCliArguments = (
  argv: readonly string[],
): UiLabCliArguments => {
  const [command = "open", ...arguments_] = argv.filter(
    (argument) => argument !== "--",
  );
  if (command !== "open" && command !== "verify") {
    throw new Error(`Unknown UI Lab command: ${command}`);
  }
  if (command === "verify") {
    const [scenarioId, ...flags] = arguments_;
    if (!scenarioId || flags.length > 0) {
      throw new Error("Usage: pnpm ui:verify -- <scenario-id>");
    }
    return { command, scenarioId };
  }

  let appMode: "prepared" | "dev" = "prepared";
  let target: Extract<UiLabCliArguments, { command: "open" }>["target"] | null = null;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--dev") {
      appMode = "dev";
      continue;
    }
    if (argument === "--seed" || argument === "--resume") {
      if (target) throw new Error(`Choose exactly one seed or session. ${openUsage}`);
      const value = requireValue(arguments_, index, argument);
      target = argument === "--seed"
        ? { kind: "seed", scenarioId: value }
        : { kind: "resume", sessionId: value };
      index += 1;
      continue;
    }
    throw new Error(`Unknown UI Lab option: ${argument}. ${openUsage}`);
  }
  if (!target) throw new Error(openUsage);
  return { command, appMode, target };
};
