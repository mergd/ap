import { basename } from "node:path";
import { parse } from "smol-toml";
import type {
  BundleDefinition,
  DeriveKind,
  Manifest,
  ManifestAction,
  ManifestEncryption,
  ManifestHooks,
  Scope,
  VarDefinition,
  Visibility,
} from "./types.ts";
import { HOOK_EVENTS, type HookEvent } from "./types.ts";
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

  if (entry.storage !== undefined) {
    throw new Error(
      `${key}: storage was removed — project secrets always live in .ap/secrets.json (use: ap set ${key})`,
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

  if (entry.value !== undefined && typeof entry.value !== "string") {
    throw new Error(`${key}: value must be a string`);
  }

  if (derive && visibility !== "public") {
    throw new Error(`${key}: derive requires visibility = "public"`);
  }

  if (derive && entry.value !== undefined) {
    throw new Error(`${key}: use either value or derive, not both`);
  }

  if (fileScope === "project" && visibility === "secret" && entry.value !== undefined) {
    throw new Error(
      `${key}: project secrets cannot use inline value — use: ap set ${key}`,
    );
  }

  return {
    key,
    visibility,
    scope: fileScope,
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

/** Infer file scope from path when TOML omits scope (UI convenience). */
export function defaultScopeForPath(path: string): Scope {
  return basename(path) === PROJECT_MANIFEST_NAME ? "project" : "global";
}

const SKIP_KEYS = new Set(["version", "scope", "var", "bundle", "bundles", "encryption", "hooks", "action"]);

function parseEncryption(raw: unknown, source: string): ManifestEncryption | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${source}: [encryption] must be a table`);
  }

  const entry = raw as Record<string, unknown>;
  if (typeof entry.op_vault !== "string" || !entry.op_vault) {
    throw new Error(`${source}: [encryption] requires op_vault`);
  }
  if (typeof entry.op_item !== "string" || !entry.op_item) {
    throw new Error(`${source}: [encryption] requires op_item`);
  }
  if (entry.op_account !== undefined && typeof entry.op_account !== "string") {
    throw new Error(`${source}: [encryption].op_account must be a string`);
  }

  return {
    opVault: entry.op_vault,
    opItem: entry.op_item,
    ...(typeof entry.op_account === "string" ? { opAccount: entry.op_account } : {}),
  };
}

function parseHookEvent(value: string, source: string): HookEvent {
  if ((HOOK_EVENTS as readonly string[]).includes(value)) return value as HookEvent;
  throw new Error(`${source}: unknown hook "${value}" (expected ${HOOK_EVENTS.join(", ")})`);
}

function parseHooks(raw: unknown, source: string): ManifestHooks | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${source}: [hooks] must be a table`);
  }

  const entry = raw as Record<string, unknown>;
  const hooks: ManifestHooks = {};
  for (const [key, value] of Object.entries(entry)) {
    const event = parseHookEvent(key, source);
    if (typeof value !== "string") {
      throw new Error(`${source}: hooks.${event} must be an action name (string)`);
    }
    hooks[event] = value;
  }
  return hooks;
}

function parseActionEntry(name: string, raw: unknown, source: string): ManifestAction {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${source}: [action.${name}] must be a table`);
  }
  const entry = raw as Record<string, unknown>;
  if (!Array.isArray(entry.run) || entry.run.length === 0) {
    throw new Error(`${source}: [action.${name}] requires run = ["cmd", ...]`);
  }
  const run = entry.run.filter((part): part is string => typeof part === "string");
  if (run.length !== entry.run.length || run.length === 0) {
    throw new Error(`${source}: [action.${name}] run must be an array of strings`);
  }
  return { run };
}

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

  const actions = new Map<string, ManifestAction>();
  const nestedAction = raw.action;
  if (nestedAction && typeof nestedAction === "object" && !Array.isArray(nestedAction)) {
    for (const [name, value] of Object.entries(nestedAction)) {
      actions.set(name, parseActionEntry(name, value, source));
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
    if (tomlKey.startsWith("action.")) {
      actions.set(
        tomlKey.slice("action.".length),
        parseActionEntry(tomlKey.slice("action.".length), value, source),
      );
      continue;
    }
    throw new Error(`${source}: unknown top-level key "${tomlKey}"`);
  }

  let activeBundles: string[] | undefined;
  if (Array.isArray(raw.bundles)) {
    activeBundles = raw.bundles.filter((b): b is string => typeof b === "string");
  }

  const encryption = parseEncryption(raw.encryption, source);
  const hooks = parseHooks(raw.hooks, source);

  return {
    version: 1,
    scope,
    vars,
    bundles,
    activeBundles,
    encryption,
    ...(hooks ? { hooks } : {}),
    ...(actions.size > 0 ? { actions } : {}),
  };
}

/**
 * Load a manifest. Returns null for missing/unreadable/invalid files.
 * Requires scope in the file (no defaultScope / autofix on load).
 */
export async function loadManifest(path: string): Promise<Manifest | null> {
  let content: string;
  try {
    content = await readTextFile(path);
  } catch (err) {
    if (isNotFound(err)) return null;
    console.error(
      `ap: could not read manifest: ${err instanceof Error ? err.message : String(err)} (${path})`,
    );
    return null;
  }

  try {
    return parseManifestContent(content, path);
  } catch (err) {
    console.error(
      `ap: ignoring invalid manifest: ${err instanceof Error ? err.message : String(err)} (${path})`,
    );
    return null;
  }
}

function serializeVarBlock(key: string, def: VarDefinition): string[] {
  const lines: string[] = [`[var.${key}]`, `visibility = "${def.visibility}"`];
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

  if (manifest.encryption) {
    lines.push("[encryption]");
    lines.push(`op_vault = ${JSON.stringify(manifest.encryption.opVault)}`);
    lines.push(`op_item = ${JSON.stringify(manifest.encryption.opItem)}`);
    if (manifest.encryption.opAccount) {
      lines.push(`op_account = ${JSON.stringify(manifest.encryption.opAccount)}`);
    }
    lines.push("");
  }

  if (manifest.hooks && HOOK_EVENTS.some((event) => manifest.hooks?.[event] !== undefined)) {
    lines.push("[hooks]");
    for (const event of HOOK_EVENTS) {
      const bound = manifest.hooks[event];
      if (bound === undefined) continue;
      lines.push(`${event} = ${JSON.stringify(bound)}`);
    }
    lines.push("");
  }

  const sortedActions = [...(manifest.actions?.entries() ?? [])].sort(([a], [b]) => a.localeCompare(b));
  for (const [name, action] of sortedActions) {
    lines.push(`[action.${name}]`);
    lines.push(`run = ${JSON.stringify(action.run)}`);
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

# Optional: bind Trove sync after secret writes (implied inside a Trove checkout)
# [hooks]
# after_set = "sync"
# after_unset = "sync"
#
# [action.sync]
# run = ["trove", "sync", "--force"]
`;
