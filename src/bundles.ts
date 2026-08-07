import {
  catalogBundleDefinition,
  catalogVarToDefinition,
  getCatalogBundle,
  listCatalogBundles,
} from "./catalog/bundles.ts";
import type {
  BundleDefinition,
  Manifest,
  ResolvedBundle,
  ResolvedVar,
  ResolveContext,
  ResolveOptions,
  VarDefinition,
} from "./types.ts";

export function mergeBundleDefinition(
  name: string,
  projectManifest: Manifest | null,
  globalManifest: Manifest | null,
): BundleDefinition | undefined {
  const project = projectManifest?.bundles.get(name);
  const global = globalManifest?.bundles.get(name);
  const catalog = catalogBundleDefinition(name);

  if (!project && !global && !catalog) return undefined;

  const base = project ?? global ?? catalog!;

  return {
    name,
    vars: base.vars,
    ask: project?.ask ?? global?.ask ?? catalog?.ask,
    docs: project?.docs ?? global?.docs ?? catalog?.docs,
    prompt: project?.prompt ?? global?.prompt ?? catalog?.prompt,
  };
}

/** Resolve a var def from project → global → catalog bundles that list the key. */
export function lookupCatalogVar(key: string, bundleHint?: string): VarDefinition | undefined {
  if (bundleHint) {
    const raw = getCatalogBundle(bundleHint)?.vars[key];
    if (raw) return catalogVarToDefinition(key, raw);
  }

  for (const name of listCatalogBundles()) {
    const raw = getCatalogBundle(name)?.vars[key];
    if (raw) return catalogVarToDefinition(key, raw);
  }

  return undefined;
}

export function getActiveBundleNames(ctx: ResolveContext, globalOnly: boolean): string[] | null {
  if (globalOnly) {
    if (!ctx.globalManifest) return [];
    return [...ctx.globalManifest.bundles.keys()].sort();
  }

  const active = ctx.projectManifest?.activeBundles;
  if (active !== undefined) return active;

  if (ctx.globalManifest && ctx.globalManifest.bundles.size > 0) {
    return [...ctx.globalManifest.bundles.keys()].sort();
  }

  return null;
}

export function collectBundleVarKeys(
  ctx: ResolveContext,
  bundleNames: string[],
): string[] {
  const keys = new Set<string>();

  for (const name of bundleNames) {
    const bundle = mergeBundleDefinition(name, ctx.projectManifest, ctx.globalManifest);
    if (!bundle) continue;
    for (const key of bundle.vars) keys.add(key);
  }

  // Vars outside bundles remain available as runtime-only secrets. Include both
  // layers here: a project manifest that only selects bundles must not hide
  // standalone vars declared in the global manifest.
  for (const key of ctx.globalManifest?.vars.keys() ?? []) keys.add(key);
  for (const key of ctx.projectManifest?.vars.keys() ?? []) keys.add(key);

  return [...keys].sort();
}

/** Keys that must be present for `ap run` (active / filtered bundles only). */
export function requiredRunKeys(ctx: ResolveContext, bundleFilter?: string): Set<string> {
  const keys = new Set<string>();

  if (bundleFilter) {
    const bundle = mergeBundleDefinition(bundleFilter, ctx.projectManifest, ctx.globalManifest);
    if (bundle) {
      for (const key of bundle.vars) keys.add(key);
    }
    return keys;
  }

  const active = getActiveBundleNames(ctx, false);
  if (!active) return keys;

  for (const name of active) {
    const bundle = mergeBundleDefinition(name, ctx.projectManifest, ctx.globalManifest);
    if (!bundle) continue;
    for (const key of bundle.vars) keys.add(key);
  }

  return keys;
}

export async function resolveBundles(
  ctx: ResolveContext,
  resolvedVars: ResolvedVar[],
  options?: ResolveOptions & { bundleFilter?: string },
): Promise<Record<string, ResolvedBundle>> {
  const globalOnly = options?.globalOnly ?? false;
  const bundleNames = getActiveBundleNames(ctx, globalOnly);

  // Allow an explicit --bundle / positional filter even when there is no active
  // bundle list (e.g. global-only flat vars, or filter before init).
  if (!bundleNames && !options?.bundleFilter) return {};

  const varByKey = new Map(resolvedVars.map((v) => [v.key, v]));
  const result: Record<string, ResolvedBundle> = {};
  const names = options?.bundleFilter ? [options.bundleFilter] : bundleNames!;

  for (const name of names) {
    const bundle = mergeBundleDefinition(name, ctx.projectManifest, ctx.globalManifest);
    if (!bundle) {
      const known = listCatalogBundles().join(", ");
      result[name] = {
        name,
        ready: false,
        surfaced: [],
        missing: [{
          key: "(bundle)",
          ask: `Unknown bundle "${name}"${known ? ` — available: ${known}` : ""}`,
          set_with: known ? `ap catalog` : `ap init --global`,
        }],
        secrets_set: [],
      };
      continue;
    }

    const surfaced: ResolvedBundle["surfaced"] = [];
    const missing: ResolvedBundle["missing"] = [];
    const secrets_set: string[] = [];

    for (const key of bundle.vars) {
      const v = varByKey.get(key);
      if (!v) {
        missing.push({
          key,
          ask: bundle.ask,
          set_with: `ap set ${key}`,
        });
        continue;
      }

      if (v.status === "missing") {
        missing.push({
          key,
          ask: v.ask ?? bundle.ask,
          set_with: v.set_with ?? `ap set ${key}`,
        });
        continue;
      }

      if (v.visibility === "public") {
        if (v.value !== undefined) surfaced.push({ key, value: v.value });
      } else {
        secrets_set.push(key);
      }
    }

    result[name] = {
      name,
      ready: missing.length === 0,
      ask: bundle.ask,
      docs: bundle.docs,
      prompt: bundle.prompt,
      surfaced,
      missing,
      secrets_set,
    };
  }

  return result;
}

export async function resolveBundleVars(
  ctx: ResolveContext,
  resolveKey: (key: string) => Promise<ResolvedVar>,
  options?: ResolveOptions,
): Promise<ResolvedVar[]> {
  const bundleNames = getActiveBundleNames(ctx, options?.globalOnly ?? false);
  if (!bundleNames) return [];

  const keys = collectBundleVarKeys(ctx, bundleNames);
  return Promise.all(keys.map((key) => resolveKey(key)));
}
