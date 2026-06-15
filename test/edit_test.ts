import { describe, expect, test } from "bun:test";
import { isDetachedEditor } from "../src/edit.ts";

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
