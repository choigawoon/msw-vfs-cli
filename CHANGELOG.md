# Changelog

## CLI 0.5.1 — 2026-04-26

### `--ai` / `--client` flag — args-based identity tag

Client identity (used by the daemon recorder to decide whether to
persist a session) is now settable via flag instead of only the
`MSW_VFS_CLIENT` env var. The flag form is preferred because it is:

- explicit at the call site (visible in `ps`, shell history, daemon
  request logs),
- scoped to a single invocation, so it never leaks to grandchild
  processes the way an inherited env does,
- naturally serialized through the daemon `/rpc` and `serve` paths as
  part of argv.

`MSW_VFS_CLIENT` env is preserved as a fallback — older callers and the
viewer's existing wiring keep working unchanged. When both are present,
the flag wins.

```bash
msw-vfs --ai map01.map summary           # short form for the common case
msw-vfs --client ai map01.map summary    # general form
msw-vfs --client=viewer map01.map ls /   # = preferred
```

The flag is peeled at every entry boundary (bin launcher, async main,
sync runMain) so subcommand handlers never see it.

## CLI 0.5.0 · Viewer 0.3.0 — 2026-04-23

### Live AI-session visibility (P-AI0-1 through P-AI0-5)

CLI work initiated by AI is now observable from the viewer in real
time. The daemon is the single source of truth — both AI (via
subprocess) and the viewer (via the Tauri bridge) are peer clients
that auto-connect to it.

**CLI 0.5.0 (`@choigawoon/msw-vfs-cli`)**
- Every CLI invocation carries an `X-MSW-Client` identity tag
  (ai / viewer / cli) end-to-end. The viewer and bare-terminal use
  set this automatically; AI skill wrappers should set
  `MSW_VFS_CLIENT=ai` to opt into recording.
- New `SessionRecorder` — writes a JSONL event stream to
  `~/.msw-vfs/sessions/s_<ts>_<id>.jsonl` for each ai-initiated call.
  Header on first call, footer on daemon shutdown / idle timeout /
  manual stop. Viewer and cli calls are not persisted.
- New `GET /events` SSE endpoint — every /rpc hit plus
  session-start / session-stop lifecycle events are broadcast to
  subscribers. Permissive CORS so the viewer WebView can subscribe
  cross-origin.
- New `msw-vfs session status|list|stop` subcommands.
- Event fields cover cmd/args/file/status/exitCode/durationMs/mutation
  flag; stdout/stderr byte counts on recorded events.

**Viewer 0.3.0 (`@choigawoon/msw-vfs-viewer`)**
- Tauri bridge no longer bypasses the daemon — first call auto-spawns
  `msw-vfs daemon --detach` (once per viewer session) and all
  subsequent calls share its cache.
- New `ActivityPanel` — bottom-right toggleable panel subscribing to
  the daemon SSE stream. Color-coded client badges (ai / viewer /
  cli), mutation filter, clear/autoscroll, 500-entry ring buffer.
  Red `rec` indicator when the recorder has an active ai session.
- New Tauri command `vfs_daemon_meta` exposing host/port of the live
  daemon to the WebView.

Version pins: viewer 0.3.0 requires CLI ^0.5.0 (see
`REQUIRED_CLI_VERSION` in `packages/viewer/src/lib/vfs.ts`).

## Viewer 0.2.0 — 2026-04-23

### Workspace settings + `.msw-viewer.json` override (P3.5a-4)

Per-folder extension whitelists are now user-editable. Settings are
persisted as `.msw-viewer.json` at the workspace root so the rules
travel with the project (check it into git if you want them shared).

- New Tauri commands: `read_workspace_config`, `write_workspace_config`,
  `default_workspace_config`. Config schema: `{ folders: [{ path,
  extensions, recursive, role }...] }`, where `role` is one of
  `maps | uis | gamelogic | models | scripts | datasets`.
- `scan_workspace` honors `.msw-viewer.json` automatically. Defaults
  are exposed via the `default_workspace_config` command so the UI has
  a single source of truth with the Rust layer.
- `WorkspaceManifest.config_overridden` tells the UI when an override
  is in effect; a warning banner renders `Using folder overrides from
  .msw-viewer.json`.
- New `SettingsDialog` component: form UI over the typed config, one
  row per folder rule with path / extensions / recursive / role.
  `Add folder`, `Reset to defaults`, `Save`. The viewer re-scans on
  save so the sidebar reflects the new rules immediately.
- Settings gear in the topbar appears only when a workspace is open.

### Viewer completes P3.5a

With this release the workspace flow is feature-complete for the P3.5a
plan: open a folder (a-1), auto-refresh on fs change (a-2), preview
`.mlua` + render `.csv` grid (a-3), and override scan rules (a-4).
P4 (2D PixiJS preview) and P5 (Tauri sidecar bundling) remain.

## Viewer 0.1.2 — 2026-04-23

### `.mlua` preview + `.csv` grid (P3.5a-3)

Workspace sidebar entries for scripts and datasets are now clickable.

- Rust `read_text_file(path, max_bytes?)` command — UTF-8 lossy read
  capped at 1 MiB by default, returns `{ text, size, truncated }`.
- `.mlua` → new ScriptPreview component: monospace line-numbered read-only
  view with a banner pointing at the `mlua-lsp` skill for editing. No
  syntax highlighting by design — viewer is for structural context,
  editor is for editing.
- `.csv` → new DatasetPreview component: CSV grid with the first row as
  header, up to 2000 rows rendered before truncation notice. Parser
  handles standard CSV (quoted fields, escaped quotes, CRLF/LF) —
  simple split is not good enough for MSW DataSets.
- WorkspacePane: scripts/datasets are no longer disabled; the click
  opens the matching preview.
- `FileState` split: `asset` (CLI summary route, entity tree / ModelView)
  vs `text` (script / dataset preview). Topbar subtitle reflects the
  role (`mlua · preview`, `csv · preview`).

## Viewer 0.1.1 — 2026-04-23

### Workspace filesystem watcher (P3.5a-2)

- `notify` + `notify-debouncer-full` watch the workspace root recursively
  with 300ms debounce.
- Rust commands `start_workspace_watch(root)` and `stop_workspace_watch`
  manage lifecycle; opening a new workspace automatically drops the
  previous watcher.
- A single `workspace:changed` Tauri event fires per debounced burst
  with the root + list of changed absolute paths.
- React auto-re-scans the manifest on every event so the sidebar
  reflects adds/removes/renames without a manual refresh.
- When the currently open file appears in the change set, the viewer
  surfaces an "외부에서 수정됨 — Reload?" toast. Manual Reload calls the
  normal file-open path; Dismiss keeps the in-memory view.
- IDE swap/backup noise is filtered at the Rust layer (same skip rules
  as the initial scan, plus `.swp`/`.swo` + `~` trailing tildes).

## Viewer 0.1.0 — 2026-04-23

### Workspace mode (P3.5a-1)

Viewer can now open a full MSW project folder, not just a single file.

- New `Open Workspace…` button + `scan_workspace` Tauri command backed
  by `walkdir` — returns a manifest of asset files grouped by role
  (`maps` · `uis` · `gamelogic` · `models` · `scripts` · `datasets`).
- Root detection: `Environment/NativeScripts/` or `Environment/config`
  → `valid`; only `map/` `ui/` `Global/` → `partial` (opens with a
  warning); folder named `MyDesk`/`scripts` with `.mlua`/`.model` →
  `scripts-only`. Anything else is rejected with guidance.
- Hardcoded per-folder extension whitelist for P3.5a-1 (`map/→.map`,
  `ui/→.ui`, `Global/→.gamelogic .model`, `RootDesk/MyDesk/**→.mlua
  .model .csv`). Settings UI + `.msw-viewer.json` override lands in
  P3.5a-4.
- Collapsible workspace sidebar (default **collapsed**, persisted in
  localStorage; auto-expands when a workspace opens). Groups collapse
  individually, counts shown inline.
- File click loads through the existing single-file flow
  (TreePane+Inspector for entity-tree types; ModelView for `.model`).
- Scripts (`.mlua`) and datasets (`.csv`) appear in the sidebar for
  orientation but are not yet openable — that lands in P3.5a-3.
- No fs watcher yet (P3.5a-2) and no settings UI (P3.5a-4).
- Global/ writability whitelist (6 files) surfaced via `readonly` flag
  on each `FileEntry` — the sidebar shows a lock icon; actual write
  enforcement still happens in the CLI layer.

## 0.4.2 — 2026-04-23

### Enforce entry-type boundaries on .model

Tree-shaped commands (`ls`, `tree`, `read`, `glob`, `grep`, `stat`,
`edit`, plus every L2 entity op) now **hard-reject** on `.model` files
with a pointer to the correct native subcommand. A `.model` is a flat
template (metadata + `Values[]` rows), not an entity tree, and the
silent `ls → list` alias that previously hid this mismatch has been
removed.

Rationale: callers (agents especially) shouldn't silently carry an
entity-tree mental model over to `.model`. Future non-tree entry types
(DataSet CSV, etc.) will follow the same rule — each type exposes its
own surface, and tree commands are rejected with guidance.

USAGE in `--help` is re-headed to spell out the scope per section:

```
Primary — entity-oriented, entity-tree entries only (map/ui/gamelogic)
Advanced — VFS / file-level, entity-tree entries only (map/ui/gamelogic)
Model commands — flat template, no tree (.model)
```

**Breaking**: any script that relied on `msw-vfs <file>.model ls` to
print the Values table must switch to `msw-vfs <file>.model list`.

## 0.4.1 — 2026-04-23

### `ls -l` gains a flag column

Makes entity directories legible at a glance, Unix-perms style. Each
entity dir gets a 5-char flag string before the name:

```
DIMSC  <entity>/                          [N comp, M child]
```

| Flag | Meaning |
|---|---|
| `D` | disabled (`enable=false`) |
| `I` | invisible (`visible=false`) |
| `M` | has `modelId` (instance of a .model template) |
| `S` | has at least one `script.*` component |
| `C` | has child entities |

Dash (`-`) means the flag is not set. Passthrough dirs (`/maps`, `/ui`)
and files render a blank flag column so named entities dominate the eye.

`--json` output gains matching optional fields on `LsItem`: `enable`,
`visible`, `has_model_id`, `has_script` (populated only in detail
mode). Existing fields unchanged — additive.

## 0.4.0 — 2026-04-23

### Layer 2: entity-oriented CLI + viewer switch

Adds a GameObject-style API on top of the existing path-based VFS, so
creators (via the viewer) and LLM callers (via the CLI) can work in
entity units without threading through filesystem paths.

**New CLI commands** (additive; L1 commands unchanged):

- `read-entity <path> [--deep] [--compact]` — bundle one entity's
  metadata + all components in a single JSON response. Replaces the
  N× `read` calls previously required to inspect one entity fully.
- `list-entities [path] [-r|--recursive] [--json]` — child entities
  only, transparently descending through pass-through dirs (`/maps/`,
  `/ui/`) until it reaches the first entity layer.
- `find-entities <pattern> [--by name|component|modelId] [--path START]`
  — search entities with a case-insensitive regex against the chosen
  field.
- `grep-entities <pattern> [path]` — grep component values, grouped
  by owning entity.
- `edit-component <entity> <@type> --set k=v` — edit a component by
  `(entity, @type)` tuple instead of reconstructing a component file
  path. Errors explicitly on 0 / >1 matches.
- `.model summary` — common-shape summary the viewer expects for every
  entry (asset_type, name, model_id, base_model_id, values_count).
- `.model list --json` — machine-readable `ModelListItem[]`.

**USAGE / docs** — `msw-vfs --help` now splits into `Primary —
entity-oriented` and `Advanced — VFS / file-level` sections. New
`COMMANDS.md` at repo root is the reverse-engineered catalog with the
two-layer mental model.

### Internal refactor — "EntryParser"

- `EntryParser` interface introduced (`src/entry/parser.ts`): common
  contract (`type` / `filePath` / `isDirty` / `validate` / `save`) every
  entry-file handler satisfies.
- Renamed classes to match: `EntitiesVFS` → `EntitiesEntryParser`,
  `MapVFS` / `UIVFS` / `GameLogicVFS` → `*EntryParser`, `ModelVFS` →
  `ModelEntryParser`.
- Moved `src/vfs/*` → `src/entry/*` and `src/model/vfs.ts` →
  `src/entry/model.ts` (`src/model/{types,codec}.ts` stay in place as
  model-internal helpers).
- New `EntityModel` façade (`src/entity/model.ts`) wrapping
  `EntitiesEntryParser` — exposes only the L2 surface for callers
  (viewer, LLM) that want GameObject units.
- CLI handlers split by layer: `src/cli/util.ts` (argv), `vfs-handlers.ts`
  (L1), `entity-handlers.ts` (L2), `model-handlers.ts` (.model). `cli.ts`
  is a ~360-line dispatcher (was 822 LOC).

### Viewer — entity-oriented layout + ModelView

- Tree now shows **only entities**, not component files or
  `_entity.json`. Chevrons hidden on leaves; row tag `Nc Me` = component
  count + child entity count.
- Inspector fetches one bundle via `read-entity` per selection and
  renders an **Entity card** (metadata: enable / visible / name /
  modelId / displayOrder inline-editable) plus one **collapsible card
  per component** (scalar fields inline). Writes route through
  `edit-entity` or `edit-component`.
- New Tauri commands: `vfs_list_entities`, `vfs_read_entity`,
  `vfs_edit_entity`, `vfs_edit_component`, `vfs_model_values`.
- `.model` files open in a dedicated **ModelView** (single pane) —
  template metadata + `Values[]` table. Read-only for now; editing
  lands in a follow-up.

### Tests

161 vitest cases (was 112) — new suites: `entity-l2.test.ts` (39
cases × 3 benchmark games), `entity-model.test.ts` (façade delegation).

## 0.3.0 — 2026-04-22

### Monorepo split; remove `web` subcommand (breaking)

- **Breaking:** `msw-vfs <file> web` removed. The browser viewer is now a
  standalone Tauri 2 desktop app scaffolded in `packages/viewer/`. Use
  `msw-vfs daemon` or `msw-vfs serve` for programmatic access.
- Repo switched to **npm workspaces**. CLI moved to `packages/cli/`
  (package name unchanged: `@choigawoon/msw-vfs-cli`).
- Release tags: `cli-v*` (legacy `v*` also accepted) publish the CLI to npm;
  `viewer-v*` builds cross-platform installers for the viewer.

### 0.1.0 — Initial port: read operations

- Scaffold: package.json, tsconfig, bin launcher, CLI stub.
- Port `vfs_common.py` → `src/vfs/common.ts` (VFSNode, deepMerge).
- Port `entities_core.py` read operations → `src/vfs/entities.ts`:
  `ls`, `read`, `tree` (data + text), `glob`/`search`, `grep`, `stat`, `summary`,
  plus compact helpers (`_DEFAULT_STRIP`, large-array stats, foothold stats).
- Port `map_vfs.py` / `ui_vfs.py` / `gamelogic_vfs.py` thin subclasses.
- Port CLI dispatcher with argparse-compatible argument shapes:
  `--type`, `-l`, `-d/--depth`, `--raw`, `--offset`, `--limit`,
  `--max-results`, `--head-limit`, `--output-mode`. Output format matches
  the Python msw_vfs.py so existing skill prompts keep working.
- Smoke-tested against benchmark-games/2.SimpleBossRush `.map` + `.ui`.

### 0.1.0 — Web viewer subcommand (removed in 0.3.0)

- Port `map_vfs_web.py` (585 LOC) → `msw-vfs <file> web [--port N]`. HTML/
  CSS/JS template (~480 lines) reused verbatim from the Python source;
  only the HTTP layer was reimplemented against Node stdlib `http`
  (no Express dep).
- `src/web/template.html` — raw template, copied into `dist/web/` by the
  new `scripts/copy-web-assets.js` postbuild step.
- `src/web/server.ts` — 7 REST endpoints
  (`/api/{summary,tree,ls,read,stat,search,grep}`) mapped 1:1 onto
  EntitiesVFS methods. `summary` is augmented with a `listTopLevelEntities`
  array so the client's entity-card rendering works.
- `scripts/smoke-web.js` in-process harness — 11 checks green.
- CLI: `web` registered in ENTITIES_HANDLERS (map/ui/gamelogic all
  serve through it). `--host` + `--port` flags.

### 0.1.0 — Vitest suite

- `test/fixtures/` copy of pytest benchmarks (defence / boss_rush /
  raising_legions) — 4 asset types × 3 games (+ 4 UI variants).
- `test/helpers.ts` with `copyFixture(game, filename)` to a fresh tmpdir.
- 4 test files (map/ui/model/cli) × parametrized by game = **112 tests
  passing** (~8s total on Windows). Coverage parity with the Python
  pytest suite except for 2 dropped tests that invoked the legacy
  `python map_vfs.py` / `python model_vfs.py` entry points (obsolete
  after this port).

### 0.1.0 — YAML import/export + WorldBuilder

- Port YAML import: `EntitiesVFS.fromYamlFile(path)` static factory + private
  `loadYaml` + `resolveInclude` ($include resolution across entities/data/
  resources subdirs).
- Port YAML export: `EntitiesVFS.exportYaml({dataDir})` — heavy entities
  split into separate yaml files under `dataDir` when that option is given.
- Port `world_builder.py` → `src/world/builder.ts`: `WorldBuilder` with
  `applyValues(valuesFiles)` (deep-merge overrides) and
  `build(outputDir)` that emits `.map` / `.ui` / `common.gamelogic` files.
- CLI: `export-yaml`, `import-yaml`, `build-world` (with `--type world`).
- Verified on `msw-map-ui-edit/docs/samples/world.yaml` — produces 1 map
  (350 entities) + 7 UI files + 1 gamelogic; all validate clean.

### 0.1.0 — ModelVFS

- Port `model_types.py` → `src/model/types.ts`: MSCORLIB + MOD.Core assembly
  fullname assembly, `TYPE_HANDLERS` for 10 type_keys, `VALUE_TYPE_SHORT`,
  `buildValueType`, `extractTypeKey`.
- Port `model_codec.py` → `src/model/codec.ts`: `inferType`, `encodeValue`,
  `decodeValue`. CLI `set` disambiguates Python-style int-vs-float at the
  string level (`5` → int32, `5.0` → single) when `--type` not passed.
- Port `model_core.py` → `src/model/vfs.ts`: `ModelVFS` class — `info`,
  `listValues`, `get`, `getRaw`, `set`, `remove`, `addComponent`,
  `removeComponent`, `validate`, `save`.
- CLI: `info / list / get / set / remove / validate` for `.model` files.
- `scripts/smoke-model.js` — round-trip across single/vector2/boolean/
  dataref + addComponent/removeComponent. Passes on all three benchmark
  DefaultPlayer.model fixtures.

### 0.1.0 — Mutation operations

- Port `edit`, `save`, `addEntity`, `removeEntity` (+ reindex), `editEntity`,
  `renameEntity`, `addComponent`, `removeComponent`, `validate`.
- CLI handlers for all eight mutation subcommands. `--set key=value` accepts
  JSON values (falls back to raw string). `--output/-o` to write elsewhere.
- `scripts/smoke-mutations.js`: round-trip test (add → edit → rename →
  add-component → edit component → remove-component → remove-entity →
  reload each step and verify state) — passes on all three benchmark games
  (1.Defence / 2.SimpleBossRush / 3.RaisingLegions).

