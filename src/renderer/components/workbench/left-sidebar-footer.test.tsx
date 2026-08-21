import { describe, expect, test } from "vite-plus/test";
import { act, fireEvent, waitFor } from "@testing-library/react";
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
  rateLimitResetCredits: {
    availableCount: 2,
    credits: [
      {
        id: "reset-credit-1",
        resetType: "codexRateLimits",
        status: "available",
        grantedAt: 1_784_246_400,
        expiresAt: 1_810_166_400,
        title: "Quota reset",
        description: "Reset an eligible Codex quota window.",
      },
    ],
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
          onConsumeRateLimitReset={async () => ({
            outcome: "reset",
            account: authenticatedAccount,
          })}
          onLogout={async () => undefined}
        />
      </NodexTooltipProvider>,
    );

    const ring = view.getByRole("button", { name: "Usage remaining: 5h 82%, weekly 61%" });
    fireEvent.focus(ring);

    await waitFor(() => {
      const bodyText = textContent(view.container.ownerDocument.body);
      if (!bodyText.includes("dev@example.com") || !bodyText.includes("Usage remaining")) {
        throw new Error(`Expected account tooltip details, saw: ${bodyText}`);
      }
      expect(refreshCount).toBe(1);
    });

    fireEvent.focus(ring);
    await waitFor(() => {
      expect(refreshCount).toBe(1);
    });
  });

  test("keeps quota resets collapsed and reuses the attempt key after a transport failure", async () => {
    const attempts: Array<{ idempotencyKey: string; creditId?: string | null }> = [];
    const view = render(
      <NodexTooltipProvider>
        <LeftSidebarFooter
          onOpenSettings={() => undefined}
          account={authenticatedAccount}
          connection={{ status: "connected", retries: 0 }}
          onRefreshAccount={async () => authenticatedAccount}
          onConsumeRateLimitReset={async (input) => {
            attempts.push(input);
            if (attempts.length === 1) throw new Error("transport unavailable");
            return {
              outcome: "alreadyRedeemed",
              account: {
                ...authenticatedAccount,
                rateLimitResetCredits: {
                  availableCount: 1,
                  credits: [],
                },
              },
            };
          }}
          onLogout={async () => undefined}
        />
      </NodexTooltipProvider>,
    );

    fireEvent.focus(view.getByTestId("sidebar-account-rate-limit-ring"));
    const disclosures = await view.findAllByRole("button", { name: "2 available resets" });
    const disclosure = disclosures.at(-1);
    if (!disclosure) throw new Error("Expected quota-reset disclosure");
    const rateLimitHeadings = await view.findAllByText("Usage remaining");
    const rateLimitSection = rateLimitHeadings.at(-1)?.parentElement;
    expect(rateLimitSection?.contains(disclosure)).toBe(true);
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(Boolean(view.queryByRole("button", { name: "Reset quota" }))).toBe(false);

    await act(async () => {
      fireEvent.click(disclosure);
      await Promise.resolve();
    });
    const resetButton = await view.findByRole("button", { name: "Reset quota" });

    await act(async () => {
      fireEvent.click(resetButton);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        textContent(view.container.ownerDocument.body).includes("Couldn’t reset quota. Try again."),
      ).toBe(true);
    });

    await act(async () => {
      fireEvent.click(resetButton);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        textContent(view.container.ownerDocument.body).includes("Quota reset. 1 remaining."),
      ).toBe(true);
    });

    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.idempotencyKey).toBe(attempts[1]?.idempotencyKey);
    expect(attempts[0]?.creditId).toBe("reset-credit-1");
  });

  test("shows sign-in in the quota slot for signed-out accounts", async () => {
    let chatGptLoginCount = 0;
    const view = render(
      <NodexTooltipProvider>
        <LeftSidebarFooter
          onOpenSettings={() => undefined}
          account={signedOutAccount}
          connection={{ status: "connected", retries: 0 }}
          onRefreshAccount={async () => signedOutAccount}
          onStartChatGptLogin={async () => {
            chatGptLoginCount += 1;
            return { type: "apiKey" };
          }}
          onStartApiKeyLogin={async () => ({ type: "apiKey" })}
          onCancelLogin={async () => ({ status: "canceled" })}
          onLogout={async () => undefined}
        />
      </NodexTooltipProvider>,
    );

    expect(Boolean(view.queryByTestId("sidebar-account-rate-limit-ring"))).toBe(false);
    expect(Boolean(view.getByRole("button", { name: "Settings" }))).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Sign in" }));

    const chatGptLogin = await view.findByRole("button", { name: "Sign in with ChatGPT" });
    fireEvent.click(chatGptLogin);

    await waitFor(() => {
      expect(chatGptLoginCount).toBe(1);
    });
  });

  test("keeps the account slot empty until the account snapshot hydrates", () => {
    const view = render(
      <NodexTooltipProvider>
        <LeftSidebarFooter
          onOpenSettings={() => undefined}
          account={null}
          connection={{ status: "connected", retries: 0 }}
          onRefreshAccount={async () => signedOutAccount}
          onStartChatGptLogin={async () => ({ type: "apiKey" })}
          onStartApiKeyLogin={async () => ({ type: "apiKey" })}
          onCancelLogin={async () => ({ status: "canceled" })}
          onLogout={async () => undefined}
        />
      </NodexTooltipProvider>,
    );

    expect(Boolean(view.queryByRole("button", { name: "Sign in" }))).toBe(false);
    expect(Boolean(view.queryByTestId("sidebar-account-rate-limit-ring"))).toBe(false);
  });
});
