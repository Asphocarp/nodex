import type { IpcApi } from "../shared/ipc-api";
import type { DesktopStoreAdministrationPort } from "./core-client/desktop-store-administration-bridge";

export type StoreAdministrationIpcChannel =
  | "backup:list"
  | "backup:create"
  | "backup:delete"
  | "backup:restore";

export type StoreAdministrationIpcHandler<
  Channel extends StoreAdministrationIpcChannel,
> = (
  event: unknown,
  ...args: IpcApi[Channel]["args"]
) => IpcApi[Channel]["result"] | Promise<IpcApi[Channel]["result"]>;

interface RegisterStoreAdministrationIpcHandlersInput {
  readonly registerHandle: <Channel extends StoreAdministrationIpcChannel>(
    channel: Channel,
    handler: StoreAdministrationIpcHandler<Channel>,
  ) => void;
  readonly administration: DesktopStoreAdministrationPort;
  readonly onStoreRestored?: () => void;
}

export function registerStoreAdministrationIpcHandlers(
  input: RegisterStoreAdministrationIpcHandlersInput,
): void {
  input.registerHandle("backup:list", () =>
    input.administration.listBackups()
  );
  input.registerHandle("backup:create", (_, backupInput) =>
    input.administration.createBackup({
      trigger: "manual",
      label: backupInput?.label,
    })
  );
  input.registerHandle("backup:delete", (_, backupId) =>
    input.administration.deleteBackup(backupId)
  );
  input.registerHandle("backup:restore", async (_, restoreInput) => {
    const result = await input.administration.restoreBackup(restoreInput);
    input.onStoreRestored?.();
    return result;
  });
}
