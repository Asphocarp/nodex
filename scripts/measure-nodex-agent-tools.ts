import {
  formatDynamicToolCatalogMetrics,
  measureDynamicToolCatalog,
} from "../src/main/codex/dynamic-tool-catalog-metrics";
import {
  buildNodexAgentV2DynamicToolCatalog,
  buildNodexAgentV3DynamicToolCatalog,
} from "../src/main/codex/nodex-dynamic-tool-registry";

const requestedV3 = process.argv.slice(2).includes("--v3");
const catalog = requestedV3
  ? buildNodexAgentV3DynamicToolCatalog()
  : buildNodexAgentV2DynamicToolCatalog();
const metrics = measureDynamicToolCatalog(catalog);

console.log(`Nodex Agent dynamic-tool catalog: ${metrics.namespace}@${requestedV3 ? 3 : 2}`);
console.log(formatDynamicToolCatalogMetrics(metrics));
console.log("bytes/4 is a tokenizer-independent orientation estimate, not a CI boundary.");
