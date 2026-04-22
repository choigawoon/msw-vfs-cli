# @choigawoon/msw-vfs-cli

Fast, cross-platform CLI for reading and editing **MapleStory Worlds** assets — `.map`, `.ui`, `.gamelogic`, `.model` — **without running the editor or an MCP server**.

Drop-in replacement for the Python `msw_vfs.py` tool that ships inside the
[msw-ai-coding-plugins-official](https://github.com/choigawoon/msw-ai-coding-plugins-official)
`msw-map-ui-edit` skill. Same commands, same output shape — but pure Node.js, so no `python3` / `python` / MS Store alias problems on Windows.

## Install

```bash
npm install -g @choigawoon/msw-vfs-cli
```

Requires Node.js 18+. No Python required.

## Usage

```bash
# Auto-detect type by extension
msw-vfs path/to/map01.map summary
msw-vfs path/to/DefaultGroup.ui tree / -d 2
msw-vfs path/to/DefaultPlayer.model list

# Override type explicitly (YAML assets)
msw-vfs --type map path/to/file.yaml summary

# Edit a component property in place
msw-vfs path/to/map01.map edit /maps/map01/BG/SpriteRendererComponent.json --set Enable=false

# Add an entity (GUID + path + componentNames auto-filled)
msw-vfs path/to/map01.map add-entity /maps/map01 MyEnemy \
  -c MOD.Core.TransformComponent -c MOD.Core.SpriteRendererComponent

# Model override table
msw-vfs path/to/DefaultPlayer.model set speed 5.5
msw-vfs path/to/DefaultPlayer.model remove speed

# YAML round-trip
msw-vfs path/to/map01.map export-yaml -o map01.yaml
msw-vfs map01.yaml import-yaml -o map01.map

# Build a declarative world.yaml into a full asset tree
msw-vfs --type world world.yaml build-world -o ./out
```

Run `msw-vfs --help` for the full command list.

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
