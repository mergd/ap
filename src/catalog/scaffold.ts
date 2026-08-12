import { emptyManifest, serializeManifest } from "../manifest.ts";
import type { Manifest, VarDefinition } from "../types.ts";
import {
  catalogVarToDefinition,
  getCatalogBundle,
  listCatalogBundles,
} from "./bundles.ts";

export function resolveCatalogBundleNames(requested: string[]): string[] {
  if (requested.length === 0) return listCatalogBundles();

  const unknown = requested.filter((name) => !getCatalogBundle(name));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown bundle(s): ${unknown.join(", ")} — available: ${listCatalogBundles().join(", ")}`,
    );
  }

  return requested;
}

/** Starter manifest copied from catalog templates. */
export function buildManifestFromCatalog(bundleNames: string[]): Manifest {
  const manifest = emptyManifest("global");

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

/**
 * Add catalog var stubs without overwriting existing values.
 * Bundle identity (ask/docs/prompt/var list) stays in the catalog — no `[bundle.*]` written.
 */
export function mergeCatalogBundles(manifest: Manifest, bundleNames: string[]): string[] {
  const added: string[] = [];

  for (const name of resolveCatalogBundleNames(bundleNames)) {
    const entry = getCatalogBundle(name);
    if (!entry) continue;

    let touched = false;
    for (const [key, varDef] of Object.entries(entry.vars)) {
      const incoming = { ...catalogVarToDefinition(key, varDef), scope: manifest.scope };
      const existing = manifest.vars.get(key);
      if (!existing) touched = true;
      manifest.vars.set(key, existing ? mergeVarDefinition(existing, incoming) : incoming);
    }
    if (touched) added.push(name);
  }

  return added;
}

export function exampleManifestContent(): string {
  return serializeManifest(buildManifestFromCatalog([]));
}
