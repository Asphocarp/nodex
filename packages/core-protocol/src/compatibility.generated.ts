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
      "contract_version": 6
    },
    {
      "module": "database",
      "contract_version": 5
    },
    {
      "module": "owned_document",
      "contract_version": 3
    },
    {
      "module": "project_workspace",
      "contract_version": 9
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
      "version": 99,
      "schema_fingerprint": "ef391c695b1360bc738714b8e4506bb37d6c24430f94cc65edd454abaf525151"
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
