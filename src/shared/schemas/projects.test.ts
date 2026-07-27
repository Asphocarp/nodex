import { describe, expect, it } from "vitest";
import {
  ProjectCreateInputSchema,
  ProjectUpdateInputSchema,
} from "./projects";

describe("Project mutation schemas", () => {
  it("rejects the removed legacy icon authority on create and update", () => {
    expect(ProjectCreateInputSchema.safeParse({ icon: "🚀" }).success).toBe(false);
    expect(ProjectUpdateInputSchema.safeParse({ icon: "🚀" }).success).toBe(false);
  });

  it("rejects malformed revision fences instead of treating them as omitted", () => {
    for (const expectedBindingRevision of [0, -1, 1.5, "2", null]) {
      expect(ProjectUpdateInputSchema.safeParse({
        expectedBindingRevision,
        name: "Nodex",
      }).success).toBe(false);
    }
    expect(ProjectUpdateInputSchema.safeParse({
      expectedBindingRevision: 2,
      name: "Nodex",
    }).success).toBe(true);
  });
});
