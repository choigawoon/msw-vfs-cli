import { invoke } from "@tauri-apps/api/core";

export interface MapSummary {
  file: string;
  asset_type: string;
  entry_key?: string;
  core_version?: string;
  entity_count: number;
  component_counts: Record<string, number>;
  scripts?: string[];
  tile_map_mode?: string;
  tile_map_mode_raw?: number;
  ui_group_type?: string;
  buttons?: number;
  texts?: number;
  sprites?: number;
  [k: string]: unknown;
}

export interface LsItem {
  name: string;
  type: "dir" | "file";
  entity?: unknown;
  components?: string[];
  children_count?: number;
}

export interface EditResponse {
  action: unknown;
  save: { ok?: boolean; path?: string; warnings?: string[]; skipped?: boolean };
}

export async function vfsSummary(path: string): Promise<MapSummary> {
  return invoke<MapSummary>("vfs_summary", { path });
}

export async function vfsTree(path: string, depth?: number): Promise<string> {
  return invoke<string>("vfs_tree", { path, depth });
}

export async function vfsLs(path: string, subpath = "/"): Promise<LsItem[]> {
  return invoke<LsItem[]>("vfs_ls", { path, subpath });
}

export async function vfsRead(
  path: string,
  subpath: string,
): Promise<unknown> {
  return invoke<unknown>("vfs_read", { path, subpath });
}

export async function vfsEdit(
  path: string,
  subpath: string,
  patch: Record<string, unknown>,
): Promise<EditResponse> {
  return invoke<EditResponse>("vfs_edit", { path, subpath, patch });
}
