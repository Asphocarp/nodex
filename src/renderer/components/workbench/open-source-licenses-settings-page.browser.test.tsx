import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { installWindowApi } from "@/test/browser-globals";
import "../../globals.css";
import { OpenSourceLicensesSettingsPage } from "./open-source-licenses-settings-page";

describe("OpenSourceLicensesSettingsPage browser layout", () => {
  test("keeps the visual notice document out of nested scroll and wrapped accessibility trees", async () => {
    installWindowApi({
      invoke: async () => ({ text: "dependency notices\n" }),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <OpenSourceLicensesSettingsPage onBack={() => {}} />
      </QueryClientProvider>,
    );

    const accessibleDocument = await view.findByRole("document", {
      name: "dependency notices",
    });
    const notices = accessibleDocument.querySelector("pre");
    expect(notices).not.toBeNull();
    expect(notices?.getAttribute("aria-hidden")).toBe("true");
    if (!notices) throw new Error("Expected the visual third-party notices document");
    const computedStyle = getComputedStyle(notices);

    expect(computedStyle.overflowX).toBe("visible");
    expect(computedStyle.overflowY).toBe("visible");
  });
});
