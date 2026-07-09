import type { DoctorResult, ResolvedBundle, ResolvedVar } from "./types.ts";

const KEY_COL = 22;

const tty = process.stdout.isTTY ?? false;
const color = process.env.NO_COLOR === undefined;

function wrap(code: number, text: string): string {
  if (!tty || !color) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

const bold = (s: string) => wrap(1, s);
const dim = (s: string) => wrap(2, s);
const green = (s: string) => wrap(32, s);
const red = (s: string) => wrap(31, s);
const yellow = (s: string) => wrap(33, s);
const cyan = (s: string) => wrap(36, s);

function padKey(key: string): string {
  return key.length >= KEY_COL ? key : key + " ".repeat(KEY_COL - key.length);
}

function formatBundle(bundle: ResolvedBundle): string[] {
  const lines: string[] = [];
  const status = bundle.ready ? green("ready") : yellow("not ready");
  lines.push("");
  lines.push(`  ${bold(bundle.name)}  ${dim("·")}  ${status}`);

  if (bundle.ask && !bundle.ready) {
    lines.push(`  ${dim(bundle.ask)}`);
  }

  if (bundle.prompt && bundle.ready) {
    lines.push(`  ${dim("prompt")}`);
    for (const line of bundle.prompt.split("\n")) {
      lines.push(`    ${dim(line)}`);
    }
  }

  if (bundle.surfaced.length > 0) {
    lines.push("");
    lines.push(`  ${dim("surfaced")}`);
    for (const { key, value } of bundle.surfaced) {
      lines.push(`    ${cyan(padKey(key))}${value}`);
    }
  }

  if (bundle.secrets_set.length > 0) {
    lines.push("");
    lines.push(`  ${dim("secrets")}`);
    for (const key of bundle.secrets_set) {
      lines.push(`    ${green("●")} ${padKey(key)}${dim("set")}`);
    }
  }

  if (bundle.missing.length > 0) {
    lines.push("");
    lines.push(`  ${dim("missing")}`);
    for (const m of bundle.missing) {
      if (m.key === "(bundle)") {
        lines.push(`    ${red("!")} ${dim(m.ask ?? "unknown bundle")}`);
        lines.push(`      ${cyan(m.set_with)}`);
        continue;
      }
      lines.push(`    ${yellow("○")} ${bold(padKey(m.key))}${cyan(m.set_with)}`);
      if (m.ask && m.ask !== bundle.ask) {
        lines.push(`      ${dim(m.ask)}`);
      }
    }
  }

  return lines;
}

function formatVarFallback(vars: ResolvedVar[]): string[] {
  const lines: string[] = [""];
  for (const v of vars) {
    if (v.status === "set") {
      const label = v.masked ? dim("secret") : (v.value ?? v.storage);
      lines.push(`  ${green("●")} ${padKey(v.key)}${label}`);
    } else {
      lines.push(`  ${yellow("○")} ${bold(padKey(v.key))}${cyan(v.set_with ?? "")}`);
      if (v.ask) lines.push(`    ${dim(v.ask)}`);
    }
  }
  return lines;
}

export function printShow(result: DoctorResult): void {
  const bundles = Object.values(result.bundles);
  const bundled = new Set<string>();
  for (const bundle of bundles) {
    for (const v of bundle.surfaced) bundled.add(v.key);
    for (const key of bundle.secrets_set) bundled.add(key);
    for (const v of bundle.missing) {
      if (v.key !== "(bundle)") bundled.add(v.key);
    }
  }
  const unbundled = (result.vars ?? []).filter((v) => !bundled.has(v.key));

  console.log("");
  console.log(`  ${bold("ap show")}`);

  if (bundles.length > 0) {
    console.log(`  ${dim("bundles")}`);
    for (const bundle of bundles) {
      for (const line of formatBundle(bundle)) console.log(line);
    }
  }

  if (unbundled.length > 0) {
    console.log("");
    console.log(`  ${dim("unbundled secrets")}`);
    for (const line of formatVarFallback(unbundled)) console.log(line);
  }

  console.log("");
}
