import type { DoctorResult, ResolvedBundle } from "./types.ts";
import { yamlStringify } from "./yaml.ts";

export type OutputFormat = "human" | "yaml";

export function parseOutputFormat(args: string[]): OutputFormat {
  if (args.includes("--human")) return "human";
  return process.stdout.isTTY ? "human" : "yaml";
}

const REMOVED_FLAGS = ["--yaml", "--json"] as const;

export function rejectRemovedFlags(args: string[]): void {
  if (args.includes("--unset")) {
    throw new Error("unknown flag --unset (use: ap unset KEY)");
  }
  for (const flag of REMOVED_FLAGS) {
    if (args.includes(flag)) {
      throw new Error(`unknown flag ${flag} (YAML is default; use --human for pretty output)`);
    }
  }
}

export function stripOutputFlags(args: string[]): string[] {
  return args.filter((a) => a !== "--human");
}

export function printMachineOutput(data: unknown): void {
  console.log(yamlStringify(data));
}

export interface AgentBundleOutput {
  ready: boolean;
  ask?: string;
  prompt?: string;
  surfaced?: Record<string, string>;
  secrets?: string[];
  missing?: Array<{ key: string; ask?: string; set_with: string }>;
  next?: string;
}

export interface AgentUnbundledSecrets {
  set?: string[];
  missing?: Array<{ key: string; ask?: string; set_with: string }>;
}

export interface AgentShowOutput {
  ready: boolean;
  next?: string;
  bundles?: Record<string, AgentBundleOutput>;
  unbundled_secrets?: AgentUnbundledSecrets;
  project: string | null;
  global_home: string;
  validate?: DoctorResult["validate"];
}

function bundleToAgentOutput(bundle: ResolvedBundle): AgentBundleOutput {
  const out: AgentBundleOutput = { ready: bundle.ready };

  if (bundle.ask && !bundle.ready) out.ask = bundle.ask;

  if (bundle.ready && bundle.prompt) out.prompt = bundle.prompt;

  if (bundle.surfaced.length > 0) {
    out.surfaced = Object.fromEntries(bundle.surfaced.map((s) => [s.key, s.value]));
  }

  if (bundle.secrets_set.length > 0) out.secrets = bundle.secrets_set;

  if (bundle.missing.length > 0) {
    out.missing = bundle.missing.map((m) => ({
      key: m.key,
      ...(m.ask ? { ask: m.ask } : {}),
      set_with: m.set_with,
    }));
    out.next = bundle.missing[0]!.set_with;
  }

  return out;
}

function bundledKeys(result: DoctorResult): Set<string> {
  const keys = new Set<string>();
  for (const bundle of Object.values(result.bundles)) {
    for (const v of bundle.surfaced) keys.add(v.key);
    for (const key of bundle.secrets_set) keys.add(key);
    for (const v of bundle.missing) {
      if (v.key !== "(bundle)") keys.add(v.key);
    }
  }
  return keys;
}

export function showToAgentOutput(result: DoctorResult): AgentShowOutput {
  const bundles = Object.values(result.bundles);
  const serviced = bundledKeys(result);
  const unbundled = (result.vars ?? []).filter((v) => !serviced.has(v.key));

  const bundleOut = bundles.length > 0
    ? Object.fromEntries(bundles.map((b) => [b.name, bundleToAgentOutput(b)]))
    : undefined;

  const topNext =
    bundles.find((b) => !b.ready && b.missing[0])?.missing[0]?.set_with
    ?? unbundled.find((v) => v.status === "missing")?.set_with;

  const unbundledSet = unbundled.filter((v) => v.status === "set").map((v) => v.key);
  const unbundledMissing = unbundled
    .filter((v) => v.status === "missing")
    .map((v) => ({
      key: v.key,
      ...(v.ask ? { ask: v.ask } : {}),
      set_with: v.set_with ?? `ap set ${v.key}`,
    }));

  const unbundledOut: AgentUnbundledSecrets | undefined =
    unbundledSet.length > 0 || unbundledMissing.length > 0
      ? {
          ...(unbundledSet.length > 0 ? { set: unbundledSet } : {}),
          ...(unbundledMissing.length > 0 ? { missing: unbundledMissing } : {}),
        }
      : undefined;

  return {
    ready: result.ready,
    ...(topNext ? { next: topNext } : {}),
    ...(bundleOut ? { bundles: bundleOut } : {}),
    ...(unbundledOut ? { unbundled_secrets: unbundledOut } : {}),
    project: result.project,
    global_home: result.global_home,
    ...(result.validate ? { validate: result.validate } : {}),
  };
}
