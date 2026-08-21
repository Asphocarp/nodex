import type {
  CodexApprovalRequest,
  CodexCommandAction,
  CodexItemStatus,
  CodexTurnStatus,
} from "./types";

const BASH_LIKE_SHELLS = new Set(["bash", "zsh", "sh"]);
const POWERSHELL_SHELLS = new Set(["pwsh", "powershell"]);
const POWERSHELL_FLAGS = new Set(["-nologo", "-noprofile", "-command", "-c"]);

export type CodexCommandApprovalPreview =
  | {
      kind: "command";
      commandText: string;
    }
  | {
      kind: "network";
      host: string;
      reason: string;
    };

export function resolveCommandExecutionRenderStatus(input: {
  itemStatus?: CodexItemStatus;
  turnStatus?: CodexTurnStatus | null;
}): CodexItemStatus | undefined {
  if (input.itemStatus === "inProgress" && input.turnStatus === "interrupted") {
    return "interrupted";
  }

  return input.itemStatus;
}

export function splitShellWords(input: string): string[] | null {
  const words: string[] = [];
  let current = "";
  let hasCurrentWord = false;
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (escaped) {
      current += char;
      hasCurrentWord = true;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      if (quote === "'") {
        current += char;
      } else {
        escaped = true;
      }
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
        hasCurrentWord = true;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      hasCurrentWord = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (hasCurrentWord) {
        words.push(current);
        current = "";
        hasCurrentWord = false;
      }
      continue;
    }

    current += char;
    hasCurrentWord = true;
  }

  if (escaped || quote) return null;
  if (hasCurrentWord) words.push(current);
  return words;
}

function normalizeShellName(shellPathOrName: string): string | null {
  const basename = shellPathOrName.split(/[\\/]/).at(-1)?.toLowerCase();
  if (!basename) return null;
  if (basename.endsWith(".exe")) return basename.slice(0, -4);
  return basename;
}

function extractBashLikeScript(words: string[]): string | null {
  if (words.length !== 3) return null;
  const shellName = normalizeShellName(words[0]);
  if (!shellName || !BASH_LIKE_SHELLS.has(shellName)) return null;
  const flag = words[1];
  if (flag !== "-lc" && flag !== "-c") return null;
  return words[2];
}

function extractPowerShellScript(words: string[]): string | null {
  if (words.length < 3) return null;
  const shellName = normalizeShellName(words[0]);
  if (!shellName || !POWERSHELL_SHELLS.has(shellName)) return null;

  let index = 1;
  while (index + 1 < words.length) {
    const flag = words[index]?.toLowerCase();
    if (!flag || !POWERSHELL_FLAGS.has(flag)) return null;
    if (flag === "-command" || flag === "-c") {
      return words[index + 1] ?? null;
    }
    index += 1;
  }

  return null;
}

export function getDisplayCommand(command: string): string {
  const trimmed = command.trim();
  if (trimmed.length === 0) return command;

  const words = splitShellWords(trimmed);
  if (!words || words.length === 0) return trimmed;

  return extractBashLikeScript(words) ?? extractPowerShellScript(words) ?? trimmed;
}

function quoteShellWord(value: string): string {
  if (value === "") return "''";
  if (!/[^\w@%\-+=:,./]/.test(value)) return value;
  return `'${value.replace(/('+)/g, "'\"$1\"'")}'`.replace(/^''|''$/g, "");
}

function quoteExecPolicyWord(value: string): string {
  if (/^[A-Za-z0-9_@+=:,./-]+$/.test(value)) return value;
  if (!/[`$\\!]/.test(value) && !value.includes('"')) return `"${value}"`;
  return quoteShellWord(value);
}

export function formatCodexExecPolicyAmendmentCommand(
  amendment: readonly string[] | null | undefined,
): string | null {
  if (!amendment || amendment.length === 0) return null;
  const command = amendment.map(quoteExecPolicyWord).join(" ").trim();
  return command.length > 0 ? command : null;
}

export function formatCodexExecPolicyAmendmentMenuSummary(
  amendment: readonly string[] | null | undefined,
): string | null {
  const command = formatCodexExecPolicyAmendmentCommand(amendment);
  if (!command || command.includes("\n") || command.includes("\r")) return null;
  return command;
}

function getCommandActionCommands(
  actions: readonly CodexCommandAction[] | null | undefined,
): string[] {
  if (!actions) return [];
  return actions.map((action) => action.command.trim()).filter((command) => command.length > 0);
}

export function buildCodexCommandApprovalPreview(
  request: Pick<
    CodexApprovalRequest,
    "cmd" | "command" | "commandActions" | "networkApprovalContext" | "proposedExecpolicyAmendment"
  >,
): CodexCommandApprovalPreview | null {
  const host = request.networkApprovalContext?.host?.trim();
  if (host) {
    return {
      kind: "network",
      host,
      reason: `Reason: ${host} isn't on the current network allowlist`,
    };
  }

  const commandActionCommands = getCommandActionCommands(request.commandActions);
  const commandFromActions =
    commandActionCommands.length > 0 ? commandActionCommands.join(" && ") : null;
  const commandFromRequest = request.command?.trim() || null;
  const commandFromAmendment = formatCodexExecPolicyAmendmentCommand(
    request.proposedExecpolicyAmendment,
  );
  const commandFromLegacyArgs = request.cmd?.join(" ").trim() || null;
  const commandText =
    commandFromActions ?? commandFromRequest ?? commandFromAmendment ?? commandFromLegacyArgs;

  if (!commandText) return null;

  return {
    kind: "command",
    commandText: getDisplayCommand(commandText),
  };
}
