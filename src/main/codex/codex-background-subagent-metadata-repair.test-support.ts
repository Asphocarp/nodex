import type { CodexBackgroundSubagentMetadataRepair } from "../codex-application/CodexBackgroundSubagentMetadataRepair";

type CodexBackgroundSubagentMetadataRepairService =
  CodexBackgroundSubagentMetadataRepair["Service"];

export interface TestCodexBackgroundSubagentMetadataRepairOptions {
  readonly isRepairNeeded: (parentThreadId: string, childThreadId: string) => boolean;
  readonly repair: (parentThreadId: string, childThreadId: string) => Promise<boolean>;
}

/** Mutable vertical harness used only by the legacy CodexService test suite. */
export class TestCodexBackgroundSubagentMetadataRepair implements CodexBackgroundSubagentMetadataRepairService {
  private readonly active = new Set<string>();
  private readonly completed = new Set<string>();

  constructor(private readonly options: TestCodexBackgroundSubagentMetadataRepairOptions) {}

  request(parentThreadId: string, childThreadIds: readonly string[]): void {
    for (const childThreadId of childThreadIds) {
      if (this.active.has(childThreadId) || this.completed.has(childThreadId)) continue;
      if (!this.options.isRepairNeeded(parentThreadId, childThreadId)) continue;
      this.active.add(childThreadId);
      void this.options
        .repair(parentThreadId, childThreadId)
        .then((isComplete) => {
          if (isComplete) this.completed.add(childThreadId);
        })
        .catch(() => undefined)
        .finally(() => {
          this.active.delete(childThreadId);
        });
    }
  }

  clear(childThreadId: string): void {
    this.active.delete(childThreadId);
    this.completed.delete(childThreadId);
  }
}
