import type { AuthorizedReadStamp } from "../authorized-read-stamp";

/** Browser-safe, cryptographically valid authority evidence for UI fixtures. */
export const AUTHORIZED_READ_STAMP_EXAMPLE: AuthorizedReadStamp = {
  store_epoch: "store-1",
  delivery_address: { kind: "library", library_id: "library-1" },
  authorization_scope: { kind: "library", library_id: "library-1" },
  subject: { kind: "library", library_id: "library-1" },
  request_dependencies: [{ kind: "library", library_id: "library-1" }],
  authorization_dependencies: [{ kind: "library", library_id: "library-1" }],
  covered_commit_seq: 1,
  stamp_hash: "1df14c8dd9fad101bbddb20ddb8da8596614903c73242cf440ed323c562bfac5",
};
