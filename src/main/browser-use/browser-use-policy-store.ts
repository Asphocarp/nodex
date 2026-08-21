import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import {
  DEFAULT_BROWSER_USE_POLICY,
  BrowserUsePolicyModesUpdateSchema,
  BrowserUseOriginRuleUpdateSchema,
  normalizeBrowserUsePolicyOrigin,
  type BrowserUseOriginRuleUpdate,
  type BrowserUsePolicyModesUpdate,
  type BrowserUsePolicyResource,
  type BrowserUsePolicySnapshot,
} from "../../shared/browser-use-policy";

const MAX_POLICY_FILE_BYTES = 256 * 1024;
const MAX_ORIGIN_RULES = 1_000;

type UnknownRecord = Record<string, unknown>;

const TABLE_BY_RESOURCE: Record<BrowserUsePolicyResource, string> = {
  origin: "origins",
  download: "downloads",
  upload: "uploads",
  fullCdp: "full_cdp",
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    try {
      const origin = normalizeBrowserUsePolicyOrigin(entry);
      if (seen.has(origin)) continue;
      seen.add(origin);
      result.push(origin);
    } catch {
      // Invalid rules are ignored and disappear on the next user mutation.
    }
    if (result.length >= MAX_ORIGIN_RULES) break;
  }
  return result;
}

function readApprovalMode(value: unknown): "alwaysAsk" | "neverAsk" {
  return value === "never_ask" ? "neverAsk" : "alwaysAsk";
}

function writeApprovalMode(value: "alwaysAsk" | "neverAsk"): string {
  return value === "neverAsk" ? "never_ask" : "always_ask";
}

function readRuleTable(
  config: UnknownRecord,
  resource: BrowserUsePolicyResource,
): { allowed: string[]; denied: string[] } {
  const table = config[TABLE_BY_RESOURCE[resource]];
  if (!isRecord(table)) return { allowed: [], denied: [] };
  return {
    allowed: readStringArray(table.allowed),
    denied: readStringArray(table.denied),
  };
}

function projectSnapshot(config: UnknownRecord): BrowserUsePolicySnapshot {
  const origins = readRuleTable(config, "origin");
  const downloads = readRuleTable(config, "download");
  const uploads = readRuleTable(config, "upload");
  const fullCdp = readRuleTable(config, "fullCdp");
  return {
    fullCdpAccessEnabled: config.full_cdp_access_enabled === true,
    approvalMode: readApprovalMode(config.approval_mode),
    historyApprovalMode: readApprovalMode(config.history_approval_mode),
    downloadApprovalMode: readApprovalMode(config.download_approval_mode),
    uploadApprovalMode: readApprovalMode(config.upload_approval_mode),
    allowedOrigins: origins.allowed,
    deniedOrigins: origins.denied,
    allowedDownloadOrigins: downloads.allowed,
    deniedDownloadOrigins: downloads.denied,
    allowedUploadOrigins: uploads.allowed,
    deniedUploadOrigins: uploads.denied,
    allowedFullCdpOrigins: fullCdp.allowed,
    deniedFullCdpOrigins: fullCdp.denied,
  };
}

export interface BrowserUsePolicyReader {
  snapshot(): BrowserUsePolicySnapshot;
  isExplicitlyDenied(resource: BrowserUsePolicyResource, urlOrOrigin: string): boolean;
}

export class BrowserUsePolicyStore implements BrowserUsePolicyReader {
  private config: UnknownRecord = {};
  private current = DEFAULT_BROWSER_USE_POLICY;
  private initialized = false;
  private writeQueue = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly now: () => number = Date.now,
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const raw = await readFile(this.filePath, "utf8");
      if (Buffer.byteLength(raw, "utf8") > MAX_POLICY_FILE_BYTES) {
        throw new Error("Browser Use policy file exceeds its size limit");
      }
      const parsed = parseToml(raw);
      if (!isRecord(parsed)) throw new Error("Browser Use policy root is invalid");
      this.config = parsed;
      this.current = projectSnapshot(parsed);
    } catch (error) {
      if (isMissingFileError(error)) return;
      await this.quarantine();
      this.config = {};
      this.current = DEFAULT_BROWSER_USE_POLICY;
    }
  }

  snapshot(): BrowserUsePolicySnapshot {
    return {
      ...this.current,
      allowedOrigins: [...this.current.allowedOrigins],
      deniedOrigins: [...this.current.deniedOrigins],
      allowedDownloadOrigins: [...this.current.allowedDownloadOrigins],
      deniedDownloadOrigins: [...this.current.deniedDownloadOrigins],
      allowedUploadOrigins: [...this.current.allowedUploadOrigins],
      deniedUploadOrigins: [...this.current.deniedUploadOrigins],
      allowedFullCdpOrigins: [...this.current.allowedFullCdpOrigins],
      deniedFullCdpOrigins: [...this.current.deniedFullCdpOrigins],
    };
  }

  isExplicitlyDenied(resource: BrowserUsePolicyResource, urlOrOrigin: string): boolean {
    let origin: string;
    try {
      origin = normalizeBrowserUsePolicyOrigin(urlOrOrigin);
    } catch {
      return true;
    }
    const originDenied = this.current.deniedOrigins.includes(origin);
    if (resource === "origin") return originDenied;
    const denied = {
      download: this.current.deniedDownloadOrigins,
      upload: this.current.deniedUploadOrigins,
      fullCdp: this.current.deniedFullCdpOrigins,
    }[resource];
    return originDenied || denied.includes(origin);
  }

  async updateModes(rawUpdate: BrowserUsePolicyModesUpdate): Promise<BrowserUsePolicySnapshot> {
    await this.initialize();
    const update = BrowserUsePolicyModesUpdateSchema.parse(rawUpdate);
    if (update.approvalMode !== undefined) {
      this.config.approval_mode = writeApprovalMode(update.approvalMode);
    }
    if (update.historyApprovalMode !== undefined) {
      this.config.history_approval_mode = writeApprovalMode(update.historyApprovalMode);
    }
    if (update.downloadApprovalMode !== undefined) {
      this.config.download_approval_mode = writeApprovalMode(update.downloadApprovalMode);
    }
    if (update.uploadApprovalMode !== undefined) {
      this.config.upload_approval_mode = writeApprovalMode(update.uploadApprovalMode);
    }
    if (update.fullCdpAccessEnabled !== undefined) {
      this.config.full_cdp_access_enabled = update.fullCdpAccessEnabled;
    }
    this.current = projectSnapshot(this.config);
    await this.persist();
    return this.snapshot();
  }

  async updateOriginRule(rawUpdate: BrowserUseOriginRuleUpdate): Promise<BrowserUsePolicySnapshot> {
    await this.initialize();
    const update = BrowserUseOriginRuleUpdateSchema.parse(rawUpdate);
    const origin = normalizeBrowserUsePolicyOrigin(update.origin);
    const tableName = TABLE_BY_RESOURCE[update.resource];
    const table = isRecord(this.config[tableName]) ? this.config[tableName] : {};
    this.config[tableName] = table;
    const selected = readStringArray(table[update.kind]);
    if (update.action === "remove") {
      table[update.kind] = selected.filter((entry) => entry !== origin);
    } else {
      const oppositeKind = update.kind === "allowed" ? "denied" : "allowed";
      const opposite = readStringArray(table[oppositeKind]);
      table[update.kind] = selected.includes(origin)
        ? selected
        : [...selected, origin].slice(0, MAX_ORIGIN_RULES);
      table[oppositeKind] = opposite.filter((entry) => entry !== origin);
    }
    this.current = projectSnapshot(this.config);
    await this.persist();
    return this.snapshot();
  }

  private async persist(): Promise<void> {
    const write = async () => {
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
      const payload = stringifyToml(this.config);
      const normalizedPayload = payload.endsWith("\n") ? payload : `${payload}\n`;
      if (Buffer.byteLength(normalizedPayload, "utf8") > MAX_POLICY_FILE_BYTES) {
        throw new Error("Browser Use policy file exceeds its size limit");
      }
      const temporaryPath = join(
        dirname(this.filePath),
        `.${basename(this.filePath)}.${process.pid}.${this.now()}.tmp`,
      );
      const handle = await open(temporaryPath, "wx", 0o600);
      try {
        await handle.writeFile(normalizedPayload, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await rename(temporaryPath, this.filePath);
        const directory = await open(dirname(this.filePath), "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      } finally {
        await rm(temporaryPath, { force: true });
      }
    };
    this.writeQueue = this.writeQueue.then(write, write);
    await this.writeQueue;
  }

  private async quarantine(): Promise<void> {
    try {
      await rename(this.filePath, `${this.filePath}.corrupt-${this.now()}`);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
