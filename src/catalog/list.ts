import { listCatalogBundles, getCatalogBundle } from "./bundles.ts";

export function formatCatalogList(json: boolean): string | void {
  const names = listCatalogBundles();

  if (json) {
    const bundles: Record<string, unknown> = {};
    for (const name of names) {
      const entry = getCatalogBundle(name)!;
      bundles[name] = {
        vars: Object.keys(entry.vars),
        ask: entry.ask,
        docs: entry.docs,
        prompt: entry.prompt,
      };
    }
    return JSON.stringify({ bundles }, null, 2);
  }

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

export function printCatalogList(json: boolean): void {
  const output = formatCatalogList(json);
  if (output) console.log(output);
}
