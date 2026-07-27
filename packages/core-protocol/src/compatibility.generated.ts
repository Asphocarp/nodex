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
      "contract_version": 4
    },
    {
      "module": "owned_document",
      "contract_version": 1
    },
    {
      "module": "project_workspace",
      "contract_version": 6
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
      "version": 94,
      "schema_fingerprint": "cb22ce09a3673bf14faf95d543f0208070b65a2d77be576a55295f4d5e649ae5"
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
