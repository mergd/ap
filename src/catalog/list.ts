import { listCatalogBundles, getCatalogBundle } from "./bundles.ts";
import type { OutputFormat } from "../agent-output.ts";
import { printMachineOutput } from "../agent-output.ts";

function buildCatalogOutput(): { bundles: Record<string, unknown> } {
  const names = listCatalogBundles();
  const bundles: Record<string, unknown> = {};
  for (const name of names) {
    const entry = getCatalogBundle(name)!;
    bundles[name] = {
      vars: Object.keys(entry.vars),
      ...(entry.ask ? { ask: entry.ask } : {}),
      ...(entry.docs ? { docs: entry.docs } : {}),
      ...(entry.prompt ? { prompt: entry.prompt } : {}),
      ...(entry.run_example ? { run_example: entry.run_example } : {}),
    };
  }
  return { bundles };
}

function formatCatalogHuman(): string {
  const names = listCatalogBundles();
  const lines = ["", "  ap catalog", ""];
  for (const name of names) {
    const entry = getCatalogBundle(name)!;
    lines.push(`  ${name}`);
    lines.push(`    ${Object.keys(entry.vars).join(", ")}`);
    if (entry.ask) lines.push(`    ${entry.ask}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function printCatalogList(format: OutputFormat): void {
  if (format === "human") {
    console.log(formatCatalogHuman());
    return;
  }
  printMachineOutput(buildCatalogOutput());
}
