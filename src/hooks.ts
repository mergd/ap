import { isAbsolute, resolve } from "node:path";
import { loadManifest } from "./manifest.ts";
import {
  findProjectRoot,
  globalManifestPath,
  projectHookScript,
  projectManifestPath,
} from "./paths.ts";
import { pathExists } from "./fs-helpers.ts";
import { spawnAsync, type SpawnOptions } from "./spawn.ts";
import type { HookEvent, Manifest, ManifestHooks } from "./types.ts";

const DISABLED_VALUES = new Set(["", "none", "off", "false"]);

export type SpawnFn = (
  command: string,
  args: string[],
  options?: SpawnOptions,
) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface HookPlan {
  event: HookEvent;
  script: string;
  implied: boolean;
}

export interface HookSkip {
  skip: string;
}

export function hooksDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.AP_NO_HOOKS?.toLowerCase();
  return value === "1" || value === "true";
}

function isDisabledBinding(value: string | undefined): boolean {
  return value !== undefined && DISABLED_VALUES.has(value.trim().toLowerCase());
}

function mergeHooks(project: Manifest | null, global: Manifest | null): ManifestHooks {
  return { ...global?.hooks, ...project?.hooks };
}

export function resolveHookScriptPath(projectRoot: string | null, bound: string, cwd = process.cwd()): string {
  if (isAbsolute(bound)) return bound;
  return resolve(projectRoot ?? cwd, bound);
}

export async function resolveHookPlan(
  event: HookEvent,
  options: {
    projectManifest?: Manifest | null;
    globalManifest?: Manifest | null;
    projectRoot?: string | null;
    env?: NodeJS.ProcessEnv;
    exists?: (path: string) => Promise<boolean>;
  } = {},
): Promise<HookPlan | HookSkip> {
  const env = options.env ?? process.env;
  if (hooksDisabled(env)) return { skip: "disabled" };

  const exists = options.exists ?? pathExists;
  const merged = mergeHooks(options.projectManifest ?? null, options.globalManifest ?? null);
  const bound = merged[event];

  if (isDisabledBinding(bound)) return { skip: "off" };

  if (bound && bound.trim()) {
    return {
      event,
      script: resolveHookScriptPath(options.projectRoot ?? null, bound.trim()),
      implied: false,
    };
  }

  const projectRoot = options.projectRoot;
  if (!projectRoot) return { skip: "unbound" };

  const fallback = projectHookScript(projectRoot, event);
  if (await exists(fallback)) {
    return { event, script: fallback, implied: true };
  }

  return { skip: "unbound" };
}

export async function runHookPlan(
  plan: HookPlan,
  options: {
    cwd?: string;
    spawn?: SpawnFn;
    fail: "closed" | "open";
    detached?: boolean;
  },
): Promise<void> {
  const spawn = options.spawn ?? spawnAsync;
  const detached = options.detached ?? false;

  if (plan.implied && !(await pathExists(plan.script))) return;

  let result: { code: number; stdout: string; stderr: string };
  try {
    result = await spawn(plan.script, [], {
      cwd: options.cwd,
      stdin: "ignore",
      stdout: detached ? "ignore" : "inherit",
      stderr: detached ? "ignore" : "inherit",
      detached,
    });
  } catch (err) {
    const code = err instanceof Error && "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
    const message =
      code === "ENOENT"
        ? `hook ${plan.event}: script not found: ${plan.script}`
        : `hook ${plan.event}: ${err instanceof Error ? err.message : String(err)}`;
    if (options.fail === "open" || detached) {
      console.error(`ap: ${message}`);
      return;
    }
    throw new Error(message);
  }

  if (detached || result.code === 0) return;

  const message = `hook ${plan.event} failed (exit ${result.code})`;
  if (options.fail === "open") {
    console.error(`ap: ${message}`);
    return;
  }
  throw new Error(message);
}

function hookExec(event: HookEvent): { fail: "closed" | "open"; detached: boolean } {
  switch (event) {
    case "after_set":
    case "after_unset":
      return { fail: "closed", detached: false };
    case "before_show":
      return { fail: "open", detached: false };
    case "after_run":
      return { fail: "open", detached: true };
    default: {
      const exhaustive: never = event;
      throw new Error(`unhandled hook event: ${exhaustive}`);
    }
  }
}

export async function invokeHook(
  event: HookEvent,
  options: {
    projectRoot?: string | null;
    startDir?: string;
    spawn?: SpawnFn;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<void> {
  const env = options.env ?? process.env;
  if (hooksDisabled(env)) return;

  const startDir = options.startDir ?? options.projectRoot ?? process.cwd();
  const projectRoot = options.projectRoot ?? (await findProjectRoot(startDir));
  const [globalManifest, projectManifest] = await Promise.all([
    loadManifest(globalManifestPath()),
    projectRoot ? loadManifest(projectManifestPath(projectRoot)) : Promise.resolve(null),
  ]);

  const plan = await resolveHookPlan(event, {
    projectManifest,
    globalManifest,
    projectRoot,
    env,
  });
  if ("skip" in plan) return;

  const exec = hookExec(event);
  await runHookPlan(plan, {
    cwd: projectRoot ?? startDir,
    spawn: options.spawn,
    fail: exec.fail,
    detached: exec.detached,
  });
}
