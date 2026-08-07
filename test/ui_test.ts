import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { expect } from "./expect.ts";
import {
  buildUiHtml,
  loadUiContent,
  resolveUiTarget,
  saveUiContent,
  saveUiModel,
} from "../src/ui.ts";
import {
  parseContentToUiModel,
  serializeUiModel,
} from "../src/ui-model.ts";

describe("resolveUiTarget", () => {
  test("global targets manifest.toml", async () => {
    const prev = process.env.AP_GLOBAL_HOME;
    process.env.AP_GLOBAL_HOME = "/tmp/ap-ui-test-home";
    try {
      const resolved = await resolveUiTarget(true);
      expect(resolved.error).toBe(undefined);
      expect(resolved.mode).toBe("global");
      expect(resolved.label).toContain("global");
      expect(resolved.path.endsWith("manifest.toml")).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.AP_GLOBAL_HOME;
      else process.env.AP_GLOBAL_HOME = prev;
    }
  });

  test("project errors without ap.toml", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ap-ui-"));
    const prev = process.cwd();
    try {
      process.chdir(dir);
      const resolved = await resolveUiTarget(false);
      expect(resolved.error).toContain("ap init");
    } finally {
      process.chdir(prev);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("project resolves ap.toml", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ap-ui-"));
    const prev = process.cwd();
    try {
      await writeFile(join(dir, "ap.toml"), 'version = 1\nscope = "project"\nbundles = []\n');
      process.chdir(dir);
      const resolved = await resolveUiTarget(false);
      expect(resolved.error).toBe(undefined);
      expect(resolved.mode).toBe("project");
      expect(resolved.path.endsWith("/ap.toml")).toBe(true);
    } finally {
      process.chdir(prev);
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("ui model", () => {
  test("project round-trips active bundles and vars", () => {
    const model = parseContentToUiModel(
      `version = 1
scope = "project"
bundles = ["cloudflare"]

[var.DEPLOY_TOKEN]
visibility = "secret"
ask = "CI deploy token"
`,
      "project",
    );
    expect(model.scope).toBe("project");
    expect(model.activeBundles).toEqual(["cloudflare"]);
    expect(model.vars.length).toBe(1);
    expect(model.vars[0]!.key).toBe("DEPLOY_TOKEN");

    const toml = serializeUiModel(model);
    expect(toml).toContain('scope = "project"');
    expect(toml).toContain('bundles = ["cloudflare"]');
    expect(toml).toContain("[var.DEPLOY_TOKEN]");
    expect(toml.includes('scope = "project"', toml.indexOf("[var."))).toBe(false);
  });

  test("global round-trips bundle + vars", () => {
    const model = parseContentToUiModel(
      `version = 1
scope = "global"

[bundle.demo]
ask = "demo ask"
vars = ["DEMO_KEY"]

[var.DEMO_KEY]
visibility = "secret"
ask = "paste key"
`,
      "global",
    );
    expect(model.scope).toBe("global");
    expect(model.bundles.length).toBe(1);
    expect(model.bundles[0]!.name).toBe("demo");
    expect(model.vars[0]!.key).toBe("DEMO_KEY");
    const toml = serializeUiModel(model);
    expect(toml).toContain('scope = "global"');
    expect(toml).toContain("[bundle.demo]");
    expect(toml).toContain('vars = ["DEMO_KEY"]');
  });
});

describe("saveUiContent", () => {
  test("rejects invalid toml", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ap-ui-"));
    const path = join(dir, "ap.toml");
    try {
      let threw = false;
      try {
        await saveUiContent(path, "version = 2\n");
      } catch (err) {
        threw = true;
        expect(String(err)).toContain("unsupported version");
      }
      expect(threw).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("writes valid toml", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ap-ui-"));
    const path = join(dir, "ap.toml");
    try {
      await saveUiContent(path, 'version = 1\nscope = "project"\nbundles = ["cloudflare"]\n');
      const content = await loadUiContent(path);
      expect(content).toContain('bundles = ["cloudflare"]');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("saveUiModel writes structured project manifest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ap-ui-"));
    const path = join(dir, "ap.toml");
    try {
      const saved = await saveUiModel(path, {
        mode: "project",
        version: 1,
        scope: "project",
        activeBundles: ["namecheap"],
        bundles: [],
        vars: [{ key: "LOCAL_TOKEN", visibility: "secret" }],
        catalog: [],
      });
      expect(saved.content).toContain('scope = "project"');
      expect(saved.content).toContain('bundles = ["namecheap"]');
      expect(saved.content).toContain("[var.LOCAL_TOKEN]");
      expect(saved.model.activeBundles).toEqual(["namecheap"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("buildUiHtml", () => {
  test("includes structured form chrome without per-var scope", () => {
    const model = parseContentToUiModel(
      'version = 1\nscope = "project"\nbundles = ["cloudflare"]\n',
      "project",
    );
    const html = buildUiHtml({
      label: "project ap.toml",
      path: "/repo/ap.toml",
      mode: "project",
      model,
      content: 'version = 1\nscope = "project"\nbundles = ["cloudflare"]\n# <script>alert(1)</script>\n',
    });
    expect(html).toContain("bootstrap@3.4.1");
    expect(html).toContain("navbar-inverse");
    expect(html).toContain('id="save"');
    expect(html).toContain('id="discard"');
    expect(html).toContain('id="dirty-badge"');
    expect(html).toContain("Active bundles");
    expect(html).toContain("Standalone vars");
    expect(html).toContain("Raw TOML");
    expect(html).toContain("glyphicon-eye-open");
    expect(html.includes("Public value (optional)")).toBe(false);
    expect(html.includes('field("Scope"')).toBe(false);
    expect(html.includes("Add orphan var")).toBe(false);
    expect(html.includes("Orphan vars")).toBe(false);
    expect(html).toContain("/repo/ap.toml");
    expect(html.includes("<script>alert(1)</script>")).toBe(false);
    expect(html).toContain("&lt;script&gt;");
  });

  test("global mode has collapsible groupings", () => {
    const model = parseContentToUiModel(
      `version = 1
scope = "global"

[bundle.demo]
vars = ["DEMO_KEY"]

[var.DEMO_KEY]
visibility = "secret"
`,
      "global",
    );
    const html = buildUiHtml({
      label: "global manifest.toml",
      path: "/home/.config/ap/manifest.toml",
      mode: "global",
      model,
      content: "version = 1\nscope = \"global\"\n",
    });
    expect(html).toContain("Groupings");
    expect(html).toContain("Add grouping");
    expect(html).toContain("Ungrouped vars");
    expect(html).toContain("bundle-collapse");
    expect(html).toContain("bundle-toggle");
    expect(html).toContain('id="save"');
    expect(html).toContain("navbar-actions");
    expect(html.includes("Add orphan var")).toBe(false);
    expect(html.includes("Orphan vars")).toBe(false);
  });
});
