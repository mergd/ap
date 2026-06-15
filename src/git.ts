import { dirname, relative, resolve } from "node:path";

async function git(args: string[], cwd: string): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, stdout: stdout.trim() };
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
