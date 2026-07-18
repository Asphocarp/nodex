const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export class CoreCodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoreCodecError";
  }
}

export const encodeBoundedJson = (
  value: unknown,
  maximumBytes: number,
  label: string,
): Uint8Array => {
  const json = JSON.stringify(value);
  if (json === undefined) throw new CoreCodecError(`${label} is not JSON-serializable`);
  const encoded = textEncoder.encode(json);
  if (encoded.byteLength <= maximumBytes) return encoded;
  throw new CoreCodecError(`${label} exceeds ${maximumBytes} bytes`);
};

export const decodeBoundedJson = <Value>(
  bytes: Uint8Array,
  maximumBytes: number,
  label: string,
): Value => {
  assertBoundedBinary(bytes, maximumBytes, label);
  try {
    return JSON.parse(textDecoder.decode(bytes)) as Value;
  } catch (error) {
    throw new CoreCodecError(
      `${label} is not valid UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const assertBoundedBinary = (
  bytes: Uint8Array,
  maximumBytes: number,
  label: string,
): Uint8Array => {
  if (bytes.byteLength <= maximumBytes) return bytes;
  throw new CoreCodecError(`${label} exceeds ${maximumBytes} bytes`);
};
