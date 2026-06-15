import { describe, expect, test } from "bun:test";
import { mergeBundleDefinition } from "../src/bundles.ts";
import { mergeDefinition } from "../src/resolve.ts";

describe("catalog", () => {
  test("resolves cloudflare bundle without manifest entry", () => {
    const bundle = mergeBundleDefinition("cloudflare", null, null);
    expect(bundle?.vars).toEqual(["CF_GLOBAL_API_KEY", "CF_GLOBAL_EMAIL"]);
    expect(bundle?.prompt).toContain("X-Auth-Email");
  });

  test("catalog var defs fill in ask/visibility", () => {
    const def = mergeDefinition("CF_GLOBAL_API_KEY", undefined, undefined, false, {
      key: "CF_GLOBAL_API_KEY",
      visibility: "secret",
      scope: "global",
      ask: "from catalog",
    });
    expect(def.visibility).toBe("secret");
    expect(def.ask).toBe("from catalog");
  });
});
