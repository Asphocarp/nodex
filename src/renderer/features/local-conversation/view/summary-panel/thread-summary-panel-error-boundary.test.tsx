import { describe, expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { act, useState } from "react";
import { render, textContent } from "../../../../test/dom";
import {
  ThreadSummaryPanelRenderBoundary,
  ThreadSummaryPanelRenderErrorFallback,
} from "./thread-summary-panel-error-boundary";

function ThrowingSummaryPanel({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Summary panel exploded");
  }

  return <div>Rendered summary panel</div>;
}

function RetryHarness() {
  const [shouldThrow, setShouldThrow] = useState(true);

  return (
    <ThreadSummaryPanelRenderBoundary
      fallback={({ resetError }) => (
        <ThreadSummaryPanelRenderErrorFallback
          mounted={true}
          onRetry={() => {
            setShouldThrow(false);
            resetError();
          }}
          open={true}
        />
      )}
      resetKey="thread-1"
    >
      <ThrowingSummaryPanel shouldThrow={shouldThrow} />
    </ThreadSummaryPanelRenderBoundary>
  );
}

function ResetKeyHarness() {
  const [threadId, setThreadId] = useState("thread-1");

  return (
    <>
      <button onClick={() => setThreadId("thread-2")} type="button">
        Switch thread
      </button>
      <ThreadSummaryPanelRenderBoundary
        fallback={({ resetError }) => (
          <ThreadSummaryPanelRenderErrorFallback
            mounted={true}
            onRetry={resetError}
            open={true}
          />
        )}
        resetKey={threadId}
      >
        <ThrowingSummaryPanel shouldThrow={threadId === "thread-1"} />
      </ThreadSummaryPanelRenderBoundary>
    </>
  );
}

async function withMutedReactErrorLogs(run: () => Promise<void> | void) {
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await run();
  } finally {
    console.error = originalConsoleError;
  }
}

describe("ThreadSummaryPanelRenderBoundary", () => {
  test("renders a floating retry fallback and recovers the summary panel subtree", async () => {
    await withMutedReactErrorLogs(async () => {
      const { container } = render(<RetryHarness />);

      expect(textContent(container).includes("Summary panel couldn't render")).toBeTrue();
      expect(container.querySelector('[data-pip-obstacle="thread-summary-panel"]')).not.toBeNull();
      expect((container.querySelector('[data-pip-obstacle="thread-summary-panel"]') as HTMLElement).style.width).toBe("300px");

      const retryButton = container.querySelector("button");
      expect(retryButton).not.toBeNull();

      await act(async () => {
        fireEvent.click(retryButton as HTMLButtonElement);
        await Promise.resolve();
      });

      expect(textContent(container).includes("Rendered summary panel")).toBeTrue();
      expect(textContent(container).includes("Summary panel couldn't render")).toBeFalse();
    });
  });

  test("resets an error when the thread identity changes", async () => {
    await withMutedReactErrorLogs(async () => {
      const { container } = render(<ResetKeyHarness />);

      expect(textContent(container).includes("Summary panel couldn't render")).toBeTrue();

      const switchButton = container.querySelector("button");
      expect(switchButton).not.toBeNull();

      await act(async () => {
        fireEvent.click(switchButton as HTMLButtonElement);
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(textContent(container).includes("Rendered summary panel")).toBeTrue();
      });
    });
  });

  test("keeps the fallback unmounted when the floating summary panel is hidden", () => {
    const { container, rerender } = render(
      <ThreadSummaryPanelRenderErrorFallback mounted={false} onRetry={() => {}} open={true} />,
    );

    expect(container.querySelector('[data-pip-obstacle="thread-summary-panel"]') === null).toBeTrue();

    rerender(<ThreadSummaryPanelRenderErrorFallback mounted={true} onRetry={() => {}} open={false} />);

    expect(container.querySelector('[data-pip-obstacle="thread-summary-panel"]') === null).toBeTrue();
  });
});
