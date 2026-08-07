import { getCatalogBundle, listCatalogBundles } from "./bundles.ts";
import { printMachineOutput, type OutputFormat } from "../agent-output.ts";

export function buildCatalogList(): {
  bundles: Record<string, {
    vars: string[];
    ask?: string;
    docs?: string;
    prompt?: string;
    run_example?: string;
  }>;
} {
  const bundles: Record<string, {
    vars: string[];
    ask?: string;
    docs?: string;
    prompt?: string;
    run_example?: string;
  }> = {};

  for (const name of listCatalogBundles()) {
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

export function formatCatalogHuman(): string {
  const { bundles } = buildCatalogList();
  const lines = ["ap catalog", ""];
  for (const [name, b] of Object.entries(bundles)) {
    lines.push(`  ${name}`);
    lines.push(`    vars: ${b.vars.join(", ")}`);
    if (b.ask) lines.push(`    ${b.ask}`);
    lines.push(`    ap init --global ${name}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function printCatalog(format: OutputFormat): void {
  if (format === "human") {
    console.log(formatCatalogHuman());
    return;
  }
  printMachineOutput(buildCatalogList());
}
