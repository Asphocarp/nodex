import path from "node:path";
import type {
  CodexWorktreeWorkerOperation,
  CodexWorktreeWorkerPort,
} from "./codex-worktree-worker-port";
import type { CodexExecutionHostFileTransferPort } from "./codex-execution-host-file-transfer";

export interface CodexExecutionHostDescriptor {
  readonly hostId: string;
  readonly displayName: string;
  readonly kind: "local" | "ssh";
  readonly nodexHome: string;
  readonly codexHome: string;
  readonly managedRoot: string;
  readonly handoffStagingRoot: string;
  readonly repositoryRoots: readonly string[];
  readonly capabilities: readonly CodexWorktreeWorkerOperation[];
}

export interface CodexExecutionHostRegistration {
  readonly hostId: string;
  readonly displayName?: string;
  readonly kind?: "local" | "ssh";
  readonly nodexHome?: string;
  readonly codexHome?: string;
  readonly managedRoot: string;
  readonly handoffStagingRoot?: string;
  readonly knownManagedRoots?: readonly string[];
  readonly repositoryRoots?: readonly string[];
  readonly worktreeWorker: CodexWorktreeWorkerPort;
  readonly fileTransfer?: CodexExecutionHostFileTransferPort;
  readonly capabilities: readonly CodexWorktreeWorkerOperation[];
}

interface StoredExecutionHostRegistration {
  readonly displayName: string;
  readonly kind: "local" | "ssh";
  readonly nodexHome: string;
  readonly codexHome: string;
  readonly managedRoot: string;
  readonly handoffStagingRoot: string;
  readonly knownManagedRoots: ReadonlySet<string>;
  readonly repositoryRoots: readonly string[];
  readonly worktreeWorker: CodexWorktreeWorkerPort;
  readonly fileTransfer: CodexExecutionHostFileTransferPort | null;
  readonly capabilities: ReadonlySet<CodexWorktreeWorkerOperation>;
}

/** Main-owned authority for host capability discovery and worker routing. */
export class CodexExecutionHostRegistry {
  readonly #hosts = new Map<string, StoredExecutionHostRegistration>();

  register(registration: CodexExecutionHostRegistration): void {
    const hostId = registration.hostId.trim();
    if (!hostId) throw new Error("Execution host id is required");
    const managedRoot = registration.managedRoot.trim();
    if (!managedRoot) throw new Error("Execution host managed root is required");
    if (registration.worktreeWorker.hostId !== hostId) {
      throw new Error("Worktree worker identity does not match its execution host");
    }
    this.#hosts.set(hostId, {
      displayName: registration.displayName?.trim() || hostId,
      kind: registration.kind ?? "local",
      nodexHome: registration.nodexHome?.trim() || path.dirname(managedRoot),
      codexHome: registration.codexHome?.trim() || path.dirname(managedRoot),
      managedRoot,
      handoffStagingRoot: registration.handoffStagingRoot?.trim() || managedRoot,
      knownManagedRoots: new Set([
        managedRoot,
        ...(registration.knownManagedRoots ?? []).map((root) => root.trim()).filter(Boolean),
      ]),
      repositoryRoots: [
        ...new Set((registration.repositoryRoots ?? []).map((root) => root.trim()).filter(Boolean)),
      ],
      worktreeWorker: registration.worktreeWorker,
      fileTransfer: registration.fileTransfer ?? null,
      capabilities: new Set(registration.capabilities),
    });
  }

  unregister(hostId: string, worktreeWorker?: CodexWorktreeWorkerPort): boolean {
    const normalizedHostId = hostId.trim();
    const current = this.#hosts.get(normalizedHostId);
    if (!current) return false;
    if (worktreeWorker && current.worktreeWorker !== worktreeWorker) return false;
    return this.#hosts.delete(normalizedHostId);
  }

  hasCapability(hostId: string, operation: CodexWorktreeWorkerOperation): boolean {
    return this.#hosts.get(hostId.trim())?.capabilities.has(operation) ?? false;
  }

  hasFileTransfer(hostId: string): boolean {
    return Boolean(this.#hosts.get(hostId.trim())?.fileTransfer);
  }

  listHostIds(operation?: CodexWorktreeWorkerOperation): string[] {
    return [...this.#hosts.entries()]
      .filter(([, registration]) => !operation || registration.capabilities.has(operation))
      .map(([hostId]) => hostId)
      .sort();
  }

  listDescriptors(operation?: CodexWorktreeWorkerOperation): CodexExecutionHostDescriptor[] {
    return [...this.#hosts.entries()]
      .filter(([, registration]) => !operation || registration.capabilities.has(operation))
      .map(([hostId, registration]) => ({
        hostId,
        displayName: registration.displayName,
        kind: registration.kind,
        nodexHome: registration.nodexHome,
        codexHome: registration.codexHome,
        managedRoot: registration.managedRoot,
        handoffStagingRoot: registration.handoffStagingRoot,
        repositoryRoots: [...registration.repositoryRoots],
        capabilities: [...registration.capabilities].sort(),
      }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  getDescriptor(hostId: string): CodexExecutionHostDescriptor | null {
    return this.listDescriptors().find((descriptor) => descriptor.hostId === hostId.trim()) ?? null;
  }

  requireRepositoryRoots(hostId: string): readonly string[] {
    const registration = this.#hosts.get(hostId.trim());
    if (!registration)
      throw new Error(`Execution host is unavailable: ${hostId.trim() || "<empty>"}`);
    return [...registration.repositoryRoots];
  }

  requireFileTransfer(hostId: string): CodexExecutionHostFileTransferPort {
    const registration = this.#hosts.get(hostId.trim());
    if (!registration)
      throw new Error(`Execution host is unavailable: ${hostId.trim() || "<empty>"}`);
    if (!registration.fileTransfer) {
      throw new Error(`Execution host ${hostId.trim()} does not support file transfer`);
    }
    return registration.fileTransfer;
  }

  requireManagedRoot(hostId: string): string {
    const normalizedHostId = hostId.trim();
    const registration = this.#hosts.get(normalizedHostId);
    if (!registration) {
      throw new Error(`Execution host is unavailable: ${normalizedHostId || "<empty>"}`);
    }
    return registration.managedRoot;
  }

  requireNodexHome(hostId: string): string {
    const normalizedHostId = hostId.trim();
    const registration = this.#hosts.get(normalizedHostId);
    if (!registration) {
      throw new Error(`Execution host is unavailable: ${normalizedHostId || "<empty>"}`);
    }
    return registration.nodexHome;
  }

  requireCodexHome(hostId: string): string {
    const normalizedHostId = hostId.trim();
    const registration = this.#hosts.get(normalizedHostId);
    if (!registration) {
      throw new Error(`Execution host is unavailable: ${normalizedHostId || "<empty>"}`);
    }
    return registration.codexHome;
  }

  requireHandoffStagingRoot(hostId: string): string {
    const normalizedHostId = hostId.trim();
    const registration = this.#hosts.get(normalizedHostId);
    if (!registration) {
      throw new Error(`Execution host is unavailable: ${normalizedHostId || "<empty>"}`);
    }
    return registration.handoffStagingRoot;
  }

  listManagedRoots(hostId: string): string[] {
    const normalizedHostId = hostId.trim();
    const registration = this.#hosts.get(normalizedHostId);
    if (!registration) {
      throw new Error(`Execution host is unavailable: ${normalizedHostId || "<empty>"}`);
    }
    return [...registration.knownManagedRoots].sort();
  }

  resolveManagedRoot(hostId: string, worktreePath: string): string {
    const candidate = path.resolve(worktreePath.trim());
    const roots = this.listManagedRoots(hostId)
      .filter((root) => {
        const relative = path.relative(path.resolve(root), candidate);
        return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
      })
      .sort((left, right) => right.length - left.length);
    const root = roots[0];
    if (!root) throw new Error("Worktree path is outside every authorized managed root");
    return root;
  }

  updateManagedRoot(hostId: string, managedRoot: string): void {
    const normalizedHostId = hostId.trim();
    const registration = this.#hosts.get(normalizedHostId);
    if (!registration) {
      throw new Error(`Execution host is unavailable: ${normalizedHostId || "<empty>"}`);
    }
    const normalizedManagedRoot = managedRoot.trim();
    if (!normalizedManagedRoot) throw new Error("Execution host managed root is required");
    this.#hosts.set(normalizedHostId, {
      ...registration,
      managedRoot: normalizedManagedRoot,
      knownManagedRoots: new Set([...registration.knownManagedRoots, normalizedManagedRoot]),
    });
  }

  requireWorktreeWorker(
    hostId: string,
    operation: CodexWorktreeWorkerOperation,
  ): CodexWorktreeWorkerPort {
    const normalizedHostId = hostId.trim();
    const registration = this.#hosts.get(normalizedHostId);
    if (!registration) {
      throw new Error(`Execution host is unavailable: ${normalizedHostId || "<empty>"}`);
    }
    if (!registration.capabilities.has(operation)) {
      throw new Error(`Execution host ${normalizedHostId} does not support worktree ${operation}`);
    }
    return registration.worktreeWorker;
  }
}
