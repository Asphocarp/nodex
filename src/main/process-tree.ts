import type { ChildProcess } from "node:child_process";

export function killChildProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (process.platform !== "win32" && pid !== undefined) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // The process group may already be gone or may not have been created.
    }
  }
  child.kill(signal);
}
