import { describe, expect, test } from "bun:test";
import { createRef } from "react";
import { render } from "@/test/dom";
import { Input } from "./input";

describe("shared input", () => {
  test("renders the thin Nodex form-input contract", () => {
    const view = render(<Input placeholder="Project name" />);
    const input = view.container.querySelector('input[placeholder="Project name"]') as HTMLInputElement | null;

    expect(Boolean(input)).toBeTrue();
    expect(input?.getAttribute("data-slot")).toBe("input");
    expect(input?.className.includes("bg-token-input-background")).toBeTrue();
    expect(input?.className.includes("border-token-input-border")).toBeTrue();
    expect(input?.className.includes("focus:border-token-focus-border")).toBeTrue();
    expect(input?.className.includes("shadow-xs")).toBeFalse();
    expect(input?.className.includes("selection:bg-primary")).toBeFalse();
  });

  test("forwards refs to the native input element", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} defaultValue="Nodex" />);

    expect(ref.current instanceof HTMLInputElement).toBeTrue();
    expect(ref.current?.value === "Nodex").toBeTrue();
  });
});
