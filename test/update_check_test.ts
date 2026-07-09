import { describe, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect } from "./expect.ts";
import {
  checkForUpdate,
  formatUpdateNotice,
  isNewerVersion,
} from "../src/update-check.ts";

describe("update check", () => {
  test("compares stable semantic versions", () => {
    expect(isNewerVersion("0.3.1", "0.3.0")).toBe(true);
    expect(isNewerVersion("0.10.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("0.3.0", "0.3.0")).toBe(false);
    expect(isNewerVersion("0.2.9", "0.3.0")).toBe(false);
  });

  test("polls once per interval and never exposes the result on stdout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ap-update-"));
    const cachePath = join(dir, "update-check.json");
    let polls = 0;

    try {
      const first = await checkForUpdate({
        currentVersion: "0.3.0",
        cachePath,
        now: 1_000_000,
        env: {},
        fetchLatest: async () => {
          polls++;
          return "0.3.1";
        },
      });
      const second = await checkForUpdate({
        currentVersion: "0.3.0",
        cachePath,
        now: 1_000_001,
        env: {},
        fetchLatest: async () => {
          polls++;
          return "0.3.1";
        },
      });

      expect(polls).toBe(1);
      expect(first).toEqual({
        current: "0.3.0",
        latest: "0.3.1",
        command: "npm install -g @mergd/ap@latest",
      });
      expect(formatUpdateNotice(first!)).toContain("0.3.0 → 0.3.1");
      expect(second).toBe(null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("is disabled in CI", async () => {
    let polled = false;
    const result = await checkForUpdate({
      currentVersion: "0.3.0",
      env: { CI: "true" },
      fetchLatest: async () => {
        polled = true;
        return "0.3.1";
      },
    });

    expect(polled).toBe(false);
    expect(result).toBe(null);
  });
});
