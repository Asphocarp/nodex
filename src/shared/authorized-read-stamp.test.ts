import { describe, expect, test } from "vitest";

import { parseAuthorizedReadStamp, type AuthorityResource } from "./authorized-read-stamp";
import { authorizedReadStampFixture } from "./testing/authorized-read-stamp-fixture";

const address = {
  kind: "project",
  library_id: "library-1",
  project_id: "project-1",
} as const;

describe("AuthorizedReadStamp boundary", () => {
  test("rejects resource kinds outside the generated ResourceKey union", () => {
    const stamp = authorizedReadStampFixture({
      deliveryAddress: address,
      subject: { kind: "page", page_id: "page-1" },
    });

    expect(() =>
      parseAuthorizedReadStamp({
        ...stamp,
        authorization_dependencies: [{ kind: "unknown", unknown_id: "root-1" }],
      }),
    ).toThrow("Authorized read stamp is invalid");
  });

  test("rejects dependencies outside canonical ResourceKey order", () => {
    const dependencies: readonly AuthorityResource[] = [
      { kind: "page", page_id: "page-1" },
      { kind: "library", library_id: "library-1" },
    ];
    const stamp = authorizedReadStampFixture({
      deliveryAddress: address,
      subject: { kind: "page", page_id: "page-1" },
    });

    expect(() =>
      parseAuthorizedReadStamp({
        ...stamp,
        authorization_dependencies: dependencies,
      }),
    ).toThrow("Authorized read stamp is invalid");
  });
});
