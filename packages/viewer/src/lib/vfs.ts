import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Minimum `@choigawoon/msw-vfs-cli` version the viewer calls against.
 * Bumped whenever the viewer starts relying on a new CLI subcommand or
 * output shape. Kept in sync with the pin in the msw-vfs agent skill.
 */
export const REQUIRED_CLI_VERSION = "0.4.0";

export function isCliVersionCompatible(actual: string): boolean {
  const [aMaj, aMin] = actual.split(".").map((n) => parseInt(n, 10));
  const [rMaj, rMin] = REQUIRED_CLI_VERSION.split(".").map((n) =>
    parseInt(n, 10),
  );
  if (!Number.isFinite(aMaj) || !Number.isFinite(aMin)) return false;
  if (aMaj !== rMaj) return false;
  return aMin >= rMin;
}

export async function vfsCliVersion(): Promise<string> {
  return invoke<string>("vfs_cli_version");
}

export interface DaemonMeta {
  host: string;
  port: number;
  version: string;
}

/** Returns host/port of the live daemon. Auto-starts one if needed. */
export async function vfsDaemonMeta(): Promise<DaemonMeta> {
  return invoke<DaemonMeta>("vfs_daemon_meta");
}

// ── Workspace (P3.5a-1) ──────────────────────────

export type WorkspaceStatus = "valid" | "partial" | "scriptsonly" | "invalid";

export interface WorkspaceFileEntry {
  abs_path: string;
  rel_path: string;
  name: string;
  size: number;
  readonly: boolean;
  in_global: boolean;
  in_mydesk: boolean;
}

export interface WorkspaceGroups {
  maps: WorkspaceFileEntry[];
  uis: WorkspaceFileEntry[];
  gamelogic: WorkspaceFileEntry[];
  models: WorkspaceFileEntry[];
  scripts: WorkspaceFileEntry[];
  datasets: WorkspaceFileEntry[];
}

export interface WorkspaceManifest {
  root: string;
  status: WorkspaceStatus;
  warnings: string[];
  groups: WorkspaceGroups;
  /** True if `.msw-viewer.json` was found and applied. */
  config_overridden: boolean;
}

export type GroupRole =
  | "maps"
  | "uis"
  | "gamelogic"
  | "models"
  | "scripts"
  | "datasets";

export interface ConfigFolder {
  path: string;
  extensions: string[];
  recursive: boolean;
  role: GroupRole;
}

export interface WorkspaceConfig {
  folders: ConfigFolder[];
}

export async function readWorkspaceConfig(
  root: string,
): Promise<{ config: WorkspaceConfig; from_file: boolean }> {
  return invoke<{ config: WorkspaceConfig; from_file: boolean }>(
    "read_workspace_config",
    { root },
  );
}

export async function writeWorkspaceConfig(
  root: string,
  config: WorkspaceConfig,
): Promise<void> {
  return invoke<void>("write_workspace_config", { root, config });
}

export async function defaultWorkspaceConfig(): Promise<WorkspaceConfig> {
  return invoke<WorkspaceConfig>("default_workspace_config");
}

export async function scanWorkspace(root: string): Promise<WorkspaceManifest> {
  return invoke<WorkspaceManifest>("scan_workspace", { root });
}

export async function startWorkspaceWatch(root: string): Promise<void> {
  return invoke<void>("start_workspace_watch", { root });
}

export async function stopWorkspaceWatch(): Promise<void> {
  return invoke<void>("stop_workspace_watch");
}

export interface WorkspaceChangePayload {
  root: string;
  paths: string[];
}

export function onWorkspaceChanged(
  handler: (p: WorkspaceChangePayload) => void,
): Promise<UnlistenFn> {
  return listen<WorkspaceChangePayload>("workspace:changed", (ev) =>
    handler(ev.payload),
  );
}

export interface TextFilePayload {
  text: string;
  /** Size on disk in bytes (before truncation). */
  size: number;
  /** True if the file exceeded maxBytes and only the head was returned. */
  truncated: boolean;
}

export async function readTextFile(
  path: string,
  maxBytes?: number,
): Promise<TextFilePayload> {
  return invoke<TextFilePayload>("read_text_file", { path, maxBytes });
}

/** File kinds the viewer can open in P3.5a-1. Scripts/datasets are
 * surfaced in the sidebar for orientation but not yet openable here —
 * that lands in P3.5a-3. */
export type OpenableKind = "map" | "ui" | "gamelogic" | "model";

export function fileKindFromName(name: string): OpenableKind | "script" | "dataset" | null {
  const low = name.toLowerCase();
  if (low.endsWith(".map")) return "map";
  if (low.endsWith(".ui")) return "ui";
  if (low.endsWith(".gamelogic")) return "gamelogic";
  if (low.endsWith(".model")) return "model";
  if (low.endsWith(".mlua")) return "script";
  if (low.endsWith(".csv")) return "dataset";
  return null;
}

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
  // Populated in detail mode — see CLI `ls -l` output.
  components?: string[];
  children_count?: number;
  entity?: boolean;
  enable?: boolean;
  visible?: boolean;
  has_model_id?: boolean;
  has_script?: boolean;
}

export interface EditResponse {
  action: unknown;
  save: { ok?: boolean; path?: string; warnings?: string[]; skipped?: boolean };
}

export interface EntityDescriptor {
  path: string;
  name: string;
  components: string[];
  children_count: number;
  modelId?: string;
}

export interface EntityListing {
  path: string;
  entities: EntityDescriptor[];
}

export interface EntityBundle {
  path: string;
  name: string;
  metadata: Record<string, unknown>;
  components: Record<string, Record<string, unknown>>;
  children?: Array<{ path: string; name: string } | EntityBundle>;
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

export async function vfsListEntities(
  path: string,
  subpath = "/",
  recursive = false,
): Promise<EntityListing> {
  return invoke<EntityListing>("vfs_list_entities", {
    path,
    subpath,
    recursive,
  });
}

export async function vfsReadEntity(
  path: string,
  subpath: string,
  deep = false,
): Promise<EntityBundle> {
  return invoke<EntityBundle>("vfs_read_entity", { path, subpath, deep });
}

export async function vfsEditEntity(
  path: string,
  entityPath: string,
  patch: Record<string, unknown>,
): Promise<EditResponse> {
  return invoke<EditResponse>("vfs_edit_entity", {
    path,
    entityPath,
    patch,
  });
}

export async function vfsEditComponent(
  path: string,
  entityPath: string,
  typeName: string,
  patch: Record<string, unknown>,
): Promise<EditResponse> {
  return invoke<EditResponse>("vfs_edit_component", {
    path,
    entityPath,
    typeName,
    patch,
  });
}

// ── .model template ──────────────────────────────

export interface ModelListItem {
  name: string;
  target_type: string | null;
  type: string;
  type_key: string;
  value: unknown;
}

export async function vfsModelValues(path: string): Promise<ModelListItem[]> {
  return invoke<ModelListItem[]>("vfs_model_values", { path });
}
