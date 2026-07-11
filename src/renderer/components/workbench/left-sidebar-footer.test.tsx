import { describe, expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import type { CodexAccountSnapshot } from "@/lib/types";
import { render, textContent } from "@/test/dom";
import { LeftSidebarFooter } from "./left-sidebar-footer";

const authenticatedAccount: CodexAccountSnapshot = {
  account: { type: "chatgpt", email: "dev@example.com", planType: "Plus" },
  requiresOpenAiAuth: false,
  pendingLogin: null,
  rateLimits: {
    primary: {
      usedPercent: 18,
      windowDurationMins: 300,
    },
    secondary: {
      usedPercent: 39,
      windowDurationMins: 7 * 24 * 60,
    },
  },
};

const signedOutAccount: CodexAccountSnapshot = {
  account: null,
  requiresOpenAiAuth: true,
  pendingLogin: null,
  rateLimits: null,
};

describe("LeftSidebarFooter", () => {
  test("renders authenticated quota as a double ring without the old text chip", async () => {
    const view = render(
      <NodexTooltipProvider>
        <LeftSidebarFooter
          onOpenSettings={() => undefined}
          account={authenticatedAccount}
          connection={{ status: "connected", retries: 0 }}
          onRefreshAccount={async () => authenticatedAccount}
          onLogout={async () => undefined}
        />
      </NodexTooltipProvider>,
    );

    const ring = view.getByRole("button", { name: "Usage remaining: 5h 82%, weekly 61%" });
    expect(Boolean(ring.querySelector('[data-rate-limit-ring="outer"]'))).toBe(true);
    expect(Boolean(ring.querySelector('[data-rate-limit-ring="inner"]'))).toBe(true);
    expect(textContent(view.container).includes("82% · 61%")).toBe(false);
  });

  test("shows existing account details on focus and refreshes once while opening", async () => {
    let refreshCount = 0;
    const view = render(
      <NodexTooltipProvider>
        <LeftSidebarFooter
          onOpenSettings={() => undefined}
          account={authenticatedAccount}
          connection={{ status: "connected", retries: 0 }}
          onRefreshAccount={async () => {
            refreshCount += 1;
            return authenticatedAccount;
          }}
          onLogout={async () => undefined}
        />
      </NodexTooltipProvider>,
    );

    const ring = view.getByRole("button", { name: "Usage remaining: 5h 82%, weekly 61%" });
    fireEvent.focus(ring);

    await waitFor(() => {
      const bodyText = textContent(view.container.ownerDocument.body);
      if (!bodyText.includes("dev@example.com") || !bodyText.includes("Rate limits remaining")) {
        throw new Error(`Expected account tooltip details, saw: ${bodyText}`);
      }
      expect(refreshCount).toBe(1);
    });

    fireEvent.focus(ring);
    await waitFor(() => {
      expect(refreshCount).toBe(1);
    });
  });

  test("does not render a quota ring for signed-out accounts", async () => {
    const view = render(
      <NodexTooltipProvider>
        <LeftSidebarFooter
          onOpenSettings={() => undefined}
          account={signedOutAccount}
          connection={{ status: "connected", retries: 0 }}
          onRefreshAccount={async () => signedOutAccount}
          onLogout={async () => undefined}
        />
      </NodexTooltipProvider>,
    );

    expect(Boolean(view.queryByTestId("sidebar-account-rate-limit-ring"))).toBe(false);
    expect(Boolean(view.getByRole("button", { name: "Settings" }))).toBe(true);
  });
});
