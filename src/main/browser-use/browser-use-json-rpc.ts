import { z } from "zod";

const BrowserUseRpcIdSchema = z.union([
  z.number().int().safe(),
  z.string().min(1).max(512),
]);

export const BrowserUseRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: BrowserUseRpcIdSchema.optional(),
  method: z.string().trim().min(1).max(128),
  params: z.unknown().optional(),
}).strict();

export type BrowserUseRpcRequest = z.infer<typeof BrowserUseRpcRequestSchema>;
export type BrowserUseRpcId = z.infer<typeof BrowserUseRpcIdSchema>;

export type BrowserUseRpcResponse =
  | {
    jsonrpc: "2.0";
    id: BrowserUseRpcId;
    result: unknown;
  }
  | {
    jsonrpc: "2.0";
    id: BrowserUseRpcId;
    error: {
      code: number;
      message: string;
      data?: unknown;
    };
  };

export function parseBrowserUseRpcRequest(raw: string): BrowserUseRpcRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Browser Use native-pipe message is not valid JSON");
  }
  return BrowserUseRpcRequestSchema.parse(parsed);
}

export function makeBrowserUseRpcResult(
  id: BrowserUseRpcId,
  result: unknown,
): BrowserUseRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: result === undefined ? null : result,
  };
}

export function makeBrowserUseRpcError(
  id: BrowserUseRpcId,
  code: number,
  message: string,
): BrowserUseRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message: message.slice(0, 2_048),
    },
  };
}
