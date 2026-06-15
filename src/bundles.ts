import { catalogVarDefinition, getCatalogBundle, listCatalogBundles } from "./catalog/bundles.ts";
import type { BundleDefinition, Manifest, ResolvedBundle, ResolvedVar, ResolveContext, ResolveOptions, VarDefinition } from "./types.ts";

export { listCatalogBundles, getCatalogBundle };

export function mergeBundleDefinition(
  name: string,
  projectManifest: Manifest | null,
  globalManifest: Manifest | null,
): BundleDefinition | undefined {
  const catalog = getCatalogBundle(name);
  const project = projectManifest?.bundles.get(name);
  const global = globalManifest?.bundles.get(name);

  if (!project && !global && !catalog) return undefined;

  return {
    name,
    vars: project?.vars ?? global?.vars ?? Object.keys(catalog!.vars),
    ask: project?.ask ?? global?.ask ?? catalog?.ask,
    docs: project?.docs ?? global?.docs ?? catalog?.docs,
    prompt: project?.prompt ?? global?.prompt ?? catalog?.prompt,
  };
}

export function findCatalogVarDefinition(
  key: string,
  bundleNames: string[],
): VarDefinition | undefined {
  for (const name of bundleNames) {
    const def = catalogVarDefinition(name, key);
    if (def) return def;
  }
  return undefined;
}

export function getActiveBundleNames(ctx: ResolveContext, globalOnly: boolean): string[] | null {
  if (globalOnly) {
    const names = new Set(listCatalogBundles());
    if (ctx.globalManifest) {
      for (const name of ctx.globalManifest.bundles.keys()) names.add(name);
    }
    return [...names].sort();
  }

  const active = ctx.projectManifest?.activeBundles;
  if (active !== undefined) return active;

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

  if (ctx.projectManifest) {
    for (const key of ctx.projectManifest.vars.keys()) keys.add(key);
  }

  return [...keys].sort();
}

export async function resolveBundles(
  ctx: ResolveContext,
  resolvedVars: ResolvedVar[],
  options?: ResolveOptions & { bundleFilter?: string },
): Promise<Record<string, ResolvedBundle>> {
  const globalOnly = options?.globalOnly ?? false;
  const bundleNames = getActiveBundleNames(ctx, globalOnly);
  if (!bundleNames) return {};

  const varByKey = new Map(resolvedVars.map((v) => [v.key, v]));
  const result: Record<string, ResolvedBundle> = {};

  const names = options?.bundleFilter ? [options.bundleFilter] : bundleNames;

  for (const name of names) {
    const bundle = mergeBundleDefinition(name, ctx.projectManifest, ctx.globalManifest);
    if (!bundle) {
      result[name] = {
        name,
        ready: false,
        surfaced: [],
        missing: [{ key: "(bundle)", ask: `Unknown bundle "${name}"`, set_with: "ap catalog list" }],
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
          set_with: `ap set ${key} --global`,
        });
        continue;
      }

      if (v.status === "missing") {
        missing.push({
          key,
          ask: v.ask ?? bundle.ask,
          set_with: v.set_with ?? `ap set ${key} --global`,
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
