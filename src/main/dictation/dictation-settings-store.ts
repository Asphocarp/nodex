import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_DICTATION_SETTINGS,
  type DictationSettings,
  type DictationSettingsPatch,
} from "../../shared/dictation";
import { isMissingPathError, writeDurableJson } from "../durable-json-file";

const SETTINGS_FILE_NAME = "dictation-settings.json";
const MAX_SETTINGS_BYTES = 64 * 1024;
const PATCH_KEYS = new Set<keyof DictationSettings>([
  "microphoneInputDeviceId",
  "keepGlobalBarVisible",
  "playStartSound",
  "playStopSound",
  "globalShortcutNudgeDismissed",
]);

const parseSettings = (value: unknown): DictationSettings => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Dictation settings must be an object");
  }
  const input = value as Record<string, unknown>;
  const microphoneInputDeviceId = input.microphoneInputDeviceId;
  const keepGlobalBarVisible = input.keepGlobalBarVisible;
  const playStartSound = input.playStartSound;
  const playStopSound = input.playStopSound;
  const globalShortcutNudgeDismissed = input.globalShortcutNudgeDismissed ?? false;
  if (microphoneInputDeviceId !== null && typeof microphoneInputDeviceId !== "string") {
    throw new Error("Dictation microphone selection is invalid");
  }
  if (
    typeof keepGlobalBarVisible !== "boolean" ||
    typeof playStartSound !== "boolean" ||
    typeof playStopSound !== "boolean" ||
    typeof globalShortcutNudgeDismissed !== "boolean"
  ) {
    throw new Error("Dictation settings flags are invalid");
  }
  return {
    microphoneInputDeviceId,
    keepGlobalBarVisible,
    playStartSound,
    playStopSound,
    globalShortcutNudgeDismissed,
  };
};

export const parseDictationSettingsPatch = (value: unknown): DictationSettingsPatch => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Dictation settings update must be an object");
  }
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!PATCH_KEYS.has(key as keyof DictationSettings)) {
      throw new Error(`Unknown dictation setting: ${key}`);
    }
  }
  if (
    "microphoneInputDeviceId" in input &&
    input.microphoneInputDeviceId !== null &&
    typeof input.microphoneInputDeviceId !== "string"
  ) {
    throw new Error("Dictation microphone selection is invalid");
  }
  for (const key of [
    "keepGlobalBarVisible",
    "playStartSound",
    "playStopSound",
    "globalShortcutNudgeDismissed",
  ] as const) {
    if (key in input && typeof input[key] !== "boolean") {
      throw new Error(`Dictation setting ${key} must be a boolean`);
    }
  }
  return input as DictationSettingsPatch;
};

export class DictationSettingsStore {
  readonly #filePath: string;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(userDataPath: string) {
    this.#filePath = join(userDataPath, SETTINGS_FILE_NAME);
  }

  read(): Promise<DictationSettings> {
    return this.#serialize(() => this.#readCurrent());
  }

  update(value: unknown): Promise<DictationSettings> {
    const patch = parseDictationSettingsPatch(value);
    return this.#serialize(async () => {
      const next = { ...(await this.#readCurrent()), ...patch };
      await writeDurableJson(this.#filePath, next, MAX_SETTINGS_BYTES);
      return next;
    });
  }

  consumeGlobalShortcutNudge(): Promise<boolean> {
    return this.#serialize(async () => {
      const current = await this.#readCurrent();
      if (current.globalShortcutNudgeDismissed) return false;
      await writeDurableJson(
        this.#filePath,
        { ...current, globalShortcutNudgeDismissed: true },
        MAX_SETTINGS_BYTES,
      );
      return true;
    });
  }

  async #readCurrent(): Promise<DictationSettings> {
    try {
      const metadata = await lstat(this.#filePath);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new Error("Dictation settings path is not a regular file");
      }
      if (metadata.size > MAX_SETTINGS_BYTES) {
        throw new Error("Dictation settings exceed the size limit");
      }
      return parseSettings(JSON.parse(await readFile(this.#filePath, "utf8")));
    } catch (error) {
      if (isMissingPathError(error)) return DEFAULT_DICTATION_SETTINGS;
      throw error;
    }
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation);
    this.#queue = result.catch(() => undefined);
    return result;
  }
}
