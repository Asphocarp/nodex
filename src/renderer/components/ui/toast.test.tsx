import { beforeEach, describe, expect, test } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { installAsyncRequestAnimationFrame } from "@/test/browser-globals";
import { render, settleAsyncRender } from "@/test/dom";
import {
  __getNodexToastSnapshotForTests,
  __resetNodexToastStoreForTests,
  NodexToastProvider,
  toast,
  useToaster,
} from "./toast";

function ToastHarness() {
  return <NodexToastProvider><div>Harness</div></NodexToastProvider>;
}

describe("Nodex toast system", () => {
  beforeEach(() => {
    installAsyncRequestAnimationFrame();
    __resetNodexToastStoreForTests();
  });

  test("creates plain toasts at the front of the ordered stack", async () => {
    render(<ToastHarness />);

    await act(async () => {
      toast.info("First toast", { duration: 0 });
      toast.success("Second toast", { duration: 0 });
      await settleAsyncRender();
    });

    const snapshot = __getNodexToastSnapshotForTests();
    expect(snapshot.length).toBe(2);
    expect(snapshot[0]?.kind).toBe("plain");
    expect(String((snapshot[0] as { title?: unknown }).title ?? "")).toBe("Second toast");
    expect(String((snapshot[1] as { title?: unknown }).title ?? "")).toBe("First toast");
  });

  test("returns working close handles and removes the toast after exit completes", async () => {
    const view = render(<ToastHarness />);
    let handle!: { close: () => void };

    await act(async () => {
      handle = toast.info("Closable toast", { duration: 0 });
      await settleAsyncRender();
    });

    expect(Boolean(view.baseElement.textContent?.includes("Closable toast"))).toBe(true);

    await act(async () => {
      handle.close();
      await settleAsyncRender();
    });

    await waitFor(() => {
      if (view.baseElement.textContent?.includes("Closable toast")) {
        throw new Error("Expected the toast to be removed.");
      }
    });
  });

  test("keeps sticky toasts visible until explicitly closed", async () => {
    const view = render(<ToastHarness />);
    let handle!: { close: () => void };

    await act(async () => {
      handle = toast.info("Sticky toast", { duration: 0 });
      await new Promise((resolve) => setTimeout(resolve, 25));
      await settleAsyncRender();
    });

    expect(Boolean(view.baseElement.textContent?.includes("Sticky toast"))).toBe(true);

    await act(async () => {
      handle.close();
      await settleAsyncRender();
    });

    await waitFor(() => {
      if (view.baseElement.textContent?.includes("Sticky toast")) {
        throw new Error("Expected the sticky toast to close.");
      }
    });
  });

  test("replaces older siblings with the same logical id", async () => {
    const view = render(<ToastHarness />);

    await act(async () => {
      toast.info("Old sync state", { id: "sync", duration: 0 });
      toast.success("New sync state", { id: "sync", duration: 0 });
      await settleAsyncRender();
    });

    await waitFor(() => {
      const text = view.baseElement.textContent ?? "";
      if (text.includes("Old sync state")) {
        throw new Error("Expected the older logical-id toast to be replaced.");
      }
      if (!text.includes("New sync state")) {
        throw new Error("Expected the replacement toast to stay visible.");
      }
    });
  });

  test("closes all active toasts", async () => {
    const view = render(<ToastHarness />);

    await act(async () => {
      toast.info("Toast A", { duration: 0 });
      toast.warning("Toast B", { duration: 0 });
      await settleAsyncRender();
    });

    await act(async () => {
      toast.closeAll();
      await settleAsyncRender();
    });

    await waitFor(() => {
      const text = view.baseElement.textContent ?? "";
      if (text.includes("Toast A") || text.includes("Toast B")) {
        throw new Error("Expected all toasts to be dismissed.");
      }
    });
  });

  test("runs onRemove exactly once when a toast leaves the stack", async () => {
    render(<ToastHarness />);
    let removeCalls = 0;

    await act(async () => {
      const handle = toast.info("Tracked removal", {
        duration: 0,
        onRemove: () => {
          removeCalls += 1;
        },
      });
      handle.close();
      await settleAsyncRender();
    });

    await waitFor(() => {
      if (removeCalls !== 1) {
        throw new Error(`Expected one remove callback, received ${removeCalls}.`);
      }
    });
  });

  test("renders the plain severity shell with role alert and a close button", async () => {
    const view = render(<ToastHarness />);

    await act(async () => {
      toast.warning("Workspace warning", {
        description: "The checkout is behind origin/main.",
        duration: 0,
      });
      await settleAsyncRender();
    });

    const alert = view.baseElement.querySelector('[role="alert"]');
    expect(alert === null).toBe(false);
    expect(Boolean(alert?.textContent?.includes("Workspace warning"))).toBe(true);
    expect(Boolean(alert?.textContent?.includes("The checkout is behind origin/main."))).toBe(true);
    expect(Boolean(view.getByRole("button", { name: "Dismiss notification" }))).toBe(true);
  });

  test("renders custom toasts and lets the custom content close itself", async () => {
    const view = render(<ToastHarness />);

    await act(async () => {
      toast.custom({
        level: "danger",
        duration: 0,
        hasCloseButton: false,
        content: ({ close, level }) => (
          <div className="flex items-center gap-2 p-3 text-sm">
            <span>{level}</span>
            <button type="button" onClick={close}>
              Dismiss custom toast
            </button>
          </div>
        ),
      });
      await settleAsyncRender();
    });

    expect(Boolean(view.baseElement.textContent?.includes("danger"))).toBe(true);

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Dismiss custom toast" }));
      await settleAsyncRender();
    });

    await waitFor(() => {
      if (view.baseElement.textContent?.includes("Dismiss custom toast")) {
        throw new Error("Expected the custom toast to close.");
      }
    });
  });

  test("exposes the shared controller through useToaster", async () => {
    function HookProbe() {
      const toaster = useToaster();
      return (
        <button
          type="button"
          onClick={() => {
            toaster.success("Hook toast", { duration: 0 });
          }}
        >
          Emit hook toast
        </button>
      );
    }

    const view = render(
      <NodexToastProvider>
        <HookProbe />
      </NodexToastProvider>,
    );

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Emit hook toast" }));
      await settleAsyncRender();
    });

    expect(Boolean(view.baseElement.textContent?.includes("Hook toast"))).toBe(true);
    expect(Boolean(view.baseElement.querySelector('[data-slot="toast-viewport"]'))).toBe(true);
  });
});
