import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  DEFAULT_BROWSER_LOCAL_SERVER_PREFERENCES,
  type BrowserLocalServerPreferences,
  type BrowserLocalServerPreferencesUpdate,
} from "../../shared/browser-sidebar";

const MAX_EXPANDED_PROJECTS = 1_000;

const BrowserLocalServerPreferencesSchema = z.object({
  schemaVersion: z.literal(1),
  showMode: z.enum(["online", "all", "hidden"]),
  sortMode: z.enum(["recently-used", "origin"]),
  expandedProjectIds: z.array(
    z.string().trim().min(1).max(512),
  ).max(MAX_EXPANDED_PROJECTS),
}).strict();

function normalizeExpandedProjectIds(
  values: readonly string[],
): string[] {
  return [...new Set(
    values
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && value.length <= 512),
  )].slice(-MAX_EXPANDED_PROJECTS);
}

export class BrowserLocalServerPreferencesStore {
  private readonly filePath: string;
  private preferences: BrowserLocalServerPreferences = {
    ...DEFAULT_BROWSER_LOCAL_SERVER_PREFERENCES,
    expandedProjectIds: [],
  };

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
    this.load();
  }

  snapshot(): BrowserLocalServerPreferences {
    return {
      ...this.preferences,
      expandedProjectIds: [...this.preferences.expandedProjectIds],
    };
  }

  update(
    input: BrowserLocalServerPreferencesUpdate,
  ): BrowserLocalServerPreferences {
    const next: BrowserLocalServerPreferences = {
      showMode: input.showMode ?? this.preferences.showMode,
      sortMode: input.sortMode ?? this.preferences.sortMode,
      expandedProjectIds: input.expandedProjectIds === undefined
        ? [...this.preferences.expandedProjectIds]
        : normalizeExpandedProjectIds(input.expandedProjectIds),
    };
    this.persist(next);
    this.preferences = next;
    return this.snapshot();
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const parsed = BrowserLocalServerPreferencesSchema.parse(
        JSON.parse(fs.readFileSync(this.filePath, "utf8")),
      );
      this.preferences = {
        showMode: parsed.showMode,
        sortMode: parsed.sortMode,
        expandedProjectIds: normalizeExpandedProjectIds(
          parsed.expandedProjectIds,
        ),
      };
    } catch {
      this.quarantineCorruptFile();
    }
  }

  private persist(preferences: BrowserLocalServerPreferences): void {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      fs.writeFileSync(
        temporaryPath,
        `${JSON.stringify({
          schemaVersion: 1,
          ...preferences,
        }, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      const descriptor = fs.openSync(temporaryPath, "r");
      try {
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      fs.renameSync(temporaryPath, this.filePath);
      try {
        const directoryDescriptor = fs.openSync(directory, "r");
        try {
          fs.fsyncSync(directoryDescriptor);
        } finally {
          fs.closeSync(directoryDescriptor);
        }
      } catch {
        // Directory fsync is unavailable on some platforms. The file itself is
        // already durable and valid.
      }
    } finally {
      if (fs.existsSync(temporaryPath)) {
        fs.rmSync(temporaryPath, { force: true });
      }
    }
  }

  private quarantineCorruptFile(): void {
    try {
      const corruptPath = `${this.filePath}.corrupt-${Date.now()}`;
      fs.renameSync(this.filePath, corruptPath);
    } catch {
      // Keep startup available even if the corrupt settings file cannot move.
    }
  }
}
