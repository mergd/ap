import { dirname, relative, resolve } from "node:path";
import { spawnAsync } from "./spawn.ts";

async function git(args: string[], cwd: string): Promise<{ code: number; stdout: string }> {
  return spawnAsync("git", args, {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
}

/** True when `path` is tracked in the git repo that contains it. */
export async function isFileGitTracked(path: string): Promise<boolean> {
  const abs = resolve(path);
  const dir = dirname(abs);

  const top = await git(["rev-parse", "--show-toplevel"], dir);
  if (top.code !== 0) return false;

  const rel = relative(top.stdout, abs);
  const listed = await git(["ls-files", "--error-unmatch", "--", rel], top.stdout);
  return listed.code === 0;
}
