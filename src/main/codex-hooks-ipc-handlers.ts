import type { IpcApi } from "../shared/ipc-api";
import type {
  CodexHooksChangedEvent,
  CodexHooksListInput,
  CodexHooksListResponse,
  CodexHooksStateUpdateInput,
} from "../shared/codex-hooks";

export type CodexHooksIpcChannel = "codex:hooks:list" | "codex:hooks:state:update";

export type CodexHooksIpcHandler<Channel extends CodexHooksIpcChannel> = (
  event: unknown,
  ...args: IpcApi[Channel]["args"]
) => IpcApi[Channel]["result"] | Promise<IpcApi[Channel]["result"]>;

export interface CodexHooksIpcRegistration {
  registerHandle: <Channel extends CodexHooksIpcChannel>(
    channel: Channel,
    listener: CodexHooksIpcHandler<Channel>,
  ) => void;
  listHooks: (input: CodexHooksListInput) => Promise<CodexHooksListResponse>;
  updateHooksState: (input: CodexHooksStateUpdateInput) => Promise<void>;
  broadcastHooksChanged: (event: CodexHooksChangedEvent) => void;
}

export function registerCodexHooksIpcHandlers(options: CodexHooksIpcRegistration): void {
  options.registerHandle("codex:hooks:list", (_, input) => options.listHooks(input));

  options.registerHandle("codex:hooks:state:update", async (_, input) => {
    await options.updateHooksState(input);
    options.broadcastHooksChanged({ hostId: input.hostId });
  });
}
