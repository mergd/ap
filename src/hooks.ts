import { join, resolve } from "node:path";
import { loadManifest } from "./manifest.ts";
import { findProjectRoot, globalManifestPath, projectManifestPath } from "./paths.ts";
import { pathExists } from "./fs-helpers.ts";
import { spawnAsync, type SpawnOptions } from "./spawn.ts";
import type { HookEvent, Manifest, ManifestAction, ManifestHooks } from "./types.ts";

export const BUILTIN_SYNC_RUN = ["trove", "sync", "--force"] as const;

const DISABLED_VALUES = new Set(["", "none", "off", "false"]);

export type SpawnFn = (
  command: string,
  args: string[],
  options?: SpawnOptions,
) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface HookPlan {
  event: HookEvent;
  action: string;
  run: string[];
  implied: boolean;
}

export interface HookSkip {
  skip: string;
}

export function hooksDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.AP_NO_HOOKS?.toLowerCase();
  return value === "1" || value === "true";
}

export async function findTroveRoot(
  start = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  if (env.TROVE_DIR) {
    const override = resolve(env.TROVE_DIR);
    if (await pathExists(join(override, ".trove"))) return override;
  }

  let dir = resolve(start);
  const root = resolve("/");
  while (true) {
    if (await pathExists(join(dir, ".trove"))) return dir;
    if (dir === root) return null;
    dir = resolve(dir, "..");
  }
}

function isDisabledAction(value: string | undefined): boolean {
  return value !== undefined && DISABLED_VALUES.has(value.trim().toLowerCase());
}

function mergeHooks(project: Manifest | null, global: Manifest | null): ManifestHooks {
  return { ...global?.hooks, ...project?.hooks };
}

function mergeActions(project: Manifest | null, global: Manifest | null): Map<string, ManifestAction> {
  const actions = new Map<string, ManifestAction>();
  for (const [name, action] of global?.actions ?? []) actions.set(name, { run: [...action.run] });
  for (const [name, action] of project?.actions ?? []) actions.set(name, { run: [...action.run] });
  return actions;
}

function actionRun(
  name: string,
  actions: Map<string, ManifestAction>,
  env: NodeJS.ProcessEnv,
): string[] {
  const configured = actions.get(name)?.run;
  if (configured && configured.length > 0) return [...configured];
  if (name === "sync") {
    const bin = env.TROVE_BIN?.trim() || "trove";
    return [bin, ...BUILTIN_SYNC_RUN.slice(1)];
  }
  throw new Error(`unknown hook action "${name}" (define [action.${name}] run = [...])`);
}

export function resolveHookPlan(
  event: HookEvent,
  options: {
    projectManifest?: Manifest | null;
    globalManifest?: Manifest | null;
    inTroveTree?: boolean;
    env?: NodeJS.ProcessEnv;
  } = {},
): HookPlan | HookSkip {
  const env = options.env ?? process.env;
  if (hooksDisabled(env)) return { skip: "disabled" };

  const merged = mergeHooks(options.projectManifest ?? null, options.globalManifest ?? null);
  const bound = merged[event];

  if (isDisabledAction(bound)) return { skip: "off" };

  if (bound && bound.trim()) {
    const action = bound.trim();
    return {
      event,
      action,
      run: actionRun(action, mergeActions(options.projectManifest ?? null, options.globalManifest ?? null), env),
      implied: false,
    };
  }

  if (event === "before_show") return { skip: "unbound" };

  if (!options.inTroveTree) return { skip: "not-trove" };

  return {
    event,
    action: "sync",
    run: actionRun("sync", mergeActions(options.projectManifest ?? null, options.globalManifest ?? null), env),
    implied: true,
  };
}

export async function commandExists(command: string, spawn: SpawnFn = spawnAsync): Promise<boolean> {
  try {
    await spawn(command, ["--version"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    return true;
  } catch (err) {
    const code = err instanceof Error && "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
    return code !== "ENOENT";
  }
}

export async function runHookPlan(
  plan: HookPlan,
  options: {
    cwd?: string;
    spawn?: SpawnFn;
    fail: "closed" | "open";
  },
): Promise<void> {
  const spawn = options.spawn ?? spawnAsync;
  const [command, ...args] = plan.run;
  if (!command) throw new Error(`hook ${plan.event} action "${plan.action}" has an empty run`);

  if (plan.implied && !(await commandExists(command, spawn))) return;

  let result: { code: number; stdout: string; stderr: string };
  try {
    result = await spawn(command, args, {
      cwd: options.cwd,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
  } catch (err) {
    const code = err instanceof Error && "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
    const message =
      code === "ENOENT"
        ? `hook ${plan.event} (${plan.action}): command not found: ${command}`
        : `hook ${plan.event} (${plan.action}): ${err instanceof Error ? err.message : String(err)}`;
    if (options.fail === "open") {
      console.error(`ap: ${message}`);
      return;
    }
    throw new Error(message);
  }

  if (result.code === 0) return;

  const message = `hook ${plan.event} (${plan.action}) failed (exit ${result.code})`;
  if (options.fail === "open") {
    console.error(`ap: ${message}`);
    return;
  }
  throw new Error(message);
}

function failMode(event: HookEvent): "closed" | "open" {
  switch (event) {
    case "after_set":
    case "after_unset":
      return "closed";
    case "before_show":
      return "open";
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
  const [globalManifest, projectManifest, troveRoot] = await Promise.all([
    loadManifest(globalManifestPath()),
    projectRoot ? loadManifest(projectManifestPath(projectRoot)) : Promise.resolve(null),
    findTroveRoot(startDir, env),
  ]);

  const plan = resolveHookPlan(event, {
    projectManifest,
    globalManifest,
    inTroveTree: troveRoot !== null,
    env,
  });
  if ("skip" in plan) return;

  await runHookPlan(plan, {
    cwd: troveRoot ?? projectRoot ?? startDir,
    spawn: options.spawn,
    fail: failMode(event),
  });
}
