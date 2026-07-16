import {
  formatDynamicToolCatalogMetrics,
  measureDynamicToolCatalog,
} from "../src/main/codex/dynamic-tool-catalog-metrics";
import { buildNodexAgentV3DynamicToolCatalog } from "../src/main/codex/nodex-dynamic-tool-registry";

const catalog = buildNodexAgentV3DynamicToolCatalog();
const metrics = measureDynamicToolCatalog(catalog);

console.log(`Nodex Agent dynamic-tool catalog: ${metrics.namespace}@3`);
console.log(formatDynamicToolCatalogMetrics(metrics));
console.log("bytes/4 is a tokenizer-independent orientation estimate, not a CI boundary.");
