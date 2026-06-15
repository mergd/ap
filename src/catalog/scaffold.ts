import { emptyManifest, serializeManifest } from "../manifest.ts";
import type { Manifest, VarDefinition } from "../types.ts";
import {
  catalogBundleDefinition,
  catalogVarToDefinition,
  getCatalogBundle,
  listCatalogBundles,
} from "./bundles.ts";

export function resolveCatalogBundleNames(requested: string[]): string[] {
  if (requested.length === 0) return listCatalogBundles();

  const unknown = requested.filter((name) => !getCatalogBundle(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown catalog bundle(s): ${unknown.join(", ")} — run: ap catalog list`);
  }

  return requested;
}

/** Starter manifest copied from catalog templates. */
export function buildManifestFromCatalog(bundleNames: string[]): Manifest {
  const manifest = emptyManifest();

  for (const name of resolveCatalogBundleNames(bundleNames)) {
    mergeCatalogBundles(manifest, [name]);
  }

  return manifest;
}

function mergeVarDefinition(existing: VarDefinition, incoming: VarDefinition): VarDefinition {
  return {
    key: existing.key,
    visibility: existing.visibility ?? incoming.visibility,
    scope: existing.scope ?? incoming.scope,
    value: existing.value ?? incoming.value,
    ask: existing.ask ?? incoming.ask,
    docs: existing.docs ?? incoming.docs,
    derive: existing.derive ?? incoming.derive,
  };
}

/** Add catalog bundle + var stubs without overwriting existing manifest entries. */
export function mergeCatalogBundles(manifest: Manifest, bundleNames: string[]): string[] {
  const added: string[] = [];

  for (const name of resolveCatalogBundleNames(bundleNames)) {
    const bundleDef = catalogBundleDefinition(name);
    if (!bundleDef) continue;

    if (!manifest.bundles.has(name)) {
      manifest.bundles.set(name, bundleDef);
      added.push(name);
    }

    const entry = getCatalogBundle(name)!;
    for (const [key, varDef] of Object.entries(entry.vars)) {
      const incoming = catalogVarToDefinition(key, varDef);
      const existing = manifest.vars.get(key);
      manifest.vars.set(key, existing ? mergeVarDefinition(existing, incoming) : incoming);
    }
  }

  return added;
}

export function exampleManifestContent(): string {
  return serializeManifest(buildManifestFromCatalog([]));
}
