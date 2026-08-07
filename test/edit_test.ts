import { describe, test } from "node:test";
import { expect } from "./expect.ts";
import { isDetachedEditor, parseEditTarget, resolveEditScope } from "../src/edit.ts";

describe("resolveEditScope", () => {
  test("secrets falls back to global without project", () => {
    const scope = resolveEditScope("secrets", false, false);
    expect(scope.useGlobal).toBe(true);
    expect(scope.fallbackToGlobal).toBe(true);
  });

  test("secrets uses project when available", () => {
    expect(resolveEditScope("secrets", false, true)).toEqual({ useGlobal: false });
  });

  test("secrets --global uses global even with project", () => {
    expect(resolveEditScope("secrets", true, true)).toEqual({ useGlobal: true });
  });

  test("manifest is always global", () => {
    expect(resolveEditScope("manifest", false, false)).toEqual({ useGlobal: true });
  });

  test("toml requires project", () => {
    const scope = resolveEditScope("toml", false, false);
    expect(scope.error).toContain("ap init");
  });

  test("toml rejects --global", () => {
    const scope = resolveEditScope("toml", true, true);
    expect(scope.error).toContain("project-scoped");
  });
});

describe("parseEditTarget", () => {
  test("accepts global/project aliases", () => {
    expect(parseEditTarget("global")).toBe("manifest");
    expect(parseEditTarget("project")).toBe("toml");
    expect(parseEditTarget("manifest")).toBe("manifest");
    expect(parseEditTarget("toml")).toBe("toml");
    expect(parseEditTarget("secrets")).toBe("secrets");
  });
});

describe("isDetachedEditor", () => {
  test("treats cursor and code as detached", () => {
    expect(isDetachedEditor("cursor")).toBe(true);
    expect(isDetachedEditor("code")).toBe(true);
    expect(isDetachedEditor("code --wait")).toBe(true);
    expect(isDetachedEditor("/usr/local/bin/cursor")).toBe(true);
  });

  test("terminal editors block", () => {
    expect(isDetachedEditor("vim")).toBe(false);
    expect(isDetachedEditor("nano")).toBe(false);
    expect(isDetachedEditor(undefined)).toBe(false);
  });
});
