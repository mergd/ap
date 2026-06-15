import type { BundleDefinition, VarDefinition } from "../types.ts";
import type { CatalogBundle, CatalogVar } from "./types.ts";

const cloudflare: CatalogBundle = {
  ask: "Global API Key + account email.",
  docs: "https://developers.cloudflare.com/fundamentals/api/get-started/keys/#global-api-key",
  prompt: [
    "Auth: X-Auth-Email = CF_GLOBAL_EMAIL, X-Auth-Key = CF_GLOBAL_API_KEY (not Bearer).",
    "Inject vars with ap run --bundle cloudflare -- sh -c '...' when the command needs $VAR expansion.",
  ].join("\n"),
  vars: {
    CF_GLOBAL_API_KEY: {
      visibility: "secret",
      ask: "My Profile → API Tokens → Global API Key.",
    },
    CF_GLOBAL_EMAIL: {
      visibility: "public",
      ask: "Account login email.",
    },
  },
};

const namecheap: CatalogBundle = {
  ask: "Enable API access, whitelist IP, paste key.",
  docs: "https://www.namecheap.com/support/api/intro/",
  prompt: [
    "Every request needs query params ApiUser, ApiKey, ClientIp (NC_API_USER, NC_API_KEY, NC_CLIENT_IP).",
    "Whitelist NC_CLIENT_IP in Namecheap before calling the API.",
  ].join("\n"),
  vars: {
    NC_API_USER: {
      visibility: "public",
      ask: "API username (usually your account username).",
    },
    NC_API_KEY: {
      visibility: "secret",
      ask: "Profile → Tools → API Access.",
    },
    NC_CLIENT_IP: {
      visibility: "public",
      derive: "public-ipv4",
      ask: "Whitelisted client IP (resolved at runtime).",
    },
  },
};

export const CATALOG: Record<string, CatalogBundle> = {
  cloudflare,
  namecheap,
};

export function listCatalogBundles(): string[] {
  return Object.keys(CATALOG).sort();
}

export function getCatalogBundle(name: string): CatalogBundle | undefined {
  return CATALOG[name];
}

export function catalogBundleDefinition(name: string): BundleDefinition | undefined {
  const entry = getCatalogBundle(name);
  if (!entry) return undefined;

  return {
    name,
    vars: Object.keys(entry.vars),
    ask: entry.ask,
    docs: entry.docs,
    prompt: entry.prompt,
  };
}

export function catalogVarDefinition(bundleName: string, key: string): VarDefinition | undefined {
  const entry = getCatalogBundle(bundleName);
  const def = entry?.vars[key];
  if (!def) return undefined;

  return catalogVarToDefinition(key, def);
}

export function catalogVarToDefinition(key: string, def: CatalogVar): VarDefinition {
  return {
    key,
    visibility: def.visibility,
    scope: "global",
    ask: def.ask,
    docs: def.docs,
    derive: def.derive,
  };
}

export function catalogVarKeys(bundleNames: string[]): string[] {
  const keys = new Set<string>();
  for (const name of bundleNames) {
    const entry = getCatalogBundle(name);
    if (!entry) continue;
    for (const key of Object.keys(entry.vars)) keys.add(key);
  }
  return [...keys].sort();
}
