import * as Effect from "effect/Effect";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { assert, it } from "@effect/vitest";
import { ScopedCallbackRuntime, layer as callbackLayer } from "../app/ScopedCallbackRuntime";
import type { CoreGenerationClient } from "../core-client/core-generation-client";
import { createFakeCoreHandshake, FakeCoreClient } from "../core-client/testing/fake-core-client";
import { CoreAuthority, CoreSessionAccess, type CoreAuthorityState } from "./CoreAuthority";
import { makeDesktopDataAuthority } from "./DesktopCoreAdapter";

it.layer(callbackLayer)("DesktopCoreAdapter", (it) => {
  it.effect("borrows one Effect authority for root and Project-scoped Promise callers", () =>
    Effect.gen(function* () {
      const callbacks = yield* ScopedCallbackRuntime;
      const handshake = createFakeCoreHandshake({
        profileId: "profile-a",
        libraryId: "library-a",
        storeEpoch: "epoch-a",
        connectionBinding: "binding-a",
      });
      const selectedProjects: Array<string | null> = [];
      const client = Object.assign(new FakeCoreClient(), {
        handshake,
        forProject: (projectId: string) => {
          selectedProjects.push(projectId);
          return client;
        },
        health: () => Promise.resolve({ status: "ready" as const }),
        shutdown: () => Promise.resolve({ status: "draining" as const }),
        libraryRead: () => {
          selectedProjects.push(null);
          return Promise.resolve({ value: { kind: "metadata" as const } });
        },
      }) as unknown as CoreGenerationClient;
      const state = yield* SubscriptionRef.make<CoreAuthorityState>({
        kind: "ready",
        generation: handshake.generation.start_nonce,
      });
      const authority = CoreAuthority.of({
        identity: { profileId: "profile-a", libraryId: "library-a", storeEpoch: "epoch-a" },
        initialLaunch: {
          executablePath: "/tmp/nodex-core",
          startedProcessId: null,
          timings: {
            artifactValidationMs: 0,
            connectMs: 0,
            disposition: "reused",
            reason: "reused_compatible",
            selectionMs: 0,
            totalMs: 0,
          },
        },
        state,
        retry: Effect.void,
        requestRelaunch: Effect.void,
      });
      const access = CoreSessionAccess.of({
        handshake: Effect.succeed(handshake),
        use: (_operation, run, options) =>
          Effect.promise((signal) =>
            run(
              options?.projectId === undefined ? client : client.forProject(options.projectId),
              signal,
            ),
          ),
      });
      const runtime = yield* makeDesktopDataAuthority(callbacks).pipe(
        Effect.provideService(CoreAuthority, authority),
        Effect.provideService(CoreSessionAccess, access),
      );

      yield* Effect.promise(() => runtime.rootClient.libraryRead({ kind: "metadata" }));
      yield* Effect.promise(() =>
        runtime.clientForProject("project-a").libraryRead({ kind: "metadata" }),
      );
      assert.deepStrictEqual(selectedProjects, [null, "project-a", null]);
      assert.strictEqual(runtime.identity.storeEpoch, "epoch-a");
    }),
  );
});
