export type Visibility = "public" | "secret" | "derived";
export type Scope = "global" | "project";
export type Storage = "global" | "project" | "inline" | "derived";
export type VarStatus = "set" | "missing";

export type DeriveKind = "public-ipv4";

export interface VarDefinition {
  key: string;
  visibility: Visibility;
  scope?: Scope;
  value?: string;
  ask?: string;
  docs?: string;
  derive?: DeriveKind;
}

export interface BundleDefinition {
  name: string;
  vars: string[];
  ask?: string;
  docs?: string;
}

export interface Manifest {
  version: number;
  vars: Map<string, VarDefinition>;
  bundles: Map<string, BundleDefinition>;
  /** Project manifest: which bundles this repo uses */
  activeBundles?: string[];
}

export interface ResolvedVar {
  key: string;
  scope: Scope;
  storage: Storage;
  visibility: Visibility;
  status: VarStatus;
  value?: string;
  ask?: string;
  docs?: string;
  masked?: boolean;
  set_with?: string;
}

export interface BundleMissingVar {
  key: string;
  ask?: string;
  set_with: string;
}

export interface BundleSurfacedVar {
  key: string;
  value: string;
}

export interface ResolvedBundle {
  name: string;
  ready: boolean;
  ask?: string;
  docs?: string;
  /** Public + derived values surfaced in full for agents */
  surfaced: BundleSurfacedVar[];
  missing: BundleMissingVar[];
  secrets_set: string[];
}

export interface DoctorResult {
  ready: boolean;
  project: string | null;
  global_home: string;
  bundles: Record<string, ResolvedBundle>;
  /** Flat var list; omitted when filtering by --bundle */
  vars?: ResolvedVar[];
}

export interface ResolveContext {
  projectRoot: string | null;
  globalManifest: Manifest | null;
  projectManifest: Manifest | null;
  globalSecrets: Record<string, string>;
  projectSecrets: Record<string, string>;
}

export interface ResolveOptions {
  globalOnly?: boolean;
  includeSecrets?: boolean;
  forRun?: boolean;
  surfacePublic?: boolean;
  bundleFilter?: string;
}

export interface VaultStore {
  read(): Promise<Record<string, string>>;
  write(secrets: Record<string, string>): Promise<void>;
  unset(key: string): Promise<boolean>;
  set(key: string, value: string): Promise<void>;
}
