import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { render } from "../../../../test/dom";
import { NodexTooltipProvider } from "../../../../components/ui/tooltip";
import {
  AssistantRatingButton,
  ForkMessageIcon,
  MessageTimestamp,
  ThreadActionIconButton,
  type AssistantMessageRating,
} from "./thread-message-actions";

describe("MessageTimestamp", () => {
  test("renders no node when sentAtMs is missing", () => {
    const { container } = render(<MessageTimestamp sentAtMs={null} />);

    expect(container.textContent).toBe("");
    expect(container.querySelector("span") === null).toBeTrue();
  });

  test("renders localized short time", () => {
    const sentAtMs = 180_000;
    const expectedTime = new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(sentAtMs));
    const { container } = render(<MessageTimestamp sentAtMs={sentAtMs} />);
    const timestamp = container.querySelector("span span");

    expect(timestamp?.textContent).toBe(expectedTime);
  });
});

describe("ThreadActionIconButton", () => {
  test("passes a concise tooltip while preserving the descriptive aria label", () => {
    const { getByRole } = render(
      <NodexTooltipProvider>
        <ThreadActionIconButton label="Fork from this point" tooltip="Fork">
          <ForkMessageIcon />
        </ThreadActionIconButton>
      </NodexTooltipProvider>,
    );

    const button = getByRole("button", { name: "Fork from this point" });
    expect(button.getAttribute("title")).toBe(null);
  });

  test("renders a plain button when no tooltip is requested", () => {
    const { getByRole, container } = render(
      <ThreadActionIconButton label="Edit message">
        <ForkMessageIcon />
      </ThreadActionIconButton>,
    );

    expect(Boolean(container.querySelector("[data-tooltip-content]"))).toBeFalse();
    expect(Boolean(getByRole("button", { name: "Edit message" }))).toBeTrue();
  });
});

describe("AssistantRatingButton", () => {
  test("marks the selected rating as pressed and emits selection changes", () => {
    const selectedRatings: AssistantMessageRating[] = [];
    const { getByRole, rerender } = render(
      <NodexTooltipProvider>
        <AssistantRatingButton
          rating="thumbs_up"
          selectedRating={null}
          onSelect={(rating) => {
            selectedRatings.push(rating);
          }}
        />
      </NodexTooltipProvider>,
    );

    const button = getByRole("button", { name: "Good response" });
    expect(button.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(button);
    expect(selectedRatings[0]).toBe("thumbs_up");

    rerender(
      <NodexTooltipProvider>
        <AssistantRatingButton
          rating="thumbs_up"
          selectedRating="thumbs_up"
          onSelect={(rating) => {
            selectedRatings.push(rating);
          }}
        />
      </NodexTooltipProvider>,
    );

    const selectedButton = getByRole("button", { name: "Good response" });
    expect(selectedButton.getAttribute("aria-pressed")).toBe("true");
  });
});
