import { describe, expect, test } from "bun:test";
import { mergeBundleDefinition } from "../src/bundles.ts";
import { buildManifestFromCatalog, mergeCatalogBundles } from "../src/catalog/scaffold.ts";
import { emptyManifest, serializeManifest } from "../src/manifest.ts";

describe("catalog scaffold", () => {
  test("buildManifestFromCatalog writes full bundle + var defs", () => {
    const manifest = buildManifestFromCatalog(["cloudflare"]);
    expect(manifest.bundles.has("cloudflare")).toBe(true);
    expect(manifest.vars.has("CF_GLOBAL_API_KEY")).toBe(true);
    expect(manifest.vars.get("CF_GLOBAL_EMAIL")?.visibility).toBe("public");
    expect(manifest.bundles.get("cloudflare")?.prompt).toContain("X-Auth-Email");
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
    expect(manifest.bundles.has("cloudflare")).toBe(true);
  });

  test("runtime resolves bundles from manifest only", () => {
    const bundle = mergeBundleDefinition("cloudflare", null, null);
    expect(bundle).toBeUndefined();
  });

  test("runtime resolves scaffolded manifest", () => {
    const global = buildManifestFromCatalog(["cloudflare"]);
    const bundle = mergeBundleDefinition("cloudflare", null, global);
    expect(bundle?.vars).toEqual(["CF_GLOBAL_API_KEY", "CF_GLOBAL_EMAIL"]);
  });

  test("serializeManifest groups vars under their bundle", () => {
    const manifest = buildManifestFromCatalog(["cloudflare", "namecheap"]);
    const content = serializeManifest(manifest);
    const cfBundle = content.indexOf("[bundle.cloudflare]");
    const cfKey = content.indexOf("[var.CF_GLOBAL_API_KEY]");
    const cfEmail = content.indexOf("[var.CF_GLOBAL_EMAIL]");
    const ncBundle = content.indexOf("[bundle.namecheap]");
    const ncUser = content.indexOf("[var.NC_API_USER]");
    expect(cfBundle).toBeLessThan(cfKey);
    expect(cfKey).toBeLessThan(cfEmail);
    expect(cfEmail).toBeLessThan(ncBundle);
    expect(ncBundle).toBeLessThan(ncUser);
  });
});
