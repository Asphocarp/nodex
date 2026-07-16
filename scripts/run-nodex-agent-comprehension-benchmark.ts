import { readFileSync, writeFileSync } from "node:fs";
import {
  createNodexAgentComprehensionTemplate,
  summarizeNodexAgentComprehensionRun,
} from "./nodex-agent-comprehension-benchmark";

const [inputPath, outputPath] = process.argv.slice(2).filter((argument) => argument !== "--");

if (!inputPath || inputPath === "--v4") {
  console.log(JSON.stringify(
    createNodexAgentComprehensionTemplate(inputPath === "--v4" ? 4 : 2),
    null,
    2,
  ));
} else {
  const rawRun = JSON.parse(readFileSync(inputPath, "utf8")) as unknown;
  const summary = summarizeNodexAgentComprehensionRun(rawRun);
  const serialized = `${JSON.stringify(summary, null, 2)}\n`;
  if (outputPath) {
    writeFileSync(outputPath, serialized, "utf8");
  } else {
    console.log(serialized.trimEnd());
  }
}
