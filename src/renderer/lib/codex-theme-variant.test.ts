import { describe, expect, test } from "bun:test";
import { getCodexThemeVariantStyle } from "./codex-theme-variant";

describe("getCodexThemeVariantStyle", () => {
  test("defines the runtime semantic control and foreground tokens for light", () => {
    const styles = getCodexThemeVariantStyle("light");

    expect(styles["--color-background-control"]).toBe("rgba(255, 255, 255, 0.96)");
    expect(styles["--color-background-control-opaque"]).toBe("rgb(255, 255, 255)");
    expect(styles["--color-text-foreground"]).toBe("#0d0d0d");
    expect(styles["--color-border"]).toBe("rgba(13, 13, 13, 0.078)");
  });

  test("defines the runtime semantic control and foreground tokens for dark", () => {
    const styles = getCodexThemeVariantStyle("dark");

    expect(styles["--color-background-control"]).toBe("rgba(45, 45, 45, 0.96)");
    expect(styles["--color-background-control-opaque"]).toBe("rgb(45, 45, 45)");
    expect(styles["--color-text-foreground"]).toBe("#ffffff");
    expect(styles["--color-border"]).toBe("rgba(255, 255, 255, 0.084)");
  });
});
