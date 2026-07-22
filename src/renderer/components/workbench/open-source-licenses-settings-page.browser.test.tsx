import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { installWindowApi } from "@/test/browser-globals";
import "../../globals.css";
import { OpenSourceLicensesSettingsPage } from "./open-source-licenses-settings-page";

describe("OpenSourceLicensesSettingsPage browser layout", () => {
  test("keeps the exact notice document behind a viewport-rendered visual source", async () => {
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
    expect(accessibleDocument.getAttribute("aria-label")).toBe("dependency notices\n");
    expect(accessibleDocument.querySelector("pre")).toBeNull();
    expect(await view.findByLabelText("Open source license text")).toBeDefined();
    expect(accessibleDocument.querySelectorAll(".cm-line").length).toBeLessThan(100);
  });
});
