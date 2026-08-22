import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect } from "./expect.ts";
import { parseManifestContent, serializeManifest } from "../src/manifest.ts";
import { projectHookScript } from "../src/paths.ts";
import { resolveHookPlan, resolveHookScriptPath, runHookPlan, type SpawnFn } from "../src/hooks.ts";

function enoent(command: string): Error {
  return Object.assign(new Error(`spawn ${command} ENOENT`), { code: "ENOENT" });
}

describe("hook manifest", () => {
  test("parses and round-trips hook script paths", () => {
    const content = `
version = 1
scope = "project"
bundles = []

[hooks]
after_set = ".ap/hooks/sync"
after_unset = "none"
before_show = ".ap/hooks/sync"
`;
    const manifest = parseManifestContent(content, "ap.toml");
    expect(manifest.hooks?.after_set).toBe(".ap/hooks/sync");
    expect(manifest.hooks?.after_unset).toBe("none");
    expect(manifest.hooks?.before_show).toBe(".ap/hooks/sync");

    const again = parseManifestContent(serializeManifest(manifest), "roundtrip.toml");
    expect(again.hooks).toEqual(manifest.hooks);
  });

  test("rejects unknown hook events", () => {
    expect(() =>
      parseManifestContent(
        `version = 1
scope = "project"
[hooks]
before_run = ".ap/hooks/sync"
`,
        "ap.toml",
      ),
    ).toThrow(/unknown hook "before_run"/);
  });
});

describe("resolveHookPlan", () => {
  const bound = parseManifestContent(
    `version = 1
scope = "project"
[hooks]
after_set = ".ap/hooks/sync"
`,
    "ap.toml",
  );

  test("binds toml paths relative to the project root", async () => {
    const plan = await resolveHookPlan("after_set", {
      projectManifest: bound,
      projectRoot: "/repo",
    });
    expect("skip" in plan).toBe(false);
    if ("skip" in plan) return;
    expect(plan.implied).toBe(false);
    expect(plan.script).toBe(resolve("/repo", ".ap/hooks/sync"));
  });

  test("skips when unbound and no .ap/hooks file", async () => {
    expect(await resolveHookPlan("after_set", { projectRoot: "/repo", exists: async () => false })).toEqual({
      skip: "unbound",
    });
  });

  test("runs .ap/hooks/<event> when unbound and the file exists", async () => {
    const plan = await resolveHookPlan("after_set", {
      projectRoot: "/repo",
      exists: async (path) => path === projectHookScript("/repo", "after_set"),
    });
    expect("skip" in plan).toBe(false);
    if ("skip" in plan) return;
    expect(plan.implied).toBe(true);
    expect(plan.script).toBe(projectHookScript("/repo", "after_set"));
  });

  test("honors after_set = none even when a default script exists", async () => {
    const manifest = parseManifestContent(
      `version = 1
scope = "project"
[hooks]
after_set = "none"
`,
      "ap.toml",
    );
    expect(
      await resolveHookPlan("after_set", {
        projectManifest: manifest,
        projectRoot: "/repo",
        exists: async () => true,
      }),
    ).toEqual({ skip: "off" });
  });

  test("skips when AP_NO_HOOKS is set", async () => {
    expect(
      await resolveHookPlan("after_set", {
        projectManifest: bound,
        projectRoot: "/repo",
        env: { AP_NO_HOOKS: "1" },
      }),
    ).toEqual({ skip: "disabled" });
  });

  test("project hooks override global", async () => {
    const global = parseManifestContent(
      `version = 1
scope = "global"
[hooks]
after_set = ".ap/hooks/sync"
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
      await resolveHookPlan("after_set", {
        globalManifest: global,
        projectManifest: project,
        projectRoot: "/repo",
      }),
    ).toEqual({ skip: "off" });
  });
});

describe("runHookPlan", () => {
  test("fail closed on non-zero exit", async () => {
    const spawn: SpawnFn = async () => ({ code: 2, stdout: "", stderr: "nope" });
    await assert.rejects(
      () =>
        runHookPlan(
          { event: "after_set", script: "/repo/.ap/hooks/sync", implied: false },
          { spawn, fail: "closed" },
        ),
      /failed \(exit 2\)/,
    );
  });

  test("explicit script fails when missing", async () => {
    const spawn: SpawnFn = async (command) => {
      throw enoent(command);
    };
    await assert.rejects(
      () =>
        runHookPlan(
          { event: "after_set", script: "/missing/sync", implied: false },
          { spawn, fail: "closed" },
        ),
      /script not found/,
    );
  });

  test("after_run is detached and never fails the caller", async () => {
    const spawn: SpawnFn = async (_command, _args, options) => {
      expect(options?.detached).toBe(true);
      return { code: 2, stdout: "", stderr: "ignored" };
    };
    await runHookPlan(
      { event: "after_run", script: "/repo/.ap/hooks/after_run", implied: false },
      { spawn, fail: "open", detached: true },
    );
  });

  test("after_run spawn errors do not throw", async () => {
    const spawn: SpawnFn = async (command) => {
      throw enoent(command);
    };
    await runHookPlan(
      { event: "after_run", script: "/missing", implied: false },
      { spawn, fail: "open", detached: true },
    );
  });
});

describe("hook scripts on disk", () => {
  test("resolveHookScriptPath keeps absolute paths", () => {
    expect(resolveHookScriptPath("/repo", "/abs/sync")).toBe("/abs/sync");
  });

  test("discovers .ap/hooks/after_set from a real tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "ap-hooks-"));
    const script = projectHookScript(root, "after_set");
    await mkdir(join(root, ".ap", "hooks"), { recursive: true });
    await writeFile(script, "#!/bin/sh\nexit 0\n");
    const plan = await resolveHookPlan("after_set", { projectRoot: root });
    expect("skip" in plan).toBe(false);
    if ("skip" in plan) return;
    expect(plan.script).toBe(resolve(script));
    expect(plan.implied).toBe(true);
  });
});
