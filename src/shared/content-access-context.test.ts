import { describe, expect, test } from "vitest";

import {
  libraryContentAccess,
  parseContentAccessContext,
  projectContentAccess,
} from "./content-access-context";

describe("ContentAccessContext", () => {
  test("keeps Project and Library route selection explicit", () => {
    expect(projectContentAccess("project-1")).toEqual({
      kind: "project",
      projectId: "project-1",
    });
    expect(parseContentAccessContext(libraryContentAccess)).toEqual({
      kind: "library",
    });
  });

  test("rejects caller-selected Library authority identities", () => {
    expect(() =>
      parseContentAccessContext({
        kind: "library",
        libraryId: "forged-library",
      }),
    ).toThrow("libraryId is not supported");
    expect(() =>
      parseContentAccessContext({ kind: "project", projectId: " project-1" }),
    ).toThrow("canonical non-empty identity");
  });
});
