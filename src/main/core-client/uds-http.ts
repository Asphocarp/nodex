import { request as httpRequest, type IncomingMessage } from "node:http";

import {
  decodeBoundedJson,
  encodeBoundedJson,
} from "./codec";
import { SseParser } from "./sse-parser";
import type {
  CoreEventEnvelope,
  CoreEventSubscription,
} from "./types";

const MAX_JSON_REQUEST_BYTES = 64 * 1024;
const MAX_JSON_RESPONSE_BYTES = 512 * 1024;
const MAX_EVENT_FRAME_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;

export class CoreHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CoreHttpError";
  }
}

export class UdsHttpTransport {
  constructor(
    readonly socketPath: string,
    readonly authCapability: string,
  ) {}

  requestJson<Response>(
    method: "GET" | "POST",
    requestPath: string,
    body?: unknown,
  ): Promise<Response> {
    const encodedBody = body === undefined
      ? undefined
      : encodeBoundedJson(body, MAX_JSON_REQUEST_BYTES, "Core request");

    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      const settle = (action: () => void): void => {
        if (settled) return;
        settled = true;
        action();
      };
      const request = httpRequest(
        {
          socketPath: this.socketPath,
          path: requestPath,
          method,
          agent: false,
          headers: {
            accept: "application/json",
            authorization: `Bearer ${this.authCapability}`,
            ...(encodedBody
              ? {
                  "content-length": encodedBody.byteLength,
                  "content-type": "application/json",
                }
              : {}),
          },
        },
        (response) => {
          collectResponse(response, MAX_JSON_RESPONSE_BYTES)
            .then((bytes) => {
              const value = decodeBoundedJson<Response>(
                bytes,
                MAX_JSON_RESPONSE_BYTES,
                "Core response",
              );
              const status = response.statusCode ?? 0;
              if (status >= 200 && status < 300) {
                settle(() => resolve(value));
                return;
              }
              settle(() => reject(new CoreHttpError(status, errorMessage(value))));
            })
            .catch((error: unknown) => settle(() => reject(error)));
        },
      );
      request.setTimeout(REQUEST_TIMEOUT_MS, () => {
        request.destroy(new Error("Core request timed out"));
      });
      request.on("error", (error) => settle(() => reject(error)));
      if (encodedBody) request.write(encodedBody);
      request.end();
    });
  }

  openEventStream(
    after: number,
    onEvent: (event: CoreEventEnvelope) => void,
  ): Promise<CoreEventSubscription> {
    if (!Number.isSafeInteger(after) || after < 0) {
      return Promise.reject(new Error("Event sequence must be a non-negative integer"));
    }

    return new Promise<CoreEventSubscription>((resolve, reject) => {
      let opened = false;
      let closed = false;
      let resolveDone: (() => void) | undefined;
      let rejectDone: ((error: unknown) => void) | undefined;
      const done = new Promise<void>((doneResolve, doneReject) => {
        resolveDone = doneResolve;
        rejectDone = doneReject;
      });
      const request = httpRequest(
        {
          socketPath: this.socketPath,
          path: `/core/v1/events?after=${after}`,
          method: "GET",
          agent: false,
          headers: {
            accept: "text/event-stream",
            authorization: `Bearer ${this.authCapability}`,
          },
        },
        (response) => {
          request.setTimeout(0);
          const status = response.statusCode ?? 0;
          if (status !== 200) {
            collectResponse(response, MAX_JSON_RESPONSE_BYTES)
              .then((bytes) => {
                const value = decodeBoundedJson<unknown>(
                  bytes,
                  MAX_JSON_RESPONSE_BYTES,
                  "Core event error response",
                );
                reject(new CoreHttpError(status, errorMessage(value)));
              })
              .catch(reject);
            return;
          }

          opened = true;
          const parser = new SseParser(MAX_EVENT_FRAME_BYTES);
          const fail = (error: unknown): void => {
            if (closed) return;
            closed = true;
            response.destroy();
            rejectDone?.(error);
          };
          response.on("data", (chunk: Buffer) => {
            try {
              for (const frame of parser.push(chunk)) {
                if (frame.event !== "module") continue;
                onEvent(parseEventEnvelope(frame.data));
              }
            } catch (error) {
              fail(error);
            }
          });
          response.on("end", () => {
            try {
              for (const frame of parser.finish()) {
                if (frame.event === "module") onEvent(parseEventEnvelope(frame.data));
              }
              if (!closed) resolveDone?.();
              closed = true;
            } catch (error) {
              fail(error);
            }
          });
          response.on("error", fail);
          resolve({
            done,
            close: () => {
              if (closed) return;
              closed = true;
              response.destroy();
              request.destroy();
              resolveDone?.();
            },
          });
        },
      );
      request.on("error", (error) => {
        if (!opened) {
          reject(error);
          return;
        }
        if (!closed) rejectDone?.(error);
      });
      request.setTimeout(REQUEST_TIMEOUT_MS, () => {
        request.destroy(new Error("Core event stream timed out before opening"));
      });
      request.end();
    });
  }
}

const collectResponse = (
  response: IncomingMessage,
  maximumBytes: number,
): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let byteLength = 0;
    let settled = false;
    response.on("data", (chunk: Buffer) => {
      if (settled) return;
      byteLength += chunk.byteLength;
      if (byteLength <= maximumBytes) {
        chunks.push(chunk);
        return;
      }
      settled = true;
      reject(new Error(`Core response exceeds ${maximumBytes} bytes`));
      response.destroy(new Error(`Core response exceeds ${maximumBytes} bytes`));
    });
    response.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, byteLength));
    });
    response.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });

const errorMessage = (value: unknown): string => {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    return value.error;
  }
  return "Core request failed";
};

const parseEventEnvelope = (json: string): CoreEventEnvelope => {
  const value = decodeBoundedJson<unknown>(
    Buffer.from(json, "utf8"),
    MAX_EVENT_FRAME_BYTES,
    "Core event",
  );
  if (typeof value !== "object" || value === null || !("event" in value)) {
    throw new Error("Core event envelope is invalid");
  }
  const event = value.event;
  if (
    typeof event !== "object" ||
    event === null ||
    !("sequence" in event) ||
    typeof event.sequence !== "number"
  ) {
    throw new Error("Core event sequence is invalid");
  }
  return value as CoreEventEnvelope;
};
