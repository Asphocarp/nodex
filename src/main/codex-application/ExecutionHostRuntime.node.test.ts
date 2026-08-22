import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { assert, it } from "@effect/vitest";
import type { CodexExecutionHostSettings, CodexSshExecutionHostConfig } from "../../shared/types";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { CodexExecutionHostConfig } from "../codex-runtime/CodexEndpointMap";
import {
  ExecutionHostRuntime,
  live as executionHostRuntimeLive,
  type ExecutionHostRuntimeFactories,
  type RemoteExecutionHostTransport,
} from "./ExecutionHostRuntime";
import type { CodexWorktreeWorkerPort } from "../codex/codex-worktree-worker-port";

const sshHost = (
  id: string,
  managedRoot = `/remote/${id}/worktrees`,
): CodexSshExecutionHostConfig => ({
  id,
  displayName: `Host ${id}`,
  kind: "ssh",
  sshAlias: id,
  port: null,
  managedRoot,
  repositoryRoots: [`/remote/${id}/repos`],
  codexBinary: null,
  codexHome: null,
  enabled: true,
});

const makeHarness = (failedHostId?: string) => {
  let settings: CodexExecutionHostSettings = { sshHosts: [] };
  const registered = new Map<string, CodexExecutionHostConfig>();
  const removed: string[] = [];
  const shutdowns: string[] = [];
  const failedHosts = new Set(failedHostId ? [failedHostId] : []);
  const unsupported = () => Effect.die(new Error("Unsupported test operation"));
  const gateway = CodexGateway.of({
    localHostId: "local",
    events: Stream.empty,
    requestLocal: unsupported,
    requestOnHost: unsupported,
    requestForThread: unsupported,
    notifyLocal: unsupported,
    connection: unsupported,
    connectionChanges: () => Stream.empty,
    awaitReady: unsupported,
    reconcileHost: (config) =>
      Effect.sync(() => {
        registered.set(config.hostId, config);
      }),
    removeHost: (hostId) =>
      Effect.sync(() => {
        registered.delete(hostId);
        removed.push(hostId);
      }),
    restartHost: unsupported,
  });
  const factories: ExecutionHostRuntimeFactories = {
    makeTransport: ({ config }) =>
      ({
        hostId: config.id,
        config,
        ensureReady: () =>
          failedHosts.has(config.id)
            ? Promise.reject(new Error("host unavailable"))
            : Promise.resolve({
                hostId: config.id,
                home: `/remote/${config.id}`,
                codexHome: `/remote/${config.id}/.codex`,
                platform: "linux",
                architecture: "arm64",
                nodeVersion: "v24",
                gitVersion: "git 2",
                codexVersion: "codex 1",
              }),
        openWorktreeWorker: () => Promise.reject(new Error("not exercised")),
        appServerClientOptions: () => ({ binaryPath: "ssh", args: [] }),
        describe: () => Promise.reject(new Error("not exercised")),
        download: () => Promise.reject(new Error("not exercised")),
        upload: () => Promise.reject(new Error("not exercised")),
        cleanup: () => Promise.reject(new Error("not exercised")),
      }) satisfies RemoteExecutionHostTransport,
    makeWorker: ({ hostId }) =>
      Effect.acquireRelease(Effect.succeed({ hostId } as CodexWorktreeWorkerPort), () =>
        Effect.sync(() => {
          shutdowns.push(hostId);
        }),
      ),
  };
  const layer = executionHostRuntimeLive({
    runtimeStateHome: "/profile/agent",
    nodexHome: "/profile",
    remoteWorktreeWorkerBundlePath: "/app/remote-worktree-worker.cjs",
    localWorktreeWorker: { hostId: "local" } as CodexWorktreeWorkerPort,
    settings: {
      read: () => settings,
      update: (input) => {
        settings = { sshHosts: [...input.sshHosts] };
        return settings;
      },
    },
    managedWorktrees: {
      read: () => ({ worktreeRoot: null, autoDeleteEnabled: true, autoDeleteLimit: 15 }),
      listKnownRoots: () => [],
    },
    factories,
  }).pipe(Layer.provide(Layer.succeed(CodexGateway, gateway)));
  return { failedHosts, layer, registered, removed, shutdowns };
};

it.effect("owns local and dynamic SSH host resources until its Scope closes", () =>
  Effect.gen(function* () {
    const harness = makeHarness();
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(harness.layer, scope);
    const hosts = Context.get(context, ExecutionHostRuntime);

    assert.deepEqual(hosts.registry.listHostIds(), ["local"]);
    yield* hosts.updateSettings({ sshHosts: [sshHost("alpha")] });
    assert.deepEqual(hosts.registry.listHostIds(), ["alpha", "local"]);
    assert.deepEqual([...harness.registered.keys()], ["alpha"]);

    yield* hosts.updateSettings({ sshHosts: [sshHost("alpha", "/remote/alpha/new")] });
    assert.deepEqual(harness.removed, ["alpha"]);
    assert.deepEqual(harness.shutdowns, ["alpha"]);
    assert.strictEqual(hosts.registry.requireManagedRoot("alpha"), "/remote/alpha/new");
    assert.deepEqual([...(yield* SubscriptionRef.get(hosts.activeSshHosts)).keys()], ["alpha"]);

    yield* Scope.close(scope, Exit.void);
    assert.deepEqual(hosts.registry.listHostIds(), []);
    assert.deepEqual(harness.removed, ["alpha", "alpha"]);
    assert.deepEqual(harness.shutdowns, ["alpha", "alpha"]);
  }),
);

it.effect("keeps healthy hosts active while reporting unavailable peers", () =>
  Effect.gen(function* () {
    const harness = makeHarness("broken");
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(harness.layer, scope);
    const hosts = Context.get(context, ExecutionHostRuntime);

    const result = yield* Effect.result(
      hosts.updateSettings({ sshHosts: [sshHost("healthy"), sshHost("broken")] }),
    );
    assert.isTrue(Result.isFailure(result));
    assert.deepEqual(hosts.registry.listHostIds(), ["healthy", "local"]);
    assert.deepEqual([...harness.registered.keys()], ["healthy"]);

    harness.failedHosts.delete("broken");
    yield* hosts.reconcile();
    assert.deepEqual(hosts.registry.listHostIds(), ["broken", "healthy", "local"]);
    assert.deepEqual([...harness.registered.keys()].sort(), ["broken", "healthy"]);

    yield* Scope.close(scope, Exit.void);
  }),
);
