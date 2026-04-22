# Roadmap

Forward plan for `@choigawoon/msw-vfs-cli` + `@choigawoon/msw-vfs-viewer` +
the `test-msw-vfs-cli` skill. Kept terse and decision-oriented so we can
pick up mid-phase without re-aligning.

Last updated: 2026-04-23.

---

## Where we are

**Shipped**

| Component | Version | What it covers |
|---|---|---|
| `@choigawoon/msw-vfs-cli` | **0.4.2** | L1 (ls/tree/read/grep/glob/stat/edit/summary/validate), L2 entity (read-entity/list-entities/find-entities/grep-entities/edit-entity/edit-component + CRUD), `.model` flat surface (info/list/get/set/remove/validate), YAML + build-world, daemon/serve/stop. `ls -l` has a DIMSC flag column. `.model` hard-rejects tree commands with a redirect pointer. |
| `@choigawoon/msw-vfs-viewer` | **0.2.0** | Single-file open AND workspace open. Entity tree + Inspector for `.map`/`.ui`/`.gamelogic`; ModelView for `.model`; `.mlua` preview; `.csv` grid. `notify`-based fs watcher + reload toast. `.msw-viewer.json` overrides for per-folder scan rules. CLI version probe in topbar. |
| `test-msw-vfs-cli` skill | pinned to CLI **0.4.2** | Per-entry command matrix documented in `docs/vfs-commands.md`. `msw-blob-vfs-reader` agent uses `ls -l` DIMSC as the initial scan pattern. |

**Version-pin mirror** — these four sites must agree on one CLI version:
- `packages/cli/package.json` (`version`)
- `packages/viewer/src/lib/vfs.ts` (`REQUIRED_CLI_VERSION`)
- skill `scripts/msw-vfs.js` + `scripts/msw-vfs-batch.js` (`PKG` constant)
- skill `SKILL.md` front-matter + body prose
Viewer's `isCliVersionCompatible` accepts patch drift within a minor.

---

## Immediate next — P3: safety rails + `.model` editing

Picked up from the original viewer roadmap, still the top unfinished item.

### P3-a Undo / revert (viewer)

**Problem**: edits via `edit-entity` / `edit-component` / model `set` are
in-place and destructive. One wrong Enter wipes creator work.

**Scope**:
- In-memory undo stack per open file, bounded (50 edits). Each entry stores
  `{ path, kind, patch, inverse_patch }`.
- `Cmd/Ctrl+Z` triggers the inverse (re-invokes the CLI with the reverse
  patch). Multi-step undo = repeated `Cmd+Z`.
- "Revert file" button in Inspector/ModelView header: re-reads the file
  from disk via CLI `summary`/`read-entity`, discards in-memory state.
- No redo in this phase. Keep it simple.

**Non-goals**: persistent undo across sessions, git integration.

**Depends on**: nothing new in CLI. Inverse patch is computed from the
`read-entity` / model `get` response captured right before the edit.

### P3-b Confirm-before-save for sensitive fields

Surface a one-tap confirm for edits that tend to wreck the game if wrong:
- `modelId` change on an entity (render break)
- `enable=false` on `GameManager`-tagged entities (S flag in DIMSC)
- Global/ writes (already flagged readonly; relax with confirm)

**Scope**: `<Confirm>` dialog triggered by a small allow-list in the
Inspector. Free of timers — explicit click only.

### P3-c `.model` editing widgets

**Problem**: `.model` values render via `ModelView` as read-only.
Types have distinct shapes (single / int32 / vector2 / vector3 / color /
quaternion / dataref / boolean / string) that deserve type-aware inputs,
not raw JSON text.

**Scope** — one widget per type:
| Type | Widget |
|---|---|
| `single` / `int32` / `int64` | `<input type="number">` with step appropriate for type |
| `boolean` | toggle |
| `string` | `<input>` |
| `vector2` / `vector3` | paired/triple numeric inputs |
| `color` | hex+RGBA picker |
| `quaternion` | 4 numeric inputs (advanced, collapsed by default) |
| `dataref` | text box + "browse assets in workspace" button (P3.5b tie-in) |

Each widget dispatches `msw-vfs <file> set <name> <json> --type <T>`
through the Tauri bridge.

**Depends on**: CLI `set` is already stable (0.4.0+). No CLI bump needed
for P3-c; purely viewer.

**Viewer version target**: 0.3.0 on P3 completion.

---

## Next — P4: PixiJS 2D map preview

Render `.map` entities as sprites on a canvas; click-to-select syncs with
the left tree.

**Scope**:
- New `MapCanvas` tab in Inspector, selectable via tab strip at top of
  right pane (tabs: `Inspector` | `Canvas`).
- For each entity with `TransformComponent.Position`:
  - If `SpriteRendererComponent.dataId` resolves to a loadable RUID, draw
    the sprite. If not resolvable, draw a labeled placeholder box.
  - Respect `enable=false` / `visible=false` by dimming.
  - Foothold layer drawn as colored polylines (green/red per layer).
- Pan (drag) + zoom (wheel). `F` to fit to content. Origin crosshair.
- Click on sprite → select the matching entity in TreePane.
- Off-canvas entities listed in a collapsible "off-screen" strip.

**Open design questions (decide at phase start)**:
- Sprite resolution: how to map RUID → image. Options: (a) local cache of
  previously-exported atlas files, (b) stub with placeholder always, (c)
  defer to MSW Maker MCP when available.
- Coordinate scale: 1 world unit ≈ 200 px per existing convention
  (recorded in profile under struggles).
- RectTile rendering: use `TileMapComponent.tileMap` + tileset refs, or
  render only entities for this phase.

**Dependencies**: PixiJS already listed in the plan, not yet imported.
Add to `packages/viewer/package.json` at phase start.

**Viewer version target**: 0.4.0.

---

## Next — P5: Tauri sidecar bundling

Ship the viewer as a self-contained `.app` / `.msi` with its own Node +
CLI binary. Currently the viewer resolves the CLI via env var / dev path
/ `msw-vfs` on PATH — fine for dev, not for end users.

**Scope**:
- Tauri sidecar spec: bundle `node` + `dist/cli.js` under the app
  resources. Update `resolve_cli()` in `lib.rs` to look there first.
- Build matrix (release-viewer.yml): already handles macOS universal +
  Windows x64. Verify CLI picks up bundled node.
- **No code signing** (per repo memory — explicitly deferred). First users
  will get "unidentified developer" warnings.

**Viewer version target**: 0.5.0 or 1.0.0 (phase-end — first shippable
self-contained build).

**Depends on**: P3 + P4 done enough that packaging is worth it.

---

## QoL — P3.5b (deferred until P3/P4 land)

- **Cmd+P / Ctrl+P** — across-workspace file search. Fuzzy match against
  all `WorkspaceFileEntry.rel_path`. Opens on select.
- **Recent workspaces** — last 5 roots in a dropdown on the
  `Open Workspace…` button; click to re-open. Persist in localStorage.
- **Theme toggle** — dark / light / system, persisted in localStorage.
  Tailwind supports it; main work is wiring the toggle + storage.
- **File tree search inside sidebar** — filter input above groups, matches
  file name across all groups as you type.
- **Conflict resolution on external edit** — if the Reload toast fires
  while the user has unsaved edits, offer a diff view instead of a flat
  "Reload / Dismiss". Currently dismisses silently overwrite concerns.

---

## CLI backlog (smaller, can be done any time)

- `msw-vfs validate --strict` — promote warnings to errors (CI use).
- `msw-vfs diff <a> <b>` — structural diff two entity-tree files of the
  same asset type; useful for code review of generated assets.
- `find-entities` currently supports `--by name|component|modelId`; add
  `--by id` (exact GUID match) once a real use case surfaces.
- `.model`: `inherit` view — show which values come from `baseModel` vs
  locally overridden (feeds an `O` flag in a hypothetical `.model list -l`
  if we ever give .model a flag column; not blocked on, just noted).

---

## Skill backlog

- Document `.msw-viewer.json` config shape in `docs/vfs-commands.md` once
  creators start needing workspace-aware layouts.
- Add an `editing-protocol.md` doc analogous to mlua-lsp's
  "자동 점검 프로토콜": after any `edit-*` / `add-*` / `remove-*` batch,
  agent must run `validate` on the affected file before turn end.
- `msw-blob-vfs-reader`: teach the agent the `.model` hard-reject so it
  doesn't try `ls` on `.model` and then scratch its head at the error.
  (Minor — the agent will adapt, but explicit instruction helps first-run
  sessions.)

---

## Out of scope (explicitly — don't pull these in without re-discussion)

- Linux viewer builds. Memory says macOS + Windows only.
- Code signing. Deferred.
- Real-time collaboration / cloud sync.
- Full game preview (physics, runtime). This is a *viewer*, not Maker.
- Editing `.mlua` in the viewer — mlua-lsp skill / external editor owns
  that. Viewer stays a preview.
- Editing `.csv` in the viewer — `msw-csv-edit` skill owns that.

---

## Decision log — things already agreed, don't re-open

- **Entry-type boundary is hard, not silent.** `.model` rejects tree
  commands with a redirect message; future non-tree entries follow the
  same rule. No alias convenience layers.
- **Per-folder extension whitelist + override via `.msw-viewer.json`.**
  Not hardcoded, not env-driven, not global — lives with the project.
- **Watcher debounce 300ms.** Not tunable yet; revisit only if creators
  complain.
- **Sidebar default collapsed, persisted.** Auto-expand on first workspace
  open, then respect user toggle thereafter.
- **CLI ^0.4 = minor-compatible.** Patch bumps (0.4.x) do not require a
  viewer REQUIRED_CLI_VERSION bump; minor bumps (0.5.x) do.
- **Viewer is macOS + Windows only.** No Linux builds planned.
- **No code signing yet.** Users will see unsigned warnings; that's
  acceptable for the current audience (internal company tool).
- **Partial + scripts-only workspace roots are allowed** with a warning
  banner — not rejected.
