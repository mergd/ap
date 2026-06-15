import type { DeriveKind, Visibility } from "../types.ts";

export interface CatalogVar {
  visibility: Visibility;
  ask?: string;
  docs?: string;
  derive?: DeriveKind;
}

export interface CatalogBundle {
  ask?: string;
  docs?: string;
  /** Agent instructions when the bundle is ready (auth shape, which vars, etc.) */
  prompt?: string;
  /** Example ap run invocation for agents */
  run_example?: string;
  vars: Record<string, CatalogVar>;
}
