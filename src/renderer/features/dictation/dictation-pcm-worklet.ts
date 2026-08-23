import { encodeDictationPcm16 } from "./dictation-pcm";

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(
    inputs: readonly (readonly Float32Array[])[],
    outputs: readonly (readonly Float32Array[])[],
    parameters: Readonly<Record<string, Float32Array>>,
  ): boolean;
}

declare const registerProcessor: (
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
) => void;

class NodexDictationPcmProcessor extends AudioWorkletProcessor {
  #gain = 1;

  process(inputs: readonly (readonly Float32Array[])[]): boolean {
    const samples = inputs[0]?.[0];
    if (!samples || samples.length === 0) return true;
    const frame = encodeDictationPcm16(samples, this.#gain);
    this.#gain = frame.gain;
    this.port.postMessage({ pcm16: frame.pcm16 }, [frame.pcm16]);
    return true;
  }
}

registerProcessor("nodex-dictation-pcm", NodexDictationPcmProcessor);
