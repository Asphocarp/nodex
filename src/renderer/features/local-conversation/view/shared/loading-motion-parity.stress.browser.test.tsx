import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { BrowserTabFavicon } from "@/features/browser-sidebar/browser-tab-favicon";
import {
  createMaitaiStore,
  disposeMaitaiStore,
  MaitaiProvider,
} from "@/lib/maitai";
import { REDUCED_MOTION_STORAGE_KEY } from "@/lib/reduced-motion";
import { ReducedMotionProvider } from "@/lib/use-reduced-motion";
import { readLoadingAnimations } from "@/test/loading-motion";
import {
  GeneratedImagePlaceholder,
} from "@/features/user-attachment-image-editor";
import {
  getGeneratedImageAnimationClockSubscriberCount,
} from "@/features/user-attachment-image-editor/view/generated-image-animation-clock";
import { CodexShimmerProvider, CodexShimmerText } from "./codex-shimmer-text";
import { SubagentAvatar } from "./subagent-avatar";
import "../../../../globals.css";

afterEach(() => {
  localStorage.removeItem(REDUCED_MOTION_STORAGE_KEY);
});

describe("loading motion stress topology", () => {
  test("keeps forty Subagents static and schedules only the visible pending image", async () => {
    localStorage.setItem(REDUCED_MOTION_STORAGE_KEY, "off");
    const store = createMaitaiStore();
    const view = render(
      <MaitaiProvider store={store}>
        <ReducedMotionProvider>
          <div data-testid="stress-root">
            <div data-testid="subagent-grid">
              {Array.from({ length: 40 }, (_, index) => (
                <div key={index}>
                  <SubagentAvatar seed={`subagent-${index}`} />
                  <span>{`Subagent ${index} is working`}</span>
                </div>
              ))}
            </div>

            <CodexShimmerProvider enabled={false}>
              <CodexShimmerText data-testid="nested-activity">
                Nested tool detail
              </CodexShimmerText>
            </CodexShimmerProvider>

            <div className="fixed top-0 left-0 grid grid-cols-3 gap-2">
              <div className="size-48">
                <GeneratedImagePlaceholder hidden={false} seed="visible" />
              </div>
              {Array.from({ length: 5 }, (_, index) => (
                <div className="size-48" key={index}>
                  <GeneratedImagePlaceholder hidden seed={`hidden-${index}`} />
                </div>
              ))}
            </div>

            <div className="size-4" data-testid="settled-browser">
              <BrowserTabFavicon
                faviconUrl={undefined}
                isLoading={false}
                isWaitingForResponse={false}
              />
            </div>
          </div>
        </ReducedMotionProvider>
      </MaitaiProvider>,
    );

    try {
      await waitFor(() => {
        expect(getGeneratedImageAnimationClockSubscriberCount()).toBe(1);
      });
      await new Promise((resolve) => setTimeout(resolve, 350));

      expect(readLoadingAnimations(view.getByTestId("subagent-grid")))
        .toEqual([]);
      expect(readLoadingAnimations(view.getByTestId("nested-activity")))
        .toEqual([]);
      expect(view.getByTestId("settled-browser").querySelector(
        "[data-browser-tab-throbber='true']",
      )).toBeNull();
      expect(readLoadingAnimations(view.getByTestId("settled-browser")))
        .toEqual([]);

      const dotFields = view.container.querySelectorAll(
        '[data-generated-image-dot-field="true"]',
      );
      expect(dotFields).toHaveLength(6);
      expect(view.container.querySelectorAll(
        '[data-generated-image-dot-field="true"][data-animate="true"]',
      )).toHaveLength(1);
      const imageAnimations = [...dotFields].flatMap((element) => (
        readLoadingAnimations(element)
      ));
      expect(imageAnimations).toHaveLength(1);
      expect(imageAnimations[0]?.animatedProperties).toEqual(["opacity"]);
    } finally {
      view.unmount();
      disposeMaitaiStore(store);
    }

    await waitFor(() => {
      expect(getGeneratedImageAnimationClockSubscriberCount()).toBe(0);
    });
  });
});
