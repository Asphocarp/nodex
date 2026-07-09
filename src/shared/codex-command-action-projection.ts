import type { CodexCommandAction, CodexParsedCommand } from "./types";

export function projectCodexParsedCommand(
  action: CodexCommandAction,
  isFinished: boolean,
): CodexParsedCommand {
  switch (action.type) {
    case "read":
      return {
        type: "read",
        cmd: action.command,
        name: action.name,
        path: action.path,
        isFinished,
      };
    case "listFiles":
      return {
        type: "list_files",
        cmd: action.command,
        path: action.path,
        isFinished,
      };
    case "search":
      return {
        type: "search",
        cmd: action.command,
        query: action.query,
        path: action.path,
        isFinished,
      };
    case "unknown":
      return {
        type: "unknown",
        cmd: action.command,
        isFinished,
      };
  }
}
