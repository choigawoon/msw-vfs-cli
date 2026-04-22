# msw-vfs

Tooling for reading, analyzing, and editing **MapleStory Worlds** assets — `.map`, `.ui`, `.gamelogic`, `.model` — **without running the editor or an MCP server**. npm workspaces monorepo.

| Package | Purpose | Status |
|---|---|---|
| [`packages/cli`](packages/cli) — **`@choigawoon/msw-vfs-cli`** | Cross-platform CLI + HTTP daemon + stdin/stdout serve pipe. Two layers: path-based (L1) and entity-oriented (L2). Drop-in for the Python `msw_vfs.py` shipped with [`msw-map-ui-edit`](https://github.com/choigawoon/msw-ai-coding-plugins-official/tree/main/plugins/sample-msw-creator-skills/skills/msw-map-ui-edit). | Published to npm |
| [`packages/viewer`](packages/viewer) — **MSW VFS Viewer** | Tauri 2 desktop app (React + shadcn/ui). Entity-only hierarchy tree + Inspector with component cards; dedicated view for `.model` templates. | Browsable + inline edit |

## Status

Full port of the Python `msw_vfs.py` family (CLI, entry parsers for `.map`/`.ui`/`.gamelogic`/`.model`, YAML import/export, WorldBuilder) plus a new entity-oriented layer (`read-entity` / `list-entities` / `edit-component` / …) and a Tauri viewer that consumes it. **161 vitest tests** passing on the three benchmark games (1.Defence, 2.SimpleBossRush, 3.RaisingLegions). L1 output shape matches the Python CLI so the [msw-map-ui-edit](https://github.com/choigawoon/msw-ai-coding-plugins-official/tree/main/plugins/sample-msw-creator-skills/skills/msw-map-ui-edit) skill consumes it unchanged.

See [`COMMANDS.md`](COMMANDS.md) for the full command catalog and the L1/L2 mental model.

## Install

```bash
npm install -g @choigawoon/msw-vfs-cli
```

Requires Node.js 18+. No Python required.

## Usage

```bash
# Summary (works on every entry type)
msw-vfs path/to/map01.map summary

# Primary — entity-oriented (Layer 2, recommended for new callers)
msw-vfs path/to/map01.map list-entities /maps/map01
msw-vfs path/to/map01.map read-entity   /maps/map01/BG
msw-vfs path/to/map01.map find-entities Hero --by name
msw-vfs path/to/map01.map edit-entity   /maps/map01/BG --set enable=false
msw-vfs path/to/map01.map edit-component /maps/map01/BG MOD.Core.TransformComponent \
  --set Enable=false

# Entity CRUD
msw-vfs path/to/map01.map add-entity /maps/map01 MyEnemy \
  -c MOD.Core.TransformComponent -c MOD.Core.SpriteRendererComponent

# Advanced — VFS / file-level (Layer 1)
msw-vfs path/to/map01.map tree / -d 2
msw-vfs path/to/map01.map grep "BossRush" /

# .model — entity template
msw-vfs path/to/DefaultPlayer.model list
msw-vfs path/to/DefaultPlayer.model set speed 5.5

# YAML round-trip / declarative world
msw-vfs path/to/map01.map export-yaml -o map01.yaml
msw-vfs map01.yaml import-yaml -o map01.map
msw-vfs --type world world.yaml build-world -o ./out
```

Run `msw-vfs --help` for the full command list, or see [`COMMANDS.md`](COMMANDS.md) for the L1/L2 catalog.

## How it differs from the Python version

- **No Python runtime** — works on any machine with Node 18+.
- **Windows-safe** — no MS Store Python alias conflicts (exit 49 issue).
- **Faster cold start** — ~80 ms vs ~150 ms.
- **Same JSON output shape** — existing skill prompts continue to work unchanged.

## Development

```bash
git clone https://github.com/choigawoon/msw-vfs-cli.git
cd msw-vfs-cli
npm install

# CLI
npm run build:cli
npm test
node packages/cli/bin/cli.js --help

# Viewer — dev server (requires Rust toolchain + platform WebView deps)
npm run dev:viewer
```

### Release tags

- `cli-v0.3.0` (or legacy `v0.3.0`) → publishes `@choigawoon/msw-vfs-cli` to npm
- `viewer-v0.1.0` → builds platform installers, drafts a GitHub Release

## License

MIT. Third-party notices listed in each package's build output.
