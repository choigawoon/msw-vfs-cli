# Changelog

## Unreleased

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

### Not yet in 0.1.0

- YAML import/export + WorldBuilder (`build-world`).
- Model commands (`info`, `list`, `get`, `set`, `remove`, `validate`).
- Port of the 120-test pytest suite to vitest.
