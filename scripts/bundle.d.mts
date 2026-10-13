// Types for scripts/bundle.mjs, for the test that imports it.
export interface BundleManifest {
  name: string;
  version: string;
  title: string;
  tagline: string;
  publisher: string;
  sequence: number;
  files: { path: string; size: number; sha256: string }[];
  sources?: string[];
  [key: string]: unknown;
}
export const PUBLISHER: string;
export const REPO: string;
export const BUNDLE: string;
export const SOURCE: string;
export function readManifest(bytes: Uint8Array): { manifest: BundleManifest; digest: string };
export function digestOf(manifest: object): string;
export const ICON: string;
export function filesOf(page: Uint8Array, icon?: Uint8Array): { path: string; size: number; sha256: string }[];
export function expected(source: object, page: Uint8Array, sequence: number, publisher?: string, icon?: Uint8Array): BundleManifest;
export function problems(manifest: BundleManifest, source: object, page: Uint8Array, publisher?: string, icon?: Uint8Array): string[];
export function listing(manifest: BundleManifest, digest: string, commit: string): Record<string, unknown>;
