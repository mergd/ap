import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect } from "./expect.ts";
import { parseManifestContent, serializeManifest } from "../src/manifest.ts";
import {
  commandExists,
  resolveHookPlan,
  runHookPlan,
  type SpawnFn,
} from "../src/hooks.ts";

function enoent(command: string): Error {
  return Object.assign(new Error(`spawn ${command} ENOENT`), { code: "ENOENT" });
}

describe("hook manifest", () => {
  test("parses and round-trips hooks and actions", () => {
    const content = `
version = 1
scope = "project"
bundles = []

[hooks]
after_set = "sync"
after_unset = "none"
before_show = "sync"

[action.sync]
run = ["trove", "sync", "--force"]
`;
    const manifest = parseManifestContent(content, "ap.toml");
    expect(manifest.hooks?.after_set).toBe("sync");
    expect(manifest.hooks?.after_unset).toBe("none");
    expect(manifest.hooks?.before_show).toBe("sync");
    expect(manifest.actions?.get("sync")?.run).toEqual(["trove", "sync", "--force"]);

    const again = parseManifestContent(serializeManifest(manifest), "roundtrip.toml");
    expect(again.hooks).toEqual(manifest.hooks);
    expect(again.actions?.get("sync")?.run).toEqual(["trove", "sync", "--force"]);
  });

  test("rejects unknown hook events", () => {
    expect(() =>
      parseManifestContent(
        `version = 1
scope = "project"
[hooks]
before_run = "sync"
`,
        "ap.toml",
      ),
    ).toThrow(/unknown hook "before_run"/);
  });
});

describe("resolveHookPlan", () => {
  const syncManifest = parseManifestContent(
    `version = 1
scope = "project"
[hooks]
after_set = "sync"
[action.sync]
run = ["trove", "sync", "--force"]
`,
    "ap.toml",
  );

  test("defaults after_set to sync inside a Trove tree", () => {
    const plan = resolveHookPlan("after_set", { inTroveTree: true });
    expect("skip" in plan).toBe(false);
    if ("skip" in plan) return;
    expect(plan.action).toBe("sync");
    expect(plan.implied).toBe(true);
    expect(plan.run).toEqual(["trove", "sync", "--force"]);
  });

  test("skips implied sync outside a Trove tree", () => {
    expect(resolveHookPlan("after_set", { inTroveTree: false })).toEqual({ skip: "not-trove" });
  });

  test("does not imply before_show", () => {
    expect(resolveHookPlan("before_show", { inTroveTree: true })).toEqual({ skip: "unbound" });
  });

  test("honors after_set = none even in a Trove tree", () => {
    const manifest = parseManifestContent(
      `version = 1
scope = "project"
[hooks]
after_set = "none"
`,
      "ap.toml",
    );
    expect(resolveHookPlan("after_set", { projectManifest: manifest, inTroveTree: true })).toEqual({
      skip: "off",
    });
  });

  test("uses an explicit action run list", () => {
    const plan = resolveHookPlan("after_set", {
      projectManifest: syncManifest,
      inTroveTree: false,
    });
    expect("skip" in plan).toBe(false);
    if ("skip" in plan) return;
    expect(plan.implied).toBe(false);
    expect(plan.run).toEqual(["trove", "sync", "--force"]);
  });

  test("skips when AP_NO_HOOKS is set", () => {
    expect(
      resolveHookPlan("after_set", {
        projectManifest: syncManifest,
        inTroveTree: true,
        env: { AP_NO_HOOKS: "1" },
      }),
    ).toEqual({ skip: "disabled" });
  });

  test("project hooks override global", () => {
    const global = parseManifestContent(
      `version = 1
scope = "global"
[hooks]
after_set = "sync"
`,
      "g.toml",
    );
    const project = parseManifestContent(
      `version = 1
scope = "project"
[hooks]
after_set = "none"
`,
      "p.toml",
    );
    expect(
      resolveHookPlan("after_set", { globalManifest: global, projectManifest: project, inTroveTree: true }),
    ).toEqual({ skip: "off" });
  });
});

describe("runHookPlan", () => {
  test("fail closed on non-zero exit", async () => {
    const spawn: SpawnFn = async () => ({ code: 2, stdout: "", stderr: "nope" });
    await assert.rejects(
      () =>
        runHookPlan(
          { event: "after_set", action: "sync", run: ["trove", "sync", "--force"], implied: false },
          { spawn, fail: "closed" },
        ),
      /failed \(exit 2\)/,
    );
  });

  test("implied sync is skipped when trove is missing", async () => {
    const spawn: SpawnFn = async (command) => {
      throw enoent(command);
    };
    await runHookPlan(
      { event: "after_set", action: "sync", run: ["trove", "sync", "--force"], implied: true },
      { spawn, fail: "closed" },
    );
  });

  test("explicit sync fails when trove is missing", async () => {
    const spawn: SpawnFn = async (command) => {
      throw enoent(command);
    };
    await assert.rejects(
      () =>
        runHookPlan(
          { event: "after_set", action: "sync", run: ["trove", "sync", "--force"], implied: false },
          { spawn, fail: "closed" },
        ),
      /command not found: trove/,
    );
  });

  test("fail open warns instead of throwing", async () => {
    const spawn: SpawnFn = async () => ({ code: 1, stdout: "", stderr: "" });
    await runHookPlan(
      { event: "before_show", action: "sync", run: ["trove", "sync"], implied: false },
      { spawn, fail: "open" },
    );
  });
});

describe("commandExists", () => {
  test("is false on ENOENT", async () => {
    const spawn: SpawnFn = async (command) => {
      throw enoent(command);
    };
    expect(await commandExists("trove", spawn)).toBe(false);
  });

  test("is true when the binary runs", async () => {
    const spawn: SpawnFn = async () => ({ code: 0, stdout: "1.0.0", stderr: "" });
    expect(await commandExists("trove", spawn)).toBe(true);
  });
});

describe("findTroveRoot", () => {
  test("walks up to a .trove directory", async () => {
    const { findTroveRoot } = await import("../src/hooks.ts");
    const root = await mkdtemp(join(tmpdir(), "ap-trove-"));
    const nested = join(root, "a", "b");
    await mkdir(nested, { recursive: true });
    await mkdir(join(root, ".trove"));
    expect(await findTroveRoot(nested, {})).toBe(resolve(root));
  });
});
