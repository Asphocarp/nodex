import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";
import { createMaitaiStore, MaitaiProvider } from "./maitai";
import { useSpellcheck } from "./use-spellcheck";

const SPELLCHECK_STORAGE_KEY = "nodex-spellcheck";

function SpellcheckProbe({ label }: { label: string }) {
  const { spellcheck, toggleSpellcheck } = useSpellcheck();
  return (
    <button type="button" onClick={toggleSpellcheck}>
      {label}:{spellcheck ? "on" : "off"}
    </button>
  );
}

describe("renderer preference App atoms", () => {
  beforeEach(() => {
    localStorage.removeItem(SPELLCHECK_STORAGE_KEY);
  });

  test("shares one preference value within a renderer and initializes each renderer from storage", () => {
    const firstStore = createMaitaiStore();
    const firstView = render(
      <MaitaiProvider store={firstStore}>
        <SpellcheckProbe label="first" />
        <SpellcheckProbe label="second" />
      </MaitaiProvider>,
    );

    expect(screen.getByRole("button", { name: "first:on" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "second:on" })).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "first:on" }));
    });

    expect(screen.getByRole("button", { name: "first:off" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "second:off" })).toBeTruthy();
    expect(localStorage.getItem(SPELLCHECK_STORAGE_KEY)).toBe("false");
    firstView.unmount();

    localStorage.setItem(SPELLCHECK_STORAGE_KEY, "true");
    render(
      <MaitaiProvider store={createMaitaiStore()}>
        <SpellcheckProbe label="third" />
      </MaitaiProvider>,
    );

    expect(screen.getByRole("button", { name: "third:on" })).toBeTruthy();
  });
});
