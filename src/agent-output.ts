import type { DoctorResult, ResolvedBundle, ResolvedVar } from "./types.ts";
import { yamlStringify } from "./yaml.ts";

export type OutputFormat = "human" | "yaml";

export function parseOutputFormat(args: string[]): OutputFormat {
  if (args.includes("--human")) return "human";
  return "yaml";
}

const REMOVED_FLAGS = ["--yaml", "--json"] as const;

export function rejectRemovedFlags(args: string[]): void {
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

export interface AgentDoctorOutput {
  ready: boolean;
  bundles?: Record<string, AgentBundleOutput>;
  project?: string | null;
  global_home?: string;
  vars?: Record<string, { status: "set" | "missing" | "surfaced"; value?: string; ask?: string; set_with?: string }>;
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

function varToAgentEntry(v: ResolvedVar): {
  status: "set" | "missing" | "surfaced";
  value?: string;
  ask?: string;
  set_with?: string;
} {
  if (v.status === "missing") {
    return {
      status: "missing",
      ...(v.ask ? { ask: v.ask } : {}),
      ...(v.set_with ? { set_with: v.set_with } : {}),
    };
  }
  if (v.visibility === "public" && v.value !== undefined) {
    return { status: "surfaced", value: v.value };
  }
  return { status: "set" };
}

export function doctorToAgentOutput(result: DoctorResult): AgentDoctorOutput {
  const bundles = Object.values(result.bundles);
  const out: AgentDoctorOutput = { ready: result.ready };

  if (bundles.length > 0) {
    out.bundles = Object.fromEntries(
      bundles.map((b) => [b.name, bundleToAgentOutput(b)]),
    );
  } else if (result.vars) {
    out.vars = Object.fromEntries(result.vars.map((v) => [v.key, varToAgentEntry(v)]));
  }

  if (result.project !== undefined) out.project = result.project;
  if (result.global_home) out.global_home = result.global_home;
  if (result.validate) out.validate = result.validate;

  return out;
}
