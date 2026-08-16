import { describe, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect } from "./expect.ts";
import {
  checkForUpdate,
  formatUpdateNotice,
  formatVersionOutput,
  isNewerVersion,
  lookupLatestVersion,
  readCurrentVersion,
} from "../src/update-check.ts";

describe("update check", () => {
  test("reads package.json version", async () => {
    const pkg = JSON.parse(await readFile(join(import.meta.dirname, "../package.json"), "utf8")) as {
      version: string;
    };
    expect(await readCurrentVersion()).toBe(pkg.version);
  });

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

  test("formats --version with latest and update instructions", () => {
    expect(formatVersionOutput("0.3.3", "0.3.3")).toBe("0.3.3\nlatest 0.3.3 — up to date");
    expect(formatVersionOutput("0.3.3", "0.4.0")).toBe(
      "0.3.3\nlatest 0.4.0 — update with: npm install -g @mergd/ap@latest",
    );
    expect(formatVersionOutput("0.3.3", null)).toBe("0.3.3\nlatest unknown");
  });

  test("lookupLatestVersion polls even when the nag cache is fresh", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ap-update-"));
    const cachePath = join(dir, "update-check.json");
    let polls = 0;
    const fetchLatest = async () => {
      polls++;
      return "0.4.0";
    };

    try {
      await checkForUpdate({
        currentVersion: "0.3.3",
        cachePath,
        now: 1_000_000,
        env: {},
        fetchLatest,
      });
      const latest = await lookupLatestVersion({
        cachePath,
        now: 1_000_001,
        env: {},
        fetchLatest,
      });

      expect(polls).toBe(2);
      expect(latest).toBe("0.4.0");
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
