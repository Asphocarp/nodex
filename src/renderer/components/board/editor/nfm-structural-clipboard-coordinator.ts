import type { NodexClipboardEnvelopeV1 } from "../../../../shared/clipboard-paste";

import type { NfmStructuralClipboardPresentation } from "./nfm-structural-editing-extension";

export interface PendingNfmStructuralClipboardCapture {
  readonly libraryId?: string;
  readonly storeEpoch: string;
  readonly writeClaim: string;
  readonly presentation: NfmStructuralClipboardPresentation;
  readonly envelope: Promise<NodexClipboardEnvelopeV1 | null>;
}

interface PendingNfmStructuralClipboardCompletion {
  complete(envelope: NodexClipboardEnvelopeV1 | null): void;
}

/** Coordinates an asynchronous Core capture with a following synchronous paste event. */
export class NfmStructuralClipboardCoordinator {
  private current:
    | (PendingNfmStructuralClipboardCapture & {
        readonly token: symbol;
        settled: boolean;
      })
    | null = null;

  constructor(private readonly captureTimeoutMs = 15_000) {}

  beginCapture(input: {
    readonly libraryId?: string;
    readonly storeEpoch: string;
    readonly writeClaim: string;
    readonly presentation: NfmStructuralClipboardPresentation;
  }): PendingNfmStructuralClipboardCompletion {
    const token = Symbol("nfm-structural-clipboard-capture");
    let resolveEnvelope: (envelope: NodexClipboardEnvelopeV1 | null) => void = () => undefined;
    const envelope = new Promise<NodexClipboardEnvelopeV1 | null>((resolve) => {
      resolveEnvelope = resolve;
    });
    const capture = {
      ...input,
      token,
      settled: false,
      envelope,
    };
    this.current = capture;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const complete = (result: NodexClipboardEnvelopeV1 | null): void => {
      if (capture.settled) return;
      capture.settled = true;
      if (timeout) clearTimeout(timeout);
      resolveEnvelope(result);
      if (this.current?.token === token) this.current = null;
    };
    timeout = setTimeout(() => complete(null), this.captureTimeoutMs);

    return {
      complete,
    };
  }

  readPending(): PendingNfmStructuralClipboardCapture | null {
    if (!this.current || this.current.settled) return null;
    return this.current;
  }

  /** Stops future paste events from claiming an older copy without cancelling already queued work. */
  supersedePending(): void {
    this.current = null;
  }
}

export const nfmStructuralClipboardCoordinator = new NfmStructuralClipboardCoordinator();
