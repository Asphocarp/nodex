import type { components } from "./generated";

export const CORE_CLIENT_REQUIREMENTS = {
  "transport": {
    "min": 4,
    "max": 4
  },
  "event_version": 2,
  "modules": [
    {
      "module": "library",
      "contract_version": 2
    },
    {
      "module": "database",
      "contract_version": 3
    },
    {
      "module": "owned_document",
      "contract_version": 1
    },
    {
      "module": "project_workspace",
      "contract_version": 5
    },
    {
      "module": "automation",
      "contract_version": 2
    },
    {
      "module": "store_administration",
      "contract_version": 2
    }
  ],
  "accepted_store_formats": [
    {
      "lineage": "nodex-rust-core",
      "version": 93,
      "schema_fingerprint": "2fa30de4e34ff3fa30e5ceeb8ed8bef39cbb716466ec32fa8460db32aaba3e60"
    }
  ]
} as const satisfies components["schemas"]["CoreClientRequirements"];

export const CORE_TRANSPORT_BUDGETS = {
  "ordinary_json_request_bytes": 2097152,
  "ordinary_json_response_bytes": 16777216,
  "event_frame_bytes": 2359296,
  "document_json_request_bytes": 67108864,
  "document_response_bytes": 25165832
} as const satisfies components["schemas"]["CoreTransportBudgets"];
