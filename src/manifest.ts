import { basename } from "node:path";
import { parse } from "smol-toml";
import type {
  BundleDefinition,
  DeriveKind,
  Manifest,
  ManifestStorage,
  Scope,
  VarDefinition,
  Visibility,
} from "./types.ts";
import { isNotFound, readTextFile, writeSecretFile, writeTextFile } from "./fs-helpers.ts";
import { PROJECT_MANIFEST_NAME } from "./paths.ts";

interface RawManifest {
  version?: number;
  scope?: unknown;
  bundles?: unknown;
  var?: Record<string, unknown>;
  bundle?: Record<string, unknown>;
  [key: string]: unknown;
}

function parseVarEntry(key: string, raw: unknown, fileScope: Scope): VarDefinition {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Invalid var definition for ${key}`);
  }

  const entry = raw as Record<string, unknown>;
  if (entry.scope !== undefined) {
    throw new Error(
      `${key}: scope belongs at the top of the file (scope = "${fileScope}"), not on [var.${key}]`,
    );
  }

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

  const derive = entry.derive as DeriveKind | undefined;

  let storage: ManifestStorage | undefined;
  if (entry.storage !== undefined) {
    if (entry.storage !== "secrets.json") {
      throw new Error(
        `${key}: invalid storage "${String(entry.storage)}" (expected secrets.json)`,
      );
    }
    storage = "secrets.json";
  }

  if (entry.value !== undefined && typeof entry.value !== "string") {
    throw new Error(`${key}: value must be a string`);
  }

  if (derive && visibility !== "public") {
    throw new Error(`${key}: derive requires visibility = "public"`);
  }

  if (derive && entry.value !== undefined) {
    throw new Error(`${key}: use either value or derive, not both`);
  }

  if (storage && visibility !== "secret") {
    throw new Error(`${key}: storage = "secrets.json" requires visibility = "secret"`);
  }

  if (storage && entry.value !== undefined) {
    throw new Error(`${key}: use either value or storage = "secrets.json", not both`);
  }

  if (storage && derive) {
    throw new Error(`${key}: storage is incompatible with derive`);
  }

  if (storage && fileScope !== "project") {
    throw new Error(`${key}: storage = "secrets.json" requires scope = "project"`);
  }

  return {
    key,
    visibility,
    scope: fileScope,
    storage,
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

function parseFileScope(raw: unknown, source: string, defaultScope?: Scope): Scope {
  if (raw === undefined || raw === null) {
    if (defaultScope) return defaultScope;
    throw new Error(
      `${source}: missing top-level scope = "global" | "project"`,
    );
  }
  if (raw === "global" || raw === "project") return raw;
  throw new Error(
    `${source}: invalid scope "${String(raw)}" (expected global or project)`,
  );
}

/** Infer file scope from path when TOML omits scope (migration / convenience). */
export function defaultScopeForPath(path: string): Scope {
  return basename(path) === PROJECT_MANIFEST_NAME ? "project" : "global";
}

const SKIP_KEYS = new Set(["version", "scope", "var", "bundle", "bundles"]);

export function parseManifestContent(
  content: string,
  source: string,
  options?: { defaultScope?: Scope },
): Manifest {
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

  const scope = parseFileScope(raw.scope, source, options?.defaultScope);
  const vars = new Map<string, VarDefinition>();
  const bundles = new Map<string, BundleDefinition>();

  const nestedVar = raw.var;
  if (nestedVar && typeof nestedVar === "object" && !Array.isArray(nestedVar)) {
    for (const [key, value] of Object.entries(nestedVar)) {
      vars.set(key, parseVarEntry(key, value, scope));
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
      vars.set(tomlKey.slice("var.".length), parseVarEntry(tomlKey.slice("var.".length), value, scope));
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

  return { version: 1, scope, vars, bundles, activeBundles };
}

export interface ManifestLoadResult {
  manifest: Manifest | null;
  /** Autofix was written back to disk */
  repaired: boolean;
  repairs: string[];
  warnings: string[];
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function collectVarScopes(raw: RawManifest): Scope[] {
  const scopes: Scope[] = [];
  const take = (value: unknown) => {
    const entry = asRecord(value);
    if (!entry) return;
    if (entry.scope === "global" || entry.scope === "project") scopes.push(entry.scope);
  };
  const nested = asRecord(raw.var);
  if (nested) {
    for (const value of Object.values(nested)) take(value);
  }
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith("var.")) take(value);
  }
  return scopes;
}

function resolveRepairScope(raw: RawManifest, defaultScope: Scope, repairs: string[]): Scope {
  if (raw.scope === "global" || raw.scope === "project") return raw.scope;
  const unique = [...new Set(collectVarScopes(raw))];
  if (unique.length === 1) {
    repairs.push(`backfilled scope = "${unique[0]}" from var declarations`);
    return unique[0]!;
  }
  repairs.push(`backfilled scope = "${defaultScope}"`);
  return defaultScope;
}

function repairVarEntry(
  key: string,
  raw: unknown,
  fileScope: Scope,
  repairs: string[],
  warnings: string[],
): VarDefinition | null {
  const entry = asRecord(raw);
  if (!entry) {
    warnings.push(`skipped invalid var.${key}`);
    return null;
  }
  if (entry.scope !== undefined) {
    repairs.push(`removed [var.${key}] scope (file scope is ${fileScope})`);
  }

  let visibility: Visibility = "secret";
  if (entry.visibility === "public" || entry.visibility === "secret") {
    visibility = entry.visibility;
  } else if (entry.visibility !== undefined) {
    warnings.push(`${key}: invalid visibility — defaulting to secret`);
  }

  let storage: ManifestStorage | undefined;
  if (entry.storage === "secrets.json") storage = "secrets.json";
  else if (entry.storage !== undefined) {
    warnings.push(`${key}: ignored invalid storage`);
  }

  const derive = entry.derive === "public-ipv4" ? ("public-ipv4" as DeriveKind) : undefined;
  if (entry.derive !== undefined && !derive) {
    warnings.push(`${key}: ignored invalid derive`);
  }

  let value = typeof entry.value === "string" ? entry.value : undefined;
  if (entry.value !== undefined && value === undefined) {
    warnings.push(`${key}: ignored non-string value`);
  }

  const effectiveDerive = derive && visibility === "public" ? derive : undefined;
  if (derive && visibility !== "public") {
    warnings.push(`${key}: derive requires public — cleared`);
  }
  if (effectiveDerive && value !== undefined) {
    warnings.push(`${key}: both value and derive — kept derive`);
    value = undefined;
  }

  if (storage && visibility !== "secret") {
    warnings.push(`${key}: storage requires secret — cleared`);
    storage = undefined;
  }
  if (storage && value !== undefined) {
    warnings.push(`${key}: both value and storage — kept storage`);
    value = undefined;
  }
  if (storage && fileScope !== "project") {
    warnings.push(`${key}: storage only valid for project scope — cleared`);
    storage = undefined;
  }

  return {
    key,
    visibility,
    scope: fileScope,
    storage,
    value,
    ask: typeof entry.ask === "string" ? entry.ask : undefined,
    docs: typeof entry.docs === "string" ? entry.docs : undefined,
    derive: effectiveDerive,
  };
}

function repairBundleEntry(
  name: string,
  raw: unknown,
  warnings: string[],
): BundleDefinition | null {
  const entry = asRecord(raw);
  if (!entry) {
    warnings.push(`skipped invalid bundle.${name}`);
    return null;
  }
  if (!Array.isArray(entry.vars)) {
    warnings.push(`skipped bundle.${name}: missing vars`);
    return null;
  }
  const vars = entry.vars.filter((v): v is string => typeof v === "string");
  if (vars.length === 0) {
    warnings.push(`skipped bundle.${name}: empty vars`);
    return null;
  }
  return {
    name,
    vars,
    ask: typeof entry.ask === "string" ? entry.ask : undefined,
    docs: typeof entry.docs === "string" ? entry.docs : undefined,
    prompt: typeof entry.prompt === "string" ? entry.prompt : undefined,
  };
}

/** Best-effort repair of legacy / broken manifests. Returns null if unrecoverable. */
export function tryRepairManifestContent(
  content: string,
  source: string,
  defaultScope: Scope,
): { manifest: Manifest; repairs: string[]; warnings: string[]; content: string } | null {
  let raw: RawManifest;
  try {
    raw = parse(content) as RawManifest;
  } catch {
    return null;
  }

  if (raw.version !== undefined && raw.version !== 1) return null;

  const repairs: string[] = [];
  const warnings: string[] = [];
  const scope = resolveRepairScope(raw, defaultScope, repairs);
  if (raw.version === undefined) repairs.push("added version = 1");

  const manifest = emptyManifest(scope);
  if (Array.isArray(raw.bundles)) {
    manifest.activeBundles = raw.bundles.filter((b): b is string => typeof b === "string");
  }

  const nestedVar = asRecord(raw.var);
  if (nestedVar) {
    for (const [key, value] of Object.entries(nestedVar)) {
      const def = repairVarEntry(key, value, scope, repairs, warnings);
      if (def) manifest.vars.set(key, def);
    }
  }

  const nestedBundle = asRecord(raw.bundle);
  if (nestedBundle) {
    for (const [name, value] of Object.entries(nestedBundle)) {
      const def = repairBundleEntry(name, value, warnings);
      if (def) manifest.bundles.set(name, def);
    }
  }

  for (const [tomlKey, value] of Object.entries(raw)) {
    if (SKIP_KEYS.has(tomlKey)) continue;
    if (tomlKey.startsWith("var.")) {
      const def = repairVarEntry(tomlKey.slice(4), value, scope, repairs, warnings);
      if (def) manifest.vars.set(def.key, def);
      continue;
    }
    if (tomlKey.startsWith("bundle.")) {
      const def = repairBundleEntry(tomlKey.slice(7), value, warnings);
      if (def) manifest.bundles.set(def.name, def);
      continue;
    }
    warnings.push(`ignored unknown top-level key "${tomlKey}"`);
  }

  const serialized = serializeManifest(manifest);
  try {
    parseManifestContent(serialized, source, { defaultScope: scope });
  } catch {
    return null;
  }

  return { manifest, repairs, warnings, content: serialized };
}

function warnManifest(path: string, message: string): void {
  console.error(`ap: ${message} (${path})`);
}

/**
 * Load a manifest. Autofixes legacy layouts (missing file-level scope, per-var scope)
 * and returns null for unreadable/invalid files instead of throwing.
 */
export async function loadManifest(
  path: string,
  options?: { autofix?: boolean },
): Promise<Manifest | null> {
  const result = await loadManifestDetailed(path, options);
  return result.manifest;
}

export async function loadManifestDetailed(
  path: string,
  options?: { autofix?: boolean },
): Promise<ManifestLoadResult> {
  const autofix = options?.autofix !== false;
  const defaultScope = defaultScopeForPath(path);
  const empty: ManifestLoadResult = {
    manifest: null,
    repaired: false,
    repairs: [],
    warnings: [],
  };

  let content: string;
  try {
    content = await readTextFile(path);
  } catch (err) {
    if (isNotFound(err)) return empty;
    warnManifest(path, `could not read manifest: ${err instanceof Error ? err.message : String(err)}`);
    return empty;
  }

  try {
    const manifest = parseManifestContent(content, path, { defaultScope });
    // Strict parse can succeed via defaultScope while the file still omits scope=.
    let raw: RawManifest | null = null;
    try {
      raw = parse(content) as RawManifest;
    } catch {
      raw = null;
    }
    if (raw && raw.scope === undefined && autofix) {
      const repaired = tryRepairManifestContent(content, path, defaultScope);
      if (repaired && repaired.repairs.length > 0) {
        await saveManifestContent(path, repaired.manifest);
        warnManifest(path, `autofixed manifest — ${repaired.repairs.join("; ")}`);
        return {
          manifest: repaired.manifest,
          repaired: true,
          repairs: repaired.repairs,
          warnings: repaired.warnings,
        };
      }
    }
    return { manifest, repaired: false, repairs: [], warnings: [] };
  } catch (strictErr) {
    const repaired = tryRepairManifestContent(content, path, defaultScope);
    if (!repaired) {
      warnManifest(
        path,
        `ignoring invalid manifest: ${strictErr instanceof Error ? strictErr.message : String(strictErr)}`,
      );
      return empty;
    }

    if (autofix) {
      try {
        await saveManifestContent(path, repaired.manifest);
        warnManifest(path, `autofixed manifest — ${repaired.repairs.join("; ")}`);
      } catch (writeErr) {
        warnManifest(
          path,
          `repaired in-memory but could not write: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
        );
        return {
          manifest: repaired.manifest,
          repaired: false,
          repairs: repaired.repairs,
          warnings: repaired.warnings,
        };
      }
    } else {
      warnManifest(path, `using repaired manifest (not written) — ${repaired.repairs.join("; ")}`);
    }

    return {
      manifest: repaired.manifest,
      repaired: autofix,
      repairs: repaired.repairs,
      warnings: repaired.warnings,
    };
  }
}

function serializeVarBlock(key: string, def: VarDefinition): string[] {
  const lines: string[] = [`[var.${key}]`, `visibility = "${def.visibility}"`];
  if (def.storage) lines.push(`storage = "${def.storage}"`);
  if (def.value !== undefined) lines.push(`value = ${JSON.stringify(def.value)}`);
  if (def.ask) lines.push(`ask = ${JSON.stringify(def.ask)}`);
  if (def.docs) lines.push(`docs = ${JSON.stringify(def.docs)}`);
  if (def.derive) lines.push(`derive = "${def.derive}"`);
  lines.push("");
  return lines;
}

function manifestHasInlineSecrets(manifest: Manifest): boolean {
  for (const def of manifest.vars.values()) {
    if (def.visibility === "secret" && def.value !== undefined) return true;
  }
  return false;
}

export function serializeManifest(manifest: Manifest): string {
  const lines: string[] = [
    "version = 1",
    `scope = "${manifest.scope}"`,
    "",
  ];

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
  const content = serializeManifest(manifest);
  if (manifestHasInlineSecrets(manifest)) {
    await writeSecretFile(path, content);
  } else {
    await writeTextFile(path, content);
  }
}

export async function saveManifest(
  path: string,
  vars: Map<string, VarDefinition>,
  scope: Scope = defaultScopeForPath(path),
): Promise<void> {
  await saveManifestContent(path, {
    version: 1,
    scope,
    vars: new Map(
      [...vars.entries()].map(([key, def]) => [key, { ...def, scope }]),
    ),
    bundles: new Map(),
  });
}

export function emptyManifest(scope: Scope = "global"): Manifest {
  return { version: 1, scope, vars: new Map(), bundles: new Map() };
}

export const INIT_PROJECT_MANIFEST = `version = 1
scope = "project"

# Opt into catalog / global bundles (definitions fall back to built-in catalog)
bundles = []

# Example:
# bundles = ["namecheap", "cloudflare"]
`;
