import { describe, expect, test } from "vite-plus/test";
import { render } from "../../../test/dom";
import { ThreadLiveActivityFallback } from "./local-conversation-thread-turn";

describe("ThreadLiveActivityFallback", () => {
  test("renders the live reasoning text through the shared shimmer primitive", () => {
    const { container } = render(
      <ThreadLiveActivityFallback message="Checking the patch stream." />,
    );

    const shimmer = container.querySelector(".loading-shimmer-pure-text");
    expect(shimmer?.textContent).toContain("Checking the patch stream.");
    expect(container.querySelectorAll(".loading-shimmer-pure-text")).toHaveLength(1);
  });
});
