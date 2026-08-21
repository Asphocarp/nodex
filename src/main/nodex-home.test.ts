import path from "node:path";
import { describe, expect, test } from "vitest";
import { resolveNodexHomePath } from "./nodex-home";

const baseOptions = {
  cwd: "/workspace/project",
  env: {},
  userHome: "/home/user",
} satisfies Parameters<typeof resolveNodexHomePath>[0];

describe("resolveNodexHomePath", () => {
  test("prefers an absolute environment override", () => {
    expect(
      resolveNodexHomePath({
        ...baseOptions,
        env: { NODEX_HOME: "/profiles/work" },
        configuredHome: "/profiles/configured",
      }),
    ).toBe("/profiles/work");
  });

  test("resolves relative environment overrides from the launch directory", () => {
    expect(
      resolveNodexHomePath({
        ...baseOptions,
        env: { NODEX_HOME: "relative-profile" },
      }),
    ).toBe(path.join(baseOptions.cwd, "relative-profile"));
  });

  test("ignores a blank environment override", () => {
    expect(
      resolveNodexHomePath({
        ...baseOptions,
        env: { NODEX_HOME: "   " },
        configuredHome: "/profiles/configured",
      }),
    ).toBe("/profiles/configured");
  });

  test("resolves absolute, relative, and tilde-configured homes", () => {
    expect(
      resolveNodexHomePath({
        ...baseOptions,
        configuredHome: "/profiles/configured",
      }),
    ).toBe("/profiles/configured");
    expect(
      resolveNodexHomePath({
        ...baseOptions,
        configuredHome: "project-profile",
      }),
    ).toBe(path.join(baseOptions.cwd, "project-profile"));
    expect(
      resolveNodexHomePath({
        ...baseOptions,
        configuredHome: "~/custom-nodex",
      }),
    ).toBe("/home/user/custom-nodex");
  });

  test("defaults to the hidden Nodex home under the user home", () => {
    expect(resolveNodexHomePath(baseOptions)).toBe("/home/user/.nodex");
  });
});
