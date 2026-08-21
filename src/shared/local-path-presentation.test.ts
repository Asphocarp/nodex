import { describe, expect, it } from "vite-plus/test";
import { abbreviateHomeDirectory } from "./local-path-presentation";

describe("abbreviateHomeDirectory", () => {
  it("abbreviates the home directory and descendants on POSIX", () => {
    const context = { homeDirectory: "/Users/asc/", separator: "/" } as const;
    expect(abbreviateHomeDirectory("/Users/asc", context)).toBe("~");
    expect(abbreviateHomeDirectory("/Users/asc/repo/nodex", context)).toBe("~/repo/nodex");
    expect(abbreviateHomeDirectory("/Users/ascii/repo", context)).toBe("/Users/ascii/repo");
  });

  it("compares Windows paths case-insensitively", () => {
    const context = { homeDirectory: "C:\\Users\\Asc", separator: "\\" } as const;
    expect(abbreviateHomeDirectory("c:\\users\\asc\\repo", context)).toBe("~\\repo");
  });

  it("preserves the raw value when presentation context is unavailable", () => {
    expect(abbreviateHomeDirectory("/home/other/repo", null)).toBe("/home/other/repo");
  });
});
