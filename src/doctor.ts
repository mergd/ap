import { globalHome } from "./paths.ts";
import { resolveBundles } from "./bundles.ts";
import { loadResolveContext, resolveAll } from "./resolve.ts";
import type { DoctorResult } from "./types.ts";

export async function runDoctor(
  projectRoot?: string | null,
  bundleFilter?: string,
): Promise<DoctorResult> {
  const ctx = await loadResolveContext(projectRoot);
  const vars = await resolveAll(ctx, { includeSecrets: false, surfacePublic: true, bundleFilter });
  const bundles = await resolveBundles(ctx, vars, { bundleFilter });

  const bundleList = Object.values(bundles);
  const ready = bundleFilter
    ? (bundles[bundleFilter]?.ready ?? false)
    : bundleList.length > 0
    ? bundleList.every((b) => b.ready)
    : vars.every((v) => v.status === "set");

  return {
    ready,
    project: ctx.projectRoot,
    global_home: globalHome(),
    bundles,
    ...(bundleFilter ? {} : { vars }),
  };
}

export async function runGlobalDoctor(bundleFilter?: string): Promise<DoctorResult> {
  const ctx = await loadResolveContext(null);
  const vars = await resolveAll(ctx, { globalOnly: true, includeSecrets: false, surfacePublic: true, bundleFilter });
  const bundles = await resolveBundles(ctx, vars, { globalOnly: true, bundleFilter });

  const bundleList = Object.values(bundles);
  const ready = bundleFilter
    ? (bundles[bundleFilter]?.ready ?? false)
    : bundleList.length > 0
    ? bundleList.every((b) => b.ready)
    : vars.every((v) => v.status === "set");

  return {
    ready,
    project: null,
    global_home: globalHome(),
    bundles,
    ...(bundleFilter ? {} : { vars }),
  };
}
