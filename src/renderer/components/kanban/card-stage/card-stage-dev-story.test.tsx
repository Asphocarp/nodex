import { describe, expect, vi, test } from "vitest";
import { render, textContent } from "../../../test/dom";
import { CARD_STAGE_STORY_DEFAULT_PRESET } from "./card-stage-dev-story-data";

describe("card stage dev story", () => {
  test("renders the Storybook scene shell", async () => {
    vi.doMock("./card-stage-dev-story-deps", () => ({
      CardStage: () => <div>Mock CardStage Preview</div>,
    }));

    const { CardStageDevStoryPage } = await import("./card-stage-dev-story");
    const { container, getByText, queryByText } = render(
      <CardStageDevStoryPage {...CARD_STAGE_STORY_DEFAULT_PRESET.controls} renderPreview={false} />,
    );

    expect(getByText("Card Stage").textContent).toBe("Card Stage");
    expect(textContent(container).includes("Controls panel")).toBe(true);
    expect(queryByText("Card Stage Story") === null).toBe(true);
    expect(queryByText("Dense Threads") === null).toBe(true);
    expect(getByText("Preview disabled for tests.").textContent).toBe("Preview disabled for tests.");
  });
});
