import type { TurnStartResponse } from "@nodex/codex-app-server-protocol/v2/TurnStartResponse";
import type { CodexRendererConversationResumeResult } from "../../shared/types";
import {
  type CodexFreshThreadLaunch,
  CodexFreshThreadLaunchError,
  type CodexFreshThreadLaunchIdentity,
  type CodexFreshThreadLaunchReservation,
} from "../codex-application/CodexFreshThreadLaunchRuntime";
import type { CodexFreshThreadLaunchRuntimePromiseAdapter } from "../codex-application/CodexFreshThreadLaunchRuntimePromiseAdapter";

type AdoptionResult = Extract<CodexRendererConversationResumeResult, { readonly role: "owner" }>;

interface TestCodexFreshThreadLaunchRuntimeOptions {
  readonly adopt: (launch: CodexFreshThreadLaunch) => Promise<AdoptionResult>;
  readonly readAdopted: (launch: CodexFreshThreadLaunch) => Promise<AdoptionResult>;
  readonly start: (launch: CodexFreshThreadLaunch) => Promise<TurnStartResponse>;
  readonly abandon: (launch: CodexFreshThreadLaunch, reason: unknown) => void;
}

interface Entry {
  readonly launch: CodexFreshThreadLaunch;
  state: CodexFreshThreadLaunchReservation["state"];
}

/** Mutable vertical harness used only by the legacy CodexService test suite. */
export class TestCodexFreshThreadLaunchRuntime implements CodexFreshThreadLaunchRuntimePromiseAdapter {
  readonly #entries = new Map<string, Entry>();
  readonly #adoptions = new Map<string, Promise<AdoptionResult>>();
  readonly #starts = new Map<string, Promise<TurnStartResponse>>();
  #closed = false;

  constructor(private readonly options: TestCodexFreshThreadLaunchRuntimeOptions) {}

  #lookup(identity: CodexFreshThreadLaunchIdentity): Entry {
    const entry = this.#entries.get(identity.threadId);
    if (!entry || entry.launch.launchId !== identity.launchId) {
      throw new CodexFreshThreadLaunchError("unavailable", identity);
    }
    if (entry.launch.rendererClientId !== identity.ownerClientId) {
      throw new CodexFreshThreadLaunchError("wrong-owner", identity);
    }
    return entry;
  }

  register(launch: CodexFreshThreadLaunch): void {
    const identity = {
      launchId: launch.launchId,
      ownerClientId: launch.rendererClientId,
      threadId: launch.threadId,
    };
    if (this.#closed) throw new CodexFreshThreadLaunchError("unavailable", identity);
    if (this.#entries.has(launch.threadId)) {
      throw new CodexFreshThreadLaunchError("duplicate", identity);
    }
    this.#entries.set(launch.threadId, { launch, state: "prepared" });
  }

  reservation(threadId: string): CodexFreshThreadLaunchReservation | null {
    const entry = this.#entries.get(threadId);
    return entry ? { rendererClientId: entry.launch.rendererClientId, state: entry.state } : null;
  }

  async adopt(identity: CodexFreshThreadLaunchIdentity): Promise<AdoptionResult> {
    const entry = this.#lookup(identity);
    const active = this.#adoptions.get(identity.threadId);
    if (active) return await active;
    if (entry.state === "adopted" || entry.state === "starting") {
      return await this.options.readAdopted(entry.launch);
    }
    entry.state = "adopting";
    const promise = this.options.adopt(entry.launch);
    this.#adoptions.set(identity.threadId, promise);
    try {
      const result = await promise;
      if (this.#entries.get(identity.threadId) === entry) entry.state = "adopted";
      return result;
    } catch (error) {
      if (this.#entries.get(identity.threadId) === entry) entry.state = "prepared";
      throw error;
    } finally {
      if (this.#adoptions.get(identity.threadId) === promise) {
        this.#adoptions.delete(identity.threadId);
      }
    }
  }

  async start(identity: CodexFreshThreadLaunchIdentity): Promise<TurnStartResponse> {
    const entry = this.#lookup(identity);
    const activeStart = this.#starts.get(identity.threadId);
    if (activeStart) return await activeStart;
    const activeAdoption = this.#adoptions.get(identity.threadId);
    if (activeAdoption) {
      await activeAdoption;
      return await this.start(identity);
    }
    if (entry.state !== "adopted") {
      throw new CodexFreshThreadLaunchError("not-adopted", identity);
    }
    entry.state = "starting";
    const promise = this.options.start(entry.launch);
    this.#starts.set(identity.threadId, promise);
    try {
      return await promise;
    } finally {
      this.#entries.delete(identity.threadId);
      if (this.#starts.get(identity.threadId) === promise) this.#starts.delete(identity.threadId);
    }
  }

  releaseRenderer(rendererClientId: string, reason: unknown): void {
    for (const [threadId, entry] of this.#entries) {
      if (entry.launch.rendererClientId !== rendererClientId || entry.state === "starting")
        continue;
      this.#entries.delete(threadId);
      this.options.abandon(entry.launch, reason);
    }
  }

  clear(threadId: string): void {
    this.#entries.delete(threadId);
  }

  async shutdown(): Promise<void> {
    this.#closed = true;
    this.#entries.clear();
    this.#adoptions.clear();
    this.#starts.clear();
  }
}
