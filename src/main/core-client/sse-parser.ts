export interface ParsedSseEvent {
  readonly event: string;
  readonly id: string;
  readonly data: string;
}

export class SseParser {
  readonly #decoder = new TextDecoder("utf-8", { fatal: true });
  readonly #maximumBufferedBytes: number;
  #buffer = "";

  constructor(maximumBufferedBytes: number) {
    this.#maximumBufferedBytes = maximumBufferedBytes;
  }

  push(chunk: Uint8Array): readonly ParsedSseEvent[] {
    this.#buffer += this.#decoder.decode(chunk, { stream: true });
    this.#assertBounded();
    return this.#drainFrames();
  }

  finish(): readonly ParsedSseEvent[] {
    this.#buffer += this.#decoder.decode();
    this.#assertBounded();
    if (this.#buffer.length > 0) this.#buffer += "\n\n";
    const events = this.#drainFrames();
    this.#buffer = "";
    return events;
  }

  #assertBounded(): void {
    if (Buffer.byteLength(this.#buffer, "utf8") <= this.#maximumBufferedBytes) return;
    throw new Error(`SSE frame exceeds ${this.#maximumBufferedBytes} buffered bytes`);
  }

  #drainFrames(): readonly ParsedSseEvent[] {
    const events: ParsedSseEvent[] = [];
    while (true) {
      const separator = this.#buffer.match(/\r?\n\r?\n/);
      if (!separator || separator.index === undefined) return events;
      const frame = this.#buffer.slice(0, separator.index);
      this.#buffer = this.#buffer.slice(separator.index + separator[0].length);
      const event = parseFrame(frame);
      if (event) events.push(event);
    }
  }
}

const parseFrame = (frame: string): ParsedSseEvent | null => {
  let event = "message";
  let id = "";
  const data: string[] = [];

  for (const line of frame.split(/\r?\n/)) {
    if (line.length === 0 || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const rawValue = colon < 0 ? "" : line.slice(colon + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (field === "event") event = value;
    if (field === "id" && !value.includes("\0")) id = value;
    if (field === "data") data.push(value);
  }
  if (data.length === 0) return null;
  return { event, id, data: data.join("\n") };
};
