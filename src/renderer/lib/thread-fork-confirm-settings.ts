const SKIP_FORK_FROM_OLDER_TURN_CONFIRM_STORAGE_KEY = "skip-fork-from-older-turn-confirm";

export function readSkipForkFromOlderTurnConfirm(): boolean {
  try {
    return localStorage.getItem(SKIP_FORK_FROM_OLDER_TURN_CONFIRM_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeSkipForkFromOlderTurnConfirm(value: boolean): void {
  try {
    localStorage.setItem(SKIP_FORK_FROM_OLDER_TURN_CONFIRM_STORAGE_KEY, value ? "true" : "false");
  } catch {
    // ignore localStorage failures
  }
}
