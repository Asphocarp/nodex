import { endianness } from "node:os";

export const BROWSER_USE_NATIVE_PIPE_MAX_FRAME_BYTES = 8 * 1024 * 1024;
const FRAME_HEADER_BYTES = 4;

function readFrameLength(buffer: Buffer, offset = 0): number {
  return endianness() === "LE"
    ? buffer.readUInt32LE(offset)
    : buffer.readUInt32BE(offset);
}

function writeFrameLength(buffer: Buffer, length: number, offset = 0): void {
  if (endianness() === "LE") {
    buffer.writeUInt32LE(length, offset);
    return;
  }
  buffer.writeUInt32BE(length, offset);
}

export function encodeBrowserUseNativePipeFrame(
  message: string,
  maxFrameBytes = BROWSER_USE_NATIVE_PIPE_MAX_FRAME_BYTES,
): Buffer {
  const payload = Buffer.from(message, "utf8");
  if (payload.byteLength > maxFrameBytes) {
    throw new Error(`Browser Use native-pipe frame exceeds ${maxFrameBytes} bytes`);
  }
  const frame = Buffer.allocUnsafe(FRAME_HEADER_BYTES + payload.byteLength);
  writeFrameLength(frame, payload.byteLength);
  payload.copy(frame, FRAME_HEADER_BYTES);
  return frame;
}

export class BrowserUseNativePipeFrameDecoder {
  private pending: Buffer = Buffer.alloc(0);

  constructor(
    private readonly maxFrameBytes = BROWSER_USE_NATIVE_PIPE_MAX_FRAME_BYTES,
  ) {}

  push(chunk: Buffer | Uint8Array): string[] {
    if (chunk.byteLength === 0) return [];
    const nextChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.pending = this.pending.byteLength === 0
      ? nextChunk
      : Buffer.concat([this.pending, nextChunk]);

    const messages: string[] = [];
    let offset = 0;
    while (this.pending.byteLength - offset >= FRAME_HEADER_BYTES) {
      const payloadBytes = readFrameLength(this.pending, offset);
      if (payloadBytes > this.maxFrameBytes) {
        this.pending = Buffer.alloc(0);
        throw new Error(`Browser Use native-pipe frame exceeds ${this.maxFrameBytes} bytes`);
      }
      const frameBytes = FRAME_HEADER_BYTES + payloadBytes;
      if (this.pending.byteLength - offset < frameBytes) break;
      messages.push(
        this.pending
          .subarray(offset + FRAME_HEADER_BYTES, offset + frameBytes)
          .toString("utf8"),
      );
      offset += frameBytes;
    }

    if (offset > 0) this.pending = this.pending.subarray(offset);
    if (this.pending.byteLength > this.maxFrameBytes + FRAME_HEADER_BYTES) {
      this.pending = Buffer.alloc(0);
      throw new Error("Browser Use native-pipe decoder buffer exceeded its limit");
    }
    return messages;
  }

  reset(): void {
    this.pending = Buffer.alloc(0);
  }
}
