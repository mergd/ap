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
    throw new Error("unknown flag --unset (use: ap unset KEY [--global])");
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

export interface AgentShowOutput {
  bundles?: Record<string, AgentBundleOutput>;
  unbundled_secrets?: Record<string, {
    status: "set" | "missing";
    ask?: string;
    set_with?: string;
  }>;
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

  return {
    ...(bundles.length > 0
      ? { bundles: Object.fromEntries(bundles.map((b) => [b.name, bundleToAgentOutput(b)])) }
      : {}),
    ...(unbundled.length > 0
      ? {
          unbundled_secrets: Object.fromEntries(unbundled.map((v) => [
            v.key,
            v.status === "missing"
              ? {
                  status: "missing" as const,
                  ...(v.ask ? { ask: v.ask } : {}),
                  ...(v.set_with ? { set_with: v.set_with } : {}),
                }
              : { status: "set" as const },
          ])),
        }
      : {}),
    project: result.project,
    global_home: result.global_home,
    ...(result.validate ? { validate: result.validate } : {}),
  };
}
