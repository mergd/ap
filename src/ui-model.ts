import { listCatalogBundles } from "./catalog/bundles.ts";
import {
  emptyManifest,
  parseManifestContent,
  serializeManifest,
} from "./manifest.ts";
import type { BundleDefinition, Manifest, ManifestEncryption, Scope, VarDefinition } from "./types.ts";

export type UiMode = "project" | "global";

export interface UiVar {
  key: string;
  visibility: "public" | "secret";
  value?: string;
  ask?: string;
  docs?: string;
  derive?: string;
}

export interface UiBundle {
  name: string;
  ask?: string;
  docs?: string;
  prompt?: string;
  vars: string[];
}

export interface UiManifestModel {
  mode: UiMode;
  version: 1;
  scope: Scope;
  activeBundles: string[];
  bundles: UiBundle[];
  vars: UiVar[];
  catalog: string[];
  /** Preserved from ap.toml; not edited in the UI form. */
  encryption?: ManifestEncryption;
}

function modeScope(mode: UiMode): Scope {
  return mode === "project" ? "project" : "global";
}

function varToUi(def: VarDefinition): UiVar {
  return {
    key: def.key,
    visibility: def.visibility,
    ...(def.value !== undefined ? { value: def.value } : {}),
    ...(def.ask ? { ask: def.ask } : {}),
    ...(def.docs ? { docs: def.docs } : {}),
    ...(def.derive ? { derive: def.derive } : {}),
  };
}

function uiToVar(raw: UiVar, fileScope: Scope): VarDefinition {
  const key = raw.key.trim();
  if (!key) throw new Error("var key is required");
  if (raw.visibility !== "public" && raw.visibility !== "secret") {
    throw new Error(`${key}: invalid visibility`);
  }
  if (raw.derive && raw.derive !== "public-ipv4") {
    throw new Error(`${key}: invalid derive "${raw.derive}"`);
  }

  const value = raw.value?.trim() ? raw.value : undefined;

  return {
    key,
    visibility: raw.visibility,
    scope: fileScope,
    value,
    ask: raw.ask?.trim() ? raw.ask : undefined,
    docs: raw.docs?.trim() ? raw.docs : undefined,
    derive: raw.derive === "public-ipv4" ? "public-ipv4" : undefined,
  };
}

function uiToBundle(raw: UiBundle): BundleDefinition {
  const name = raw.name.trim();
  if (!name) throw new Error("bundle name is required");
  const vars = raw.vars.map((v) => v.trim()).filter(Boolean);
  if (vars.length === 0) throw new Error(`${name}: bundle requires at least one var`);

  return {
    name,
    vars,
    ask: raw.ask?.trim() ? raw.ask : undefined,
    docs: raw.docs?.trim() ? raw.docs : undefined,
    prompt: raw.prompt?.trim() ? raw.prompt : undefined,
  };
}

export function manifestToUiModel(manifest: Manifest, mode: UiMode): UiManifestModel {
  return {
    mode,
    version: 1,
    scope: manifest.scope,
    activeBundles: [...(manifest.activeBundles ?? [])],
    bundles: [...manifest.bundles.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((b) => ({
        name: b.name,
        ask: b.ask,
        docs: b.docs,
        prompt: b.prompt,
        vars: [...b.vars],
      })),
    vars: [...manifest.vars.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(varToUi),
    catalog: listCatalogBundles(),
    ...(manifest.encryption ? { encryption: { ...manifest.encryption } } : {}),
  };
}

export function uiModelToManifest(model: UiManifestModel): Manifest {
  const scope = modeScope(model.mode);
  const manifest = emptyManifest(scope);
  manifest.version = 1;

  if (model.mode === "project") {
    manifest.activeBundles = [...new Set(model.activeBundles.map((b) => b.trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
  }

  if (model.encryption) {
    manifest.encryption = { ...model.encryption };
  }

  for (const bundle of model.bundles) {
    const def = uiToBundle(bundle);
    if (manifest.bundles.has(def.name)) {
      throw new Error(`duplicate bundle "${def.name}"`);
    }
    manifest.bundles.set(def.name, def);
  }

  for (const raw of model.vars) {
    const def = uiToVar(raw, scope);
    if (manifest.vars.has(def.key)) {
      throw new Error(`duplicate var "${def.key}"`);
    }
    manifest.vars.set(def.key, def);
  }

  return parseManifestContent(serializeManifest(manifest), "ui");
}

export function parseContentToUiModel(content: string, mode: UiMode): UiManifestModel {
  const scope = modeScope(mode);
  const trimmed = content.trim();
  if (!trimmed) {
    return manifestToUiModel(emptyManifest(scope), mode);
  }
  return manifestToUiModel(
    parseManifestContent(content, "ui", { defaultScope: scope }),
    mode,
  );
}

export function serializeUiModel(model: UiManifestModel): string {
  return serializeManifest(uiModelToManifest(model));
}
