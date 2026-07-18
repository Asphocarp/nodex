import { describe, expect, test } from "vitest";

import {
  CORE_MODULE_CONTRACT_VERSION,
  bindInProcessModule,
  type BoundModuleContext,
  type DeepCoreModule,
  type ModuleApplyRequest,
  type ModuleReadRequest,
} from ".";

interface ProbeRead {
  readonly kind: "metadata";
}

interface ProbeIntent {
  readonly kind: "grant_project_access";
  readonly projectId: string;
}

type ProbeReadRequest = ModuleReadRequest<ProbeRead>;
type ProbeApplyRequest = ModuleApplyRequest<ProbeIntent>;

describe("deep Core Module contract", () => {
  test("binds trusted adapter identity separately and preserves Module-owned results", async () => {
    const observed: BoundModuleContext[] = [];
    const module: DeepCoreModule<
      ProbeReadRequest,
      { readonly snapshot: "module-owned" },
      ProbeApplyRequest,
      { readonly receipt: "module-owned"; readonly eventSequence: 7 }
    > = {
      read: async (context) => {
        observed.push(context);
        return { snapshot: "module-owned" };
      },
      apply: async (context) => {
        observed.push(context);
        return { receipt: "module-owned", eventSequence: 7 };
      },
    };
    const adapters = (["electron_host", "native_cli", "agent"] as const).map(
      (adapter, index) =>
        bindInProcessModule(module, () => ({
          profileId: "profile-1",
          libraryId: "library-1",
          projectId: "project-1",
          connectionId: `connection-${index + 1}`,
          adapter,
        })),
    );
    const readRequest: ProbeReadRequest = {
      version: CORE_MODULE_CONTRACT_VERSION,
      read: { kind: "metadata" },
    };
    const applyRequest: ProbeApplyRequest = {
      version: CORE_MODULE_CONTRACT_VERSION,
      operationId: "operation-1",
      storeEpoch: "epoch-1",
      intent: { kind: "grant_project_access", projectId: "project-1" },
    };

    expect(await adapters[0]?.read(readRequest)).toEqual({
      snapshot: "module-owned",
    });
    expect(await adapters[1]?.apply(applyRequest)).toEqual({
      receipt: "module-owned",
      eventSequence: 7,
    });
    await adapters[2]?.read(readRequest);

    expect(observed.map(({ adapter, connectionId }) => ({ adapter, connectionId })))
      .toEqual([
        { adapter: "electron_host", connectionId: "connection-1" },
        { adapter: "native_cli", connectionId: "connection-2" },
        { adapter: "agent", connectionId: "connection-3" },
      ]);
    expect(readRequest).not.toHaveProperty("profileId");
    expect(applyRequest).not.toHaveProperty("libraryId");
  });
});
