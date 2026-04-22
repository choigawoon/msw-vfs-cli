# Changelog

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

