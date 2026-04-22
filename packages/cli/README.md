# @choigawoon/msw-vfs-cli

Fast, cross-platform CLI for reading and editing **MapleStory Worlds** assets — `.map`, `.ui`, `.gamelogic`, `.model` — **without running the editor or an MCP server**.

Two layers, same data:

- **Layer 1 — VFS / file-level** (`ls` / `read` / `tree` / `grep` / …): path-based, Unix-shell feel. Drop-in replacement for the Python `msw_vfs.py` tool that ships inside [msw-map-ui-edit](https://github.com/choigawoon/msw-ai-coding-plugins-official/tree/main/plugins/sample-msw-creator-skills/skills/msw-map-ui-edit) — same commands, same output shape.
- **Layer 2 — Entity-oriented** (`read-entity` / `list-entities` / `edit-component` / …): GameObject-style bundles. New in 0.4.0; what the viewer uses.

Pure Node.js — no `python3` / `python` / MS Store alias problems on Windows.

## Install

```bash
npm install -g @choigawoon/msw-vfs-cli
```

Requires Node.js 18+. No Python required.

## Usage

```bash
# Summary
msw-vfs path/to/map01.map summary

# Layer 2 — primary (entity-oriented)
msw-vfs path/to/map01.map list-entities /maps/map01
msw-vfs path/to/map01.map read-entity   /maps/map01/BG
msw-vfs path/to/map01.map find-entities Hero --by name
msw-vfs path/to/map01.map edit-entity   /maps/map01/BG --set enable=false
msw-vfs path/to/map01.map edit-component /maps/map01/BG MOD.Core.TransformComponent \
  --set Enable=false

# Entity CRUD
msw-vfs path/to/map01.map add-entity /maps/map01 MyEnemy \
  -c MOD.Core.TransformComponent -c MOD.Core.SpriteRendererComponent
msw-vfs path/to/map01.map remove-entity /maps/map01/MyEnemy
msw-vfs path/to/map01.map rename-entity /maps/map01/MyEnemy MyBoss

# Layer 1 — advanced (file-level)
msw-vfs path/to/map01.map tree / -d 2
msw-vfs path/to/map01.map grep "BossRush" /
msw-vfs path/to/map01.map ls /maps/map01 -l

# .model (entity template) — its own subcommand set
msw-vfs path/to/DefaultPlayer.model info
msw-vfs path/to/DefaultPlayer.model list
msw-vfs path/to/DefaultPlayer.model set speed 5.5
msw-vfs path/to/DefaultPlayer.model remove speed

# YAML round-trip / declarative world
msw-vfs --type map path/to/file.yaml summary
msw-vfs path/to/map01.map export-yaml -o map01.yaml
msw-vfs map01.yaml import-yaml -o map01.map
msw-vfs --type world world.yaml build-world -o ./out
```

Run `msw-vfs --help` for the full command list. For the layer-by-layer catalog see [`COMMANDS.md`](../../COMMANDS.md).

## Persistent modes

Individual CLI invocations pay Node's cold-start cost. For batches (AI agents, IDE extensions):

```bash
# HTTP daemon — later calls auto-proxy to this process
msw-vfs daemon --detach
msw-vfs stop

# stdin/stdout pipe — one Node process amortizes N queries
msw-vfs serve
```

## How it differs from the Python version

- **No Python runtime** — works on any machine with Node 18+.
- **Windows-safe** — no MS Store Python alias conflicts (exit 49 issue).
- **Faster cold start** — ~80 ms vs ~150 ms.
- **Same JSON output shape** — existing skill prompts continue to work unchanged.

## License

MIT
