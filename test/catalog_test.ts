import { describe, test } from "node:test";
import { expect } from "./expect.ts";
import { getActiveBundleNames, mergeBundleDefinition } from "../src/bundles.ts";
import { buildManifestFromCatalog, mergeCatalogBundles } from "../src/catalog/scaffold.ts";
import { emptyManifest, serializeManifest } from "../src/manifest.ts";
import type { ResolveContext } from "../src/types.ts";

describe("catalog scaffold", () => {
  test("buildManifestFromCatalog writes var stubs only (no [bundle.*])", () => {
    const manifest = buildManifestFromCatalog(["cloudflare"]);
    expect(manifest.bundles.has("cloudflare")).toBe(false);
    expect(manifest.vars.has("CF_GLOBAL_API_KEY")).toBe(true);
    expect(manifest.vars.get("CF_GLOBAL_EMAIL")?.visibility).toBe("public");
  });

  test("mergeCatalogBundles preserves existing var values", () => {
    const manifest = emptyManifest();
    manifest.vars.set("CF_GLOBAL_EMAIL", {
      key: "CF_GLOBAL_EMAIL",
      visibility: "public",
      value: "kept@example.com",
    });
    mergeCatalogBundles(manifest, ["cloudflare"]);
    expect(manifest.vars.get("CF_GLOBAL_EMAIL")?.value).toBe("kept@example.com");
    expect(manifest.bundles.has("cloudflare")).toBe(false);
  });

  test("runtime falls back to catalog bundle definitions", () => {
    const bundle = mergeBundleDefinition("cloudflare", null, null);
    expect(bundle?.vars).toEqual(["CF_GLOBAL_API_KEY", "CF_GLOBAL_EMAIL"]);
    expect(bundle?.prompt).toContain("X-Auth-Email");
  });

  test("runtime resolves scaffolded manifest via catalog identity", () => {
    const global = buildManifestFromCatalog(["cloudflare"]);
    const bundle = mergeBundleDefinition("cloudflare", null, global);
    expect(bundle?.vars).toEqual(["CF_GLOBAL_API_KEY", "CF_GLOBAL_EMAIL"]);
  });

  test("openrouter catalog prompt documents response key path", () => {
    const manifest = buildManifestFromCatalog(["openrouter"]);
    expect(manifest.vars.has("OPENROUTER_MANAGEMENT_API_KEY")).toBe(true);
    const bundle = mergeBundleDefinition("openrouter", null, manifest);
    expect(bundle?.prompt).toContain(".key");
    expect(bundle?.prompt).toContain("not .data.key");
  });

  test("serializeManifest writes flat vars when no [bundle.*]", () => {
    const manifest = buildManifestFromCatalog(["cloudflare", "namecheap"]);
    const content = serializeManifest(manifest);
    expect(content.includes("[bundle.cloudflare]")).toBe(false);
    expect(content.includes("[bundle.namecheap]")).toBe(false);
    expect(content).toContain("[var.CF_GLOBAL_API_KEY]");
    expect(content).toContain("[var.NC_API_USER]");
  });

  test("global active bundles infer from catalog ∩ var keys", () => {
    const global = buildManifestFromCatalog(["cloudflare"]);
    const ctx: ResolveContext = {
      projectRoot: null,
      globalManifest: global,
      projectManifest: null,
      projectSecrets: {},
    };
    expect(getActiveBundleNames(ctx, true)).toEqual(["cloudflare"]);
  });
});
