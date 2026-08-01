import { act, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import {
  CoreAuthorityStatusNotice,
  resolveCoreAuthorityStatusPresentation,
} from "./core-authority-status";

describe("resolveCoreAuthorityStatusPresentation", () => {
  test("keeps the healthy state silent", () => {
    expect(resolveCoreAuthorityStatusPresentation({ kind: "ready" })).toBeNull();
  });

  test("distinguishes transient recovery from actionable unavailability", () => {
    expect(resolveCoreAuthorityStatusPresentation({
      attempt: 2,
      kind: "recovering",
    })).toMatchObject({ kind: "recovering", detail: null });
    expect(resolveCoreAuthorityStatusPresentation({
      circuitOpen: true,
      kind: "unavailable",
      message: "Automatic recovery was paused.",
    })).toEqual({
      detail: "Automatic recovery was paused.",
      kind: "unavailable",
      label: "Nodex Core is unavailable",
    });
  });
});

describe("CoreAuthorityStatusNotice", () => {
  test("offers one retry and relaunch boundary when recovery is unavailable", () => {
    const onRetry = vi.fn();
    const onRelaunch = vi.fn();
    render(
      <CoreAuthorityStatusNotice
        status={{
          circuitOpen: true,
          kind: "unavailable",
          message: "Automatic recovery was paused.",
        }}
        onRetry={onRetry}
        onRelaunch={onRelaunch}
      />,
    );

    act(() => screen.getByRole("button", { name: "Retry" }).click());
    act(() => screen.getByRole("button", { name: "Restart Nodex" }).click());

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRelaunch).toHaveBeenCalledOnce();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});
