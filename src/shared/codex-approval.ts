import type { CodexApprovalKind } from "./types";

export type CodexApprovalRequestMethod =
  | "item/commandExecution/requestApproval"
  | "item/fileChange/requestApproval";

export function getCodexApprovalRequestMethod(
  kind: CodexApprovalKind,
): CodexApprovalRequestMethod {
  return kind === "command"
    ? "item/commandExecution/requestApproval"
    : "item/fileChange/requestApproval";
}

export function getCodexApprovalKindForRequestMethod(
  method: CodexApprovalRequestMethod,
): CodexApprovalKind {
  return method === "item/commandExecution/requestApproval" ? "command" : "file";
}
