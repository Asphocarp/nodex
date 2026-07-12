import { bodyLimit } from "hono/body-limit";
import type { Hono } from "hono";
import type {
  BlockTransferCommandResult,
  BlockTransferIntent,
} from "../shared/block-transfer";
import {
  bindBlockTransferIntent,
  blockTransferFailure,
  blockTransferHttpStatus,
  blockTransferTransportFailure,
  encodeBlockTransferHttpResult,
} from "../shared/block-transfer-transport";

const MAX_BLOCK_TRANSFER_BYTES = 256 * 1024;

export interface BlockTransferHttpDependencies {
  readonly transfer: (
    intent: BlockTransferIntent,
  ) => Promise<BlockTransferCommandResult>;
}

export const registerBlockTransferHttpRoute = (
  app: Hono,
  dependencies: BlockTransferHttpDependencies,
): void => {
  app.post(
    "/api/projects/:projectId/block-transfers",
    bodyLimit({
      maxSize: MAX_BLOCK_TRANSFER_BYTES,
      onError: (context) =>
        context.json(
          encodeBlockTransferHttpResult({
            ok: false,
            error: blockTransferFailure(
              "invalid_transfer_request",
              "Block transfer body is too large",
            ),
          }),
          400,
        ),
    }),
    async (context) => {
      context.header("Cache-Control", "no-store");
      const rawIntent = await context.req.json().catch(() => null);
      if (rawIntent === null) {
        return context.json(
          encodeBlockTransferHttpResult({
            ok: false,
            error: blockTransferFailure(
              "invalid_transfer_request",
              "Block transfer body must be valid JSON",
            ),
          }),
          400,
        );
      }
      const bound = bindBlockTransferIntent(
        rawIntent,
        context.req.param("projectId"),
        {
          clientSessionId: "http-loopback:block-transfer",
          actor: { kind: "http_loopback", transport: "json" },
        },
      );
      if (!bound.ok) {
        return context.json(
          encodeBlockTransferHttpResult(bound),
          blockTransferHttpStatus(bound.error),
        );
      }
      let result: BlockTransferCommandResult;
      try {
        result = await dependencies.transfer(bound.value);
      } catch (error) {
        result = blockTransferTransportFailure(bound.value, error);
      }
      return context.json(
        encodeBlockTransferHttpResult(result),
        result.ok ? 200 : blockTransferHttpStatus(result.error),
      );
    },
  );
};
