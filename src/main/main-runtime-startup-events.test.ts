import { describe, expect, test } from "vitest";
import { collectSecondInstancesForStartupReplay } from "./main-runtime-startup-events";

describe("collectSecondInstancesForStartupReplay", () => {
  test("consumes initial argv and queued deep links before replaying plain second instances", () => {
    const calls: string[] = [];
    const replay = collectSecondInstancesForStartupReplay(
      {
        initialArgv: ["--flag", "nodex://pages/card-1"],
        startupEvents: [
          { type: "open-url", url: "nodex://sessions/session-1" },
          { type: "second-instance", argv: ["nodex://pages/card-2"] },
          { type: "second-instance", argv: ["--new-window"] },
        ],
      },
      {
        consumeArgvDeepLink: (argv) => {
          calls.push(`argv:${argv.join(",")}`);
          return argv.some((arg) => arg.startsWith("nodex://"));
        },
        consumeOpenUrlDeepLink: (url) => {
          calls.push(`url:${url}`);
        },
      },
    );

    expect(calls.join("|")).toBe(
      "argv:--flag,nodex://pages/card-1|url:nodex://sessions/session-1|argv:nodex://pages/card-2|argv:--new-window",
    );
    expect(replay.length).toBe(1);
    expect(replay[0]?.join(",")).toBe("--new-window");
  });
});
