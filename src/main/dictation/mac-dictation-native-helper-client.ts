import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const MAXIMUM_LINE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const READY_TIMEOUT_MS = 3_000;

export interface MacDictationForegroundTarget {
  readonly pid: number;
  readonly bundleIdentifier: string;
}

export type MacDictationHelperEvent =
  | {
      readonly type: "pressed" | "released";
      readonly bindingId: string;
      readonly mode: "hold" | "toggle";
      readonly generation: number;
      readonly target?: MacDictationForegroundTarget;
    }
  | { readonly type: "crashed" };

export interface MacDictationCapabilities {
  readonly inputMonitoring: boolean;
  readonly accessibility: boolean;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

export const resolveMacDictationHelperExecutable = (input: {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly repositoryRoot?: string;
}): string =>
  input.isPackaged
    ? join(input.resourcesPath, "bin/nodex-dictation-helper")
    : resolve(
        input.repositoryRoot ?? process.cwd(),
        ".generated/dev-runtime/bin/nodex-dictation-helper",
      );

export class MacDictationNativeHelperClient {
  readonly #executablePath: string;
  readonly #validateArchitecture: boolean;
  readonly #listeners = new Set<(event: MacDictationHelperEvent) => void>();
  readonly #pending = new Map<string, PendingRequest>();
  #child: ChildProcessWithoutNullStreams | null = null;
  #stdoutBuffer = "";
  #ready: Promise<void> | null = null;
  #resolveReady: (() => void) | null = null;
  #rejectReady: ((error: Error) => void) | null = null;
  #readyTimer: ReturnType<typeof setTimeout> | null = null;
  #crashTimestamps: number[] = [];

  constructor(executablePath: string, options: { readonly validateArchitecture?: boolean } = {}) {
    this.#executablePath = executablePath;
    this.#validateArchitecture = options.validateArchitecture ?? true;
  }

  subscribe(listener: (event: MacDictationHelperEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async capabilities(_prompt = false): Promise<MacDictationCapabilities> {
    const value = (await this.#request("capabilities", {})) as Record<string, unknown>;
    if (typeof value?.inputMonitoring !== "boolean" || typeof value.accessibility !== "boolean") {
      throw new Error("Invalid dictation helper capabilities");
    }
    return { inputMonitoring: value.inputMonitoring, accessibility: value.accessibility };
  }

  async requestInputMonitoring(): Promise<boolean> {
    return await this.#requestGranted("requestInputMonitoring");
  }

  async requestAccessibility(): Promise<boolean> {
    return await this.#requestGranted("requestAccessibility");
  }

  async register(input: {
    readonly bindingId: string;
    readonly mode: "hold" | "toggle";
    readonly accelerator: string;
  }): Promise<void> {
    await this.#request("register", input);
  }

  async unregister(bindingId: string): Promise<void> {
    await this.#request("unregister", { bindingId });
  }

  async capture(): Promise<string> {
    const value = (await this.#request("capture", {})) as { readonly accelerator?: unknown };
    if (typeof value.accelerator !== "string") throw new Error("Invalid captured hotkey");
    return value.accelerator;
  }

  async safePaste(text: string, target: MacDictationForegroundTarget): Promise<void> {
    await this.#request("safePaste", { text, target });
  }

  async queryBuiltInMicrophoneName(): Promise<string | null> {
    const value = await this.#request("queryBuiltInMic", {});
    if (value === null) return null;
    if (typeof value !== "string") throw new Error("Invalid built-in microphone name");
    return value;
  }

  async #requestGranted(type: string): Promise<boolean> {
    const value = (await this.#request(type, {})) as Record<string, unknown>;
    if (typeof value?.granted !== "boolean") throw new Error("Invalid dictation permission result");
    return value.granted;
  }

  dispose(): void {
    const child = this.#child;
    this.#child = null;
    child?.kill();
    this.#rejectPending(new Error("Dictation helper was disposed"));
    this.#rejectReady?.(new Error("Dictation helper was disposed"));
    this.#rejectReady = null;
    if (this.#readyTimer) clearTimeout(this.#readyTimer);
    this.#readyTimer = null;
    this.#listeners.clear();
  }

  async #request(type: string, payload: Record<string, unknown>): Promise<unknown> {
    await this.#ensureStarted();
    const child = this.#child;
    if (!child) throw new Error("Dictation helper is unavailable");
    const id = randomUUID();
    return await new Promise((resolveRequest, rejectRequest) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        rejectRequest(new Error(`Dictation helper ${type} request timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timeout });
      child.stdin.write(`${JSON.stringify({ id, type, ...payload })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timeout);
        this.#pending.delete(id);
        rejectRequest(error);
      });
    });
  }

  async #ensureStarted(): Promise<void> {
    if (this.#child && this.#ready) return await this.#ready;
    const now = Date.now();
    this.#crashTimestamps = this.#crashTimestamps.filter((time) => now - time < 60_000);
    if (this.#crashTimestamps.length >= 3) {
      throw new Error("Dictation helper restart limit reached");
    }
    const metadata = lstatSync(this.#executablePath);
    if (metadata.isSymbolicLink() || !metadata.isFile() || (metadata.mode & 0o111) === 0) {
      throw new Error("Dictation helper is not a regular executable");
    }
    if (this.#validateArchitecture && process.platform === "darwin") {
      const architectures = execFileSync("/usr/bin/lipo", ["-archs", this.#executablePath], {
        encoding: "utf8",
      })
        .trim()
        .split(/\s+/);
      const expected = process.arch === "arm64" ? "arm64" : "x86_64";
      if (!architectures.includes(expected)) {
        throw new Error(`Dictation helper does not contain the ${expected} architecture`);
      }
    }
    const child = spawn(this.#executablePath, [], { stdio: ["pipe", "pipe", "pipe"] });
    this.#child = child;
    this.#ready = new Promise((resolveReady, rejectReady) => {
      this.#resolveReady = resolveReady;
      this.#rejectReady = rejectReady;
    });
    this.#readyTimer = setTimeout(() => {
      this.#rejectReady?.(new Error("Dictation helper did not become ready"));
      child.kill();
    }, READY_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.#readStdout(chunk));
    child.stderr.resume();
    child.once("exit", () => this.#handleExit(child));
    return await this.#ready;
  }

  #readStdout(chunk: string): void {
    this.#stdoutBuffer += chunk;
    if (Buffer.byteLength(this.#stdoutBuffer, "utf8") > MAXIMUM_LINE_BYTES * 2) {
      this.#child?.kill();
      return;
    }
    let newline = this.#stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.#stdoutBuffer.slice(0, newline);
      this.#stdoutBuffer = this.#stdoutBuffer.slice(newline + 1);
      this.#handleLine(line);
      newline = this.#stdoutBuffer.indexOf("\n");
    }
  }

  #handleLine(line: string): void {
    if (!line || Buffer.byteLength(line, "utf8") > MAXIMUM_LINE_BYTES) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.type === "ready" && message.protocolVersion === 1) {
      this.#resolveReady?.();
      this.#resolveReady = null;
      this.#rejectReady = null;
      if (this.#readyTimer) clearTimeout(this.#readyTimer);
      this.#readyTimer = null;
      return;
    }
    if (message.type === "response" && typeof message.id === "string") {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.#pending.delete(message.id);
      if (message.ok === true) pending.resolve(message.value);
      else pending.reject(new Error(String(message.error ?? "Dictation helper request failed")));
      return;
    }
    if (
      (message.type === "pressed" || message.type === "released") &&
      typeof message.bindingId === "string" &&
      (message.mode === "hold" || message.mode === "toggle") &&
      typeof message.generation === "number"
    ) {
      const targetValue = message.target as Record<string, unknown> | undefined;
      const target =
        targetValue &&
        typeof targetValue.pid === "number" &&
        typeof targetValue.bundleIdentifier === "string"
          ? { pid: targetValue.pid, bundleIdentifier: targetValue.bundleIdentifier }
          : undefined;
      this.#emit({
        type: message.type,
        bindingId: message.bindingId,
        mode: message.mode,
        generation: message.generation,
        ...(target ? { target } : {}),
      });
    }
  }

  #handleExit(child: ChildProcessWithoutNullStreams): void {
    if (this.#child !== child) return;
    this.#child = null;
    if (this.#readyTimer) clearTimeout(this.#readyTimer);
    this.#readyTimer = null;
    this.#rejectReady?.(new Error("Dictation helper exited before becoming ready"));
    this.#ready = null;
    this.#resolveReady = null;
    this.#rejectReady = null;
    this.#stdoutBuffer = "";
    this.#crashTimestamps.push(Date.now());
    this.#rejectPending(new Error("Dictation helper exited"));
    this.#emit({ type: "crashed" });
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #emit(event: MacDictationHelperEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
