import { resolveDerive } from "./derives.ts";
import { truncateForDisplay } from "./mask.ts";
import {
  globalHome,
  globalManifestPath,
  globalSecretsPath,
  projectManifestPath,
  projectSecretsPath,
} from "./paths.ts";
import { loadManifest } from "./manifest.ts";
import { createVaultStore } from "./vault.ts";
import { collectBundleVarKeys, getActiveBundleNames, mergeBundleDefinition } from "./bundles.ts";
import type {
  Manifest,
  ResolvedVar,
  ResolveContext,
  ResolveOptions,
  Scope,
  Storage,
  VarDefinition,
  VarStatus,
  Visibility,
} from "./types.ts";

export type { ResolveContext, ResolveOptions };

export async function loadResolveContext(projectRoot?: string | null): Promise<ResolveContext> {
  const root = projectRoot === undefined ? null : projectRoot;
  const globalManifest = await loadManifest(globalManifestPath());
  const projectManifest = root ? await loadManifest(projectManifestPath(root)) : null;
  const globalVault = createVaultStore(globalSecretsPath());
  const projectVault = root ? createVaultStore(projectSecretsPath(root)) : null;

  return {
    projectRoot: root,
    globalManifest,
    projectManifest,
    globalSecrets: await globalVault.read(),
    projectSecrets: projectVault ? await projectVault.read() : {},
  };
}

function defaultScope(isProject: boolean): Scope {
  return isProject ? "project" : "global";
}

export function mergeDefinition(
  key: string,
  projectDef: VarDefinition | undefined,
  globalDef: VarDefinition | undefined,
  isProjectKey: boolean,
): VarDefinition {
  const scope = projectDef?.scope ?? globalDef?.scope ?? defaultScope(isProjectKey);

  return {
    key,
    visibility: projectDef?.visibility ?? globalDef?.visibility ?? "secret",
    scope,
    value: projectDef?.value ?? globalDef?.value,
    ask: projectDef?.ask ?? globalDef?.ask,
    docs: projectDef?.docs ?? globalDef?.docs,
    derive: projectDef?.derive ?? globalDef?.derive,
  };
}

function setWithCommand(key: string, scope: Scope): string {
  return scope === "global" ? `ap set ${key} --global` : `ap set ${key}`;
}

export async function resolveVar(
  ctx: ResolveContext,
  def: VarDefinition,
  options?: { includeSecrets?: boolean; forRun?: boolean; surfacePublic?: boolean },
): Promise<ResolvedVar> {
  const includeSecrets = options?.includeSecrets ?? false;
  const forRun = options?.forRun ?? false;
  const surfacePublic = options?.surfacePublic ?? false;
  const scope = def.scope ?? "global";

  let storage: Storage;
  let value: string | undefined;
  let status: VarStatus = "missing";

  if (def.visibility === "public" && def.derive) {
    storage = "inline";
    try {
      value = await resolveDerive(def.derive);
      status = "set";
    } catch {
      status = "missing";
    }
  } else if (def.visibility === "public" && def.value !== undefined) {
    storage = "inline";
    value = def.value;
    status = "set";
  } else if (def.visibility === "secret") {
    const vaultValue =
      scope === "project" ? ctx.projectSecrets[def.key] : ctx.globalSecrets[def.key];

    if (vaultValue !== undefined) {
      storage = scope === "project" ? "project" : "global";
      value = vaultValue;
      status = "set";
    } else if (def.value !== undefined) {
      storage = "inline";
      value = def.value;
      status = "set";
    } else {
      storage = scope === "project" ? "project" : "global";
      status = "missing";
    }
  } else if (scope === "project") {
    storage = "project";
    value = ctx.projectSecrets[def.key];
    status = value !== undefined ? "set" : "missing";
  } else {
    storage = "global";
    value = ctx.globalSecrets[def.key];
    status = value !== undefined ? "set" : "missing";
  }

  const resolved: ResolvedVar = {
    key: def.key,
    scope,
    storage,
    visibility: def.visibility,
    status,
    ask: def.ask,
    docs: def.docs,
  };

  if (status === "missing") {
    resolved.set_with = setWithCommand(def.key, scope);
    return resolved;
  }

  if (def.visibility === "secret" && !includeSecrets && !forRun) {
    resolved.masked = true;
    return resolved;
  }

  if (def.visibility === "public" && !includeSecrets && !forRun && !surfacePublic) {
    resolved.value = truncateForDisplay(value!);
    return resolved;
  }

  resolved.value = value;
  return resolved;
}

export function collectKeys(ctx: ResolveContext, options?: ResolveOptions): string[] {
  const globalOnly = options?.globalOnly ?? false;
  const bundleNames = getActiveBundleNames(ctx, globalOnly);

  if (bundleNames !== null) {
    return collectBundleVarKeys(ctx, bundleNames);
  }

  const keys = new Set<string>();

  if (ctx.globalManifest) {
    for (const key of ctx.globalManifest.vars.keys()) keys.add(key);
  }

  if (!globalOnly && ctx.projectManifest) {
    for (const key of ctx.projectManifest.vars.keys()) keys.add(key);
  }

  return [...keys].sort();
}

async function resolveKey(ctx: ResolveContext, key: string, options?: ResolveOptions): Promise<ResolvedVar> {
  const isProjectKey = !options?.globalOnly && (ctx.projectManifest?.vars.has(key) ?? false);
  const projectDef = isProjectKey ? ctx.projectManifest?.vars.get(key) : undefined;
  const globalDef = ctx.globalManifest?.vars.get(key);
  const def = mergeDefinition(key, projectDef, globalDef, isProjectKey);
  return await resolveVar(ctx, def, options);
}

export async function resolveAll(
  ctx: ResolveContext,
  options?: ResolveOptions,
): Promise<ResolvedVar[]> {
  let keys = collectKeys(ctx, options);

  if (options?.bundleFilter) {
    const bundle = mergeBundleDefinition(
      options.bundleFilter,
      ctx.projectManifest,
      ctx.globalManifest,
    );
    keys = bundle ? [...bundle.vars] : [];
  }

  return Promise.all(keys.map((key) => resolveKey(ctx, key, options)));
}

export async function resolveForRun(ctx: ResolveContext): Promise<Record<string, string>> {
  if (!ctx.projectRoot || !ctx.projectManifest) {
    throw new Error("No project ap.toml found. Run from a project directory.");
  }

  const env: Record<string, string> = {};
  const vars = await resolveAll(ctx, { forRun: true, includeSecrets: true });

  for (const v of vars) {
    if (v.status === "missing") {
      throw new Error(`Missing required secret: ${v.key} (${v.set_with})`);
    }
    if (v.value !== undefined) env[v.key] = v.value;
  }

  return env;
}

export function exportSchema(ctx: ResolveContext): Record<string, unknown> {
  const vars: Record<string, unknown> = {};
  const bundles: Record<string, unknown> = {};
  const keys = collectKeys(ctx);

  for (const key of keys) {
    const isProjectKey = ctx.projectManifest?.vars.has(key) ?? false;
    const projectDef = ctx.projectManifest?.vars.get(key);
    const globalDef = ctx.globalManifest?.vars.get(key);
    const def = mergeDefinition(key, projectDef, globalDef, isProjectKey);

    vars[key] = {
      visibility: def.visibility,
      scope: def.scope ?? defaultScope(isProjectKey),
      ...(def.ask ? { ask: def.ask } : {}),
      ...(def.docs ? { docs: def.docs } : {}),
      ...(def.derive ? { derive: def.derive } : {}),
      ...(def.visibility === "public" && def.value ? { value: def.value } : {}),
    };
  }

  const bundleNames = getActiveBundleNames(ctx, false) ??
    (ctx.globalManifest ? [...ctx.globalManifest.bundles.keys()] : []);

  for (const name of bundleNames) {
    const b = ctx.projectManifest?.bundles.get(name) ?? ctx.globalManifest?.bundles.get(name);
    if (b) {
      bundles[name] = {
        vars: b.vars,
        ...(b.ask ? { ask: b.ask } : {}),
        ...(b.docs ? { docs: b.docs } : {}),
      };
    }
  }

  return {
    version: 1,
    project: ctx.projectRoot,
    global_home: globalHome(),
    active_bundles: ctx.projectManifest?.activeBundles,
    bundles,
    vars,
  };
}
