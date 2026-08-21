import { describe, expect, test, vi } from "vite-plus/test";

import { NfmStructuralClipboardCoordinator } from "./nfm-structural-clipboard-coordinator";

const firstWriteClaim = "0199134e-cbb0-7000-8000-000000000001";
const secondWriteClaim = "0199134e-cbb0-7000-8000-000000000002";

describe("NFM structural clipboard coordinator", () => {
  test("exposes only the newest unsettled capture", async () => {
    const coordinator = new NfmStructuralClipboardCoordinator();
    const first = coordinator.beginCapture({
      libraryId: "library",
      storeEpoch: "epoch",
      writeClaim: firstWriteClaim,
      presentation: { html: "<p>first</p>", text: "first" },
    });
    const firstPending = coordinator.readPending();
    const second = coordinator.beginCapture({
      libraryId: "library",
      storeEpoch: "epoch",
      writeClaim: secondWriteClaim,
      presentation: { html: "<p>second</p>", text: "second" },
    });
    const secondPending = coordinator.readPending();

    expect(firstPending?.presentation.text).toBe("first");
    expect(secondPending?.presentation.text).toBe("second");
    first.complete(null);
    expect(coordinator.readPending()?.presentation.text).toBe("second");
    second.complete(null);
    expect(await secondPending?.envelope).toBeNull();
    expect(coordinator.readPending()).toBeNull();
  });

  test("detaches superseded capture while preserving a paste that already claimed it", async () => {
    const coordinator = new NfmStructuralClipboardCoordinator();
    const capture = coordinator.beginCapture({
      libraryId: "library",
      storeEpoch: "epoch",
      writeClaim: firstWriteClaim,
      presentation: { html: "<p>first</p>", text: "first" },
    });
    const claimed = coordinator.readPending();

    coordinator.supersedePending();
    expect(coordinator.readPending()).toBeNull();
    capture.complete(null);
    expect(await claimed?.envelope).toBeNull();
  });

  test("settles an abandoned capture instead of leaving paste permanently pending", async () => {
    vi.useFakeTimers();
    try {
      const coordinator = new NfmStructuralClipboardCoordinator(25);
      coordinator.beginCapture({
        libraryId: "library",
        storeEpoch: "epoch",
        writeClaim: firstWriteClaim,
        presentation: { html: "<p>pending</p>", text: "pending" },
      });
      const pending = coordinator.readPending();

      await vi.advanceTimersByTimeAsync(25);

      expect(await pending?.envelope).toBeNull();
      expect(coordinator.readPending()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
