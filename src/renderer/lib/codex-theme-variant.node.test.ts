import { describe, expect, test } from "vitest";
import {
  applyCodexThemeVariant,
  getCodexThemeVariantStyle,
} from "./codex-theme-variant";

function makeStyleTarget() {
  const declarations: Record<string, string> = {};
  const target = {
    style: {
      setProperty(name: string, value: string) {
        declarations[name] = value;
      },
    },
  } as HTMLElement;

  return { declarations, target };
}

describe("getCodexThemeVariantStyle", () => {
  test("defines the runtime semantic control and foreground tokens for light", () => {
    const styles = getCodexThemeVariantStyle("light");

    expect(styles["--color-background-control"]).toBe("rgba(255, 255, 255, 0.96)");
    expect(styles["--color-background-control-opaque"]).toBe("rgb(255, 255, 255)");
    expect(styles["--color-accent-blue"]).toBe("#339cff");
    expect(styles["--color-icon-error"]).toBe("#e02e2a");
    expect(styles["--color-text-error"]).toBe("#e02e2a");
    expect(styles["--color-text-warning"]).toBe("#e25507");
    expect(styles["--color-text-foreground"]).toBe("#1a1c1f");
    expect(styles["--color-border"]).toBe("rgba(26, 28, 31, 0.078)");
    expect(styles["--cursor-interaction"]).toBe("pointer");
  });

  test("defines the runtime semantic control and foreground tokens for dark", () => {
    const styles = getCodexThemeVariantStyle("dark");

    expect(styles["--color-background-control"]).toBe("rgba(45, 45, 45, 0.96)");
    expect(styles["--color-background-control-opaque"]).toBe("rgb(45, 45, 45)");
    expect(styles["--color-accent-blue"]).toBe("#339cff");
    expect(styles["--color-icon-error"]).toBe("#ff6764");
    expect(styles["--color-text-error"]).toBe("#ff6764");
    expect(styles["--color-text-warning"]).toBe("#fb6a22");
    expect(styles["--color-text-foreground"]).toBe("#ffffff");
    expect(styles["--color-border"]).toBe("rgba(255, 255, 255, 0.084)");
    expect(styles["--cursor-interaction"]).toBe("pointer");
  });

  test("applies document-scoped runtime interaction tokens to root and body", () => {
    const root = makeStyleTarget();
    const body = makeStyleTarget();

    applyCodexThemeVariant(root.target, "light", body.target);

    expect(root.declarations["--cursor-interaction"]).toBe("pointer");
    expect(body.declarations["--cursor-interaction"]).toBe("pointer");
  });
});
