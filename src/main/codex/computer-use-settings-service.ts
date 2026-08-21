import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ConfigRequirementsReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigRequirementsReadResponse";
import {
  isComputerUseSoundMode,
  type ComputerUseApprovedApp,
  type ComputerUseApprovedMessageThread,
  type ComputerUseSettingsSnapshot,
  type ComputerUseSoundMode,
} from "../../shared/computer-use-settings";
import type { ComputerUseRuntimeResult } from "./computer-use-runtime";

const execFileAsync = promisify(execFile);
const COMPUTER_USE_APP_APPROVALS_FILENAME = "ComputerUseAppApprovals.json";
const COMPUTER_USE_MESSAGES_APPROVALS_FILENAME = "MessagesSendApprovals.json";
const COMPUTER_USE_GROUP_CONTAINER = "2DC432GLL2.com.openai.sky.CUAService";
const COMPUTER_USE_DEFAULTS_DOMAIN = "com.openai.sky.CUAService";
const COMPUTER_USE_SOUND_MODE_KEY = "computerUseSoundMode";
const DEFAULT_SOUND_MODE: ComputerUseSoundMode = "foregroundClicks";
const LOCKED_USE_INSTALLER_RELATIVE_PATH = path.join(
  "Contents",
  "SharedSupport",
  "Codex Computer Use Installer.app",
  "Contents",
  "MacOS",
  "Codex Computer Use Installer",
);

type ComputerUseSettingsServiceOptions = {
  alwaysHidePictureInPicture: {
    get(): boolean;
    set(value: boolean): void;
  };
  exec?: typeof execFileAsync;
  getRuntimeResult: () =>
    | ComputerUseRuntimeResult
    | null
    | Promise<ComputerUseRuntimeResult | null>;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
  readConfigRequirements: () => Promise<ConfigRequirementsReadResponse>;
};

type AppApprovalsFile = {
  approvedBundleIdentifiers: string[];
};

type MessagesApprovalsFile = {
  approvedChats: Record<string, string>;
};

function normalizedUniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values.flatMap((value) => {
        if (typeof value !== "string") return [];
        const normalized = value.trim();
        return normalized ? [normalized] : [];
      }),
    ),
  ];
}

function parseAppApprovals(value: unknown): AppApprovalsFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { approvedBundleIdentifiers: [] };
  }
  return {
    approvedBundleIdentifiers: normalizedUniqueStrings(
      Reflect.get(value, "approvedBundleIdentifiers"),
    ),
  };
}

function parseMessagesApprovals(value: unknown): MessagesApprovalsFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { approvedChats: {} };
  }
  const candidate = Reflect.get(value, "approvedChats");
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { approvedChats: {} };
  }
  const approvedChats: Record<string, string> = {};
  for (const [rawGuid, rawDisplayName] of Object.entries(candidate)) {
    const chatGuid = rawGuid.trim();
    const displayName = typeof rawDisplayName === "string" ? rawDisplayName.trim() : "";
    if (!chatGuid || !displayName) continue;
    approvedChats[chatGuid] = displayName;
  }
  return { approvedChats };
}

async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeJsonFileAtomically(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 1_024) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

export class ComputerUseSettingsService {
  private readonly exec: typeof execFileAsync;
  private readonly homeDirectory: string;
  private readonly options: ComputerUseSettingsServiceOptions;
  private readonly platform: NodeJS.Platform;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: ComputerUseSettingsServiceOptions) {
    this.options = options;
    this.exec = options.exec ?? execFileAsync;
    this.homeDirectory = options.homeDirectory ?? homedir();
    this.platform = options.platform ?? process.platform;
  }

  async getSnapshot(): Promise<ComputerUseSettingsSnapshot> {
    const runtime = await this.options.getRuntimeResult();
    const available = runtime?.status === "available";
    const [approvedApps, approvedMessageThreads, soundMode, lockedUseAllowed] = await Promise.all([
      this.readApprovedApps(),
      this.readApprovedMessageThreads(),
      this.readSoundMode(),
      available ? this.readLockedUseAllowed() : Promise.resolve(false),
    ]);
    const lockedUseEnabled =
      lockedUseAllowed && runtime?.status === "available"
        ? await this.readLockedUseEnabled(runtime.appPath)
        : null;
    return {
      alwaysHidePictureInPicture: this.options.alwaysHidePictureInPicture.get(),
      approvedApps,
      approvedMessageThreads,
      available,
      lockedUseAllowed,
      lockedUseEnabled,
      message:
        runtime?.status === "unavailable"
          ? runtime.message
          : runtime === null
            ? "Computer Use runtime is still starting"
            : null,
      soundMode,
    };
  }

  async removeAppApproval(bundleIdentifier: string): Promise<ComputerUseSettingsSnapshot> {
    const identifier = requireIdentifier(bundleIdentifier, "Bundle identifier");
    return await this.serializeMutation(async () => {
      const current = parseAppApprovals(await readJsonFile(this.appApprovalsPath));
      await writeJsonFileAtomically(this.appApprovalsPath, {
        approvedBundleIdentifiers: current.approvedBundleIdentifiers.filter(
          (entry) => entry !== identifier,
        ),
      });
      return await this.getSnapshot();
    });
  }

  async removeMessageApproval(chatGuid: string): Promise<ComputerUseSettingsSnapshot> {
    const identifier = requireIdentifier(chatGuid, "Message thread identifier");
    return await this.serializeMutation(async () => {
      const current = parseMessagesApprovals(await readJsonFile(this.messagesApprovalsPath));
      const approvedChats = Object.fromEntries(
        Object.entries(current.approvedChats).filter(([entry]) => entry !== identifier),
      );
      await writeJsonFileAtomically(this.messagesApprovalsPath, { approvedChats });
      return await this.getSnapshot();
    });
  }

  async setAlwaysHidePictureInPicture(value: boolean): Promise<ComputerUseSettingsSnapshot> {
    return await this.serializeMutation(async () => {
      this.options.alwaysHidePictureInPicture.set(value);
      return await this.getSnapshot();
    });
  }

  async setLockedUseEnabled(value: boolean): Promise<ComputerUseSettingsSnapshot> {
    return await this.serializeMutation(async () => {
      const runtime = await this.options.getRuntimeResult();
      if (runtime?.status !== "available") {
        throw new Error("Computer Use is unavailable");
      }
      if (!(await this.readLockedUseAllowed())) {
        throw new Error("Locked use is disabled by configuration requirements");
      }
      await this.exec(
        this.resolveLockedUseInstallerPath(runtime.appPath),
        [value ? "install" : "uninstall"],
        { timeout: 120_000 },
      );
      return await this.getSnapshot();
    });
  }

  async setSoundMode(value: ComputerUseSoundMode): Promise<ComputerUseSettingsSnapshot> {
    if (!isComputerUseSoundMode(value)) {
      throw new Error("Computer Use sound mode is invalid");
    }
    return await this.serializeMutation(async () => {
      if (this.platform === "darwin") {
        await this.exec("/usr/bin/defaults", [
          "write",
          COMPUTER_USE_DEFAULTS_DOMAIN,
          COMPUTER_USE_SOUND_MODE_KEY,
          value,
        ]);
      }
      return await this.getSnapshot();
    });
  }

  private async serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.mutationQueue.then(operation, operation);
    this.mutationQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return await pending;
  }

  private get groupContainerApplicationSupportPath(): string {
    return path.join(
      this.homeDirectory,
      "Library",
      "Group Containers",
      COMPUTER_USE_GROUP_CONTAINER,
      "Library",
      "Application Support",
      "Software",
    );
  }

  private get appApprovalsPath(): string {
    return path.join(
      this.groupContainerApplicationSupportPath,
      COMPUTER_USE_APP_APPROVALS_FILENAME,
    );
  }

  private get messagesApprovalsPath(): string {
    return path.join(
      this.groupContainerApplicationSupportPath,
      COMPUTER_USE_MESSAGES_APPROVALS_FILENAME,
    );
  }

  private async readApprovedApps(): Promise<ComputerUseApprovedApp[]> {
    const approvals = parseAppApprovals(await readJsonFile(this.appApprovalsPath));
    return approvals.approvedBundleIdentifiers.map((bundleIdentifier) => ({
      bundleIdentifier,
      displayName: bundleIdentifier,
    }));
  }

  private async readApprovedMessageThreads(): Promise<ComputerUseApprovedMessageThread[]> {
    const approvals = parseMessagesApprovals(await readJsonFile(this.messagesApprovalsPath));
    return Object.entries(approvals.approvedChats)
      .map(([chatGuid, displayName]) => ({ chatGuid, displayName }))
      .sort(
        (left, right) =>
          left.displayName.localeCompare(right.displayName) ||
          left.chatGuid.localeCompare(right.chatGuid),
      );
  }

  private async readSoundMode(): Promise<ComputerUseSoundMode> {
    if (this.platform !== "darwin") return DEFAULT_SOUND_MODE;
    try {
      const { stdout } = await this.exec("/usr/bin/defaults", [
        "read",
        COMPUTER_USE_DEFAULTS_DOMAIN,
        COMPUTER_USE_SOUND_MODE_KEY,
      ]);
      const value = stdout.trim();
      return isComputerUseSoundMode(value) ? value : DEFAULT_SOUND_MODE;
    } catch {
      return DEFAULT_SOUND_MODE;
    }
  }

  private async readLockedUseAllowed(): Promise<boolean> {
    try {
      const response = await this.options.readConfigRequirements();
      return response.requirements?.computerUse?.allowLockedComputerUse === true;
    } catch {
      return false;
    }
  }

  private async readLockedUseEnabled(appPath: string): Promise<boolean> {
    if (this.platform !== "darwin") return false;
    try {
      const { stdout } = await this.exec(this.resolveLockedUseInstallerPath(appPath), ["status"], {
        timeout: 120_000,
      });
      return stdout.trim() === "OK: installed";
    } catch {
      return false;
    }
  }

  private resolveLockedUseInstallerPath(appPath: string): string {
    return path.join(appPath, LOCKED_USE_INSTALLER_RELATIVE_PATH);
  }
}
