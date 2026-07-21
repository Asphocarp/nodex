import type {
  RecoveryAction,
  ToolErrorCode,
  ToolFailure,
} from "../../shared/nodex-agent-tools";

export class NodexAgentReadError extends Error {
  public constructor(
    public readonly code: ToolErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly recovery: RecoveryAction,
    public readonly details?: ToolFailure["error"]["details"],
  ) {
    super(message);
    this.name = "NodexAgentReadError";
  }
}
