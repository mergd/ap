import { parse } from "smol-toml";
import type { BundleDefinition, DeriveKind, Manifest, Scope, VarDefinition, Visibility } from "./types.ts";
import { isNotFound, readTextFile, writeTextFile } from "./fs-helpers.ts";

interface RawManifest {
  version?: number;
  bundles?: unknown;
  var?: Record<string, unknown>;
  bundle?: Record<string, unknown>;
  [key: string]: unknown;
}

function parseVarEntry(key: string, raw: unknown): VarDefinition {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Invalid var definition for ${key}`);
  }

  const entry = raw as Record<string, unknown>;
  const rawVisibility = entry.visibility;

  let visibility: Visibility;
  if (rawVisibility === undefined) {
    visibility = "secret";
  } else if (rawVisibility === "public" || rawVisibility === "secret") {
    visibility = rawVisibility;
  } else {
    throw new Error(
      `${key}: invalid visibility "${String(rawVisibility)}" (expected public or secret)`,
    );
  }

  const scope = entry.scope as Scope | undefined;
  const derive = entry.derive as DeriveKind | undefined;

  if (visibility === "public" && entry.value !== undefined && typeof entry.value !== "string") {
    throw new Error(`${key}: public value must be a string`);
  }

  if (derive && visibility !== "public") {
    throw new Error(`${key}: derive requires visibility = "public"`);
  }

  if (derive && entry.value !== undefined) {
    throw new Error(`${key}: use either value or derive, not both`);
  }

  return {
    key,
    visibility,
    scope,
    value: typeof entry.value === "string" ? entry.value : undefined,
    ask: typeof entry.ask === "string" ? entry.ask : undefined,
    docs: typeof entry.docs === "string" ? entry.docs : undefined,
    derive,
  };
}

function parseBundleEntry(name: string, raw: unknown): BundleDefinition {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Invalid bundle definition for ${name}`);
  }

  const entry = raw as Record<string, unknown>;
  if (!Array.isArray(entry.vars)) {
    throw new Error(`${name}: bundle requires vars = ["KEY", ...]`);
  }

  const vars = entry.vars.filter((v): v is string => typeof v === "string");
  if (vars.length === 0) {
    throw new Error(`${name}: bundle vars must list at least one key`);
  }

  return {
    name,
    vars,
    ask: typeof entry.ask === "string" ? entry.ask : undefined,
    docs: typeof entry.docs === "string" ? entry.docs : undefined,
    prompt: typeof entry.prompt === "string" ? entry.prompt : undefined,
  };
}

const SKIP_KEYS = new Set(["version", "var", "bundle", "bundles"]);

export function parseManifestContent(content: string, source: string): Manifest {
  let raw: RawManifest;
  try {
    raw = parse(content) as RawManifest;
  } catch (err) {
    throw new Error(`Failed to parse ${source}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const version = raw.version;
  if (version !== 1) {
    throw new Error(`${source}: unsupported version ${version ?? "missing"} (expected 1)`);
  }

  const vars = new Map<string, VarDefinition>();
  const bundles = new Map<string, BundleDefinition>();

  const nestedVar = raw.var;
  if (nestedVar && typeof nestedVar === "object" && !Array.isArray(nestedVar)) {
    for (const [key, value] of Object.entries(nestedVar)) {
      vars.set(key, parseVarEntry(key, value));
    }
  }

  const nestedBundle = raw.bundle;
  if (nestedBundle && typeof nestedBundle === "object" && !Array.isArray(nestedBundle)) {
    for (const [name, value] of Object.entries(nestedBundle)) {
      bundles.set(name, parseBundleEntry(name, value));
    }
  }

  for (const [tomlKey, value] of Object.entries(raw)) {
    if (SKIP_KEYS.has(tomlKey)) continue;
    if (tomlKey.startsWith("var.")) {
      vars.set(tomlKey.slice("var.".length), parseVarEntry(tomlKey.slice("var.".length), value));
      continue;
    }
    if (tomlKey.startsWith("bundle.")) {
      bundles.set(tomlKey.slice("bundle.".length), parseBundleEntry(tomlKey.slice("bundle.".length), value));
      continue;
    }
    throw new Error(`${source}: unknown top-level key "${tomlKey}"`);
  }

  let activeBundles: string[] | undefined;
  if (Array.isArray(raw.bundles)) {
    activeBundles = raw.bundles.filter((b): b is string => typeof b === "string");
  }

  return { version: 1, vars, bundles, activeBundles };
}

export async function loadManifest(path: string): Promise<Manifest | null> {
  try {
    const content = await readTextFile(path);
    return parseManifestContent(content, path);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

function serializeVarBlock(key: string, def: VarDefinition): string[] {
  const lines: string[] = [`[var.${key}]`, `visibility = "${def.visibility}"`];
  if (def.scope) lines.push(`scope = "${def.scope}"`);
  if (def.value !== undefined) lines.push(`value = ${JSON.stringify(def.value)}`);
  if (def.ask) lines.push(`ask = ${JSON.stringify(def.ask)}`);
  if (def.docs) lines.push(`docs = ${JSON.stringify(def.docs)}`);
  if (def.derive) lines.push(`derive = "${def.derive}"`);
  lines.push("");
  return lines;
}

export function serializeManifest(manifest: Manifest): string {
  const lines: string[] = ["version = 1", ""];

  if (manifest.activeBundles !== undefined) {
    lines.push(`bundles = ${JSON.stringify(manifest.activeBundles)}`);
    lines.push("");
  }

  const claimedVars = new Set<string>();
  const sortedBundles = [...manifest.bundles.entries()].sort(([a], [b]) => a.localeCompare(b));

  for (const [name, bundle] of sortedBundles) {
    lines.push(`[bundle.${name}]`);
    if (bundle.ask) lines.push(`ask = ${JSON.stringify(bundle.ask)}`);
    if (bundle.docs) lines.push(`docs = ${JSON.stringify(bundle.docs)}`);
    if (bundle.prompt) lines.push(`prompt = ${JSON.stringify(bundle.prompt)}`);
    lines.push(`vars = ${JSON.stringify(bundle.vars)}`);
    lines.push("");

    for (const key of bundle.vars) {
      const def = manifest.vars.get(key);
      if (!def) continue;
      claimedVars.add(key);
      lines.push(...serializeVarBlock(key, def));
    }
  }

  const orphanVars = [...manifest.vars.entries()]
    .filter(([key]) => !claimedVars.has(key))
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [key, def] of orphanVars) {
    lines.push(...serializeVarBlock(key, def));
  }

  return lines.join("\n");
}

export async function saveManifestContent(path: string, manifest: Manifest): Promise<void> {
  await writeTextFile(path, serializeManifest(manifest));
}

export async function saveManifest(path: string, vars: Map<string, VarDefinition>): Promise<void> {
  const lines: string[] = ["version = 1", ""];

  const sorted = [...vars.entries()].sort(([a], [b]) => a.localeCompare(b));

  for (const [key, def] of sorted) {
    lines.push(...serializeVarBlock(key, def));
  }

  await writeTextFile(path, lines.join("\n"));
}

export function emptyManifest(): Manifest {
  return { version: 1, vars: new Map(), bundles: new Map() };
}

export const INIT_PROJECT_MANIFEST = `version = 1

# Opt into bundles defined in ~/.config/ap/manifest.toml (from ap global init)
bundles = []

# Example:
# bundles = ["namecheap", "cloudflare"]
`;
