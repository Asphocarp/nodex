import type { ThreadBackgroundTerminal } from "@nodex/codex-app-server-protocol/v2/ThreadBackgroundTerminal";
import type {
  CodexBackgroundProcessRecord,
  CodexBackgroundProcessRow,
  TerminalSessionSnapshot,
} from "../../shared/types";

function readLiveOsPid(
  record: CodexBackgroundProcessRecord,
  terminal: ThreadBackgroundTerminal | null,
  terminalSession: TerminalSessionSnapshot | null,
): number | null {
  if (terminal) return terminal.osPid;
  if (terminalSession) return terminalSession.osPid;
  return record.osPid;
}

function isTerminalSessionProcessRunning(terminalSession: TerminalSessionSnapshot | null): boolean {
  if (!terminalSession) return false;
  if (
    terminalSession.processMetricsSampledAtMs !== null &&
    terminalSession.childProcessCount === 0
  ) {
    return false;
  }
  return true;
}

export function buildCodexBackgroundProcessRow(input: {
  record: CodexBackgroundProcessRecord;
  terminal: ThreadBackgroundTerminal | null;
  terminalSession: TerminalSessionSnapshot | null;
}): CodexBackgroundProcessRow {
  const terminalSession = input.terminalSession?.exited ? null : input.terminalSession;
  const hasRunningTerminalSessionProcess = isTerminalSessionProcessRunning(terminalSession);
  return {
    ...input.record,
    osPid: readLiveOsPid(input.record, input.terminal, terminalSession),
    status: input.terminal || hasRunningTerminalSessionProcess ? "running" : "not-found",
    terminal: input.terminal,
    terminalSession,
  };
}
