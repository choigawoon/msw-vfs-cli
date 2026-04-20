# @choigawoon/msw-vfs-cli

Fast, cross-platform CLI for reading and editing **MapleStory Worlds** assets — `.map`, `.ui`, `.gamelogic`, `.model` — **without running the editor or an MCP server**.

Drop-in replacement for the Python `msw_vfs.py` tool that ships inside the
[msw-ai-coding-plugins-official](https://github.com/choigawoon/msw-ai-coding-plugins-official)
`msw-map-ui-edit` skill. Same commands, same output shape — but pure Node.js, so no `python3` / `python` / MS Store alias problems on Windows.

## Status

**Pre-release.** Porting in progress from Python (~3,300 LOC) to TypeScript. Read-only commands land first, mutations and YAML next. Track progress in [CHANGELOG.md](CHANGELOG.md).

## Install

```bash
npm install -g @choigawoon/msw-vfs-cli
```

Requires Node.js 16+. No Python required.

## Usage

```bash
# Auto-detect type by extension
msw-vfs path/to/map01.map summary
msw-vfs path/to/DefaultGroup.ui tree /
msw-vfs path/to/DefaultPlayer.model list

# Override type explicitly
msw-vfs --type map path/to/file summary

# Edit component property
msw-vfs path/to/map01.map edit /BG/SpriteRendererComponent.json --set Color.a=0.5

# Add entity
msw-vfs path/to/map01.map add-entity / MyNewEnemy -c MOD.Core.TransformComponent -c MOD.Core.SpriteComponent

# Build world from yaml
msw-vfs --type world world.yaml build-world -o ./out
```

Run `msw-vfs --help` for the full command list.

## How it differs from the Python version

- **No Python runtime** — works on any machine with Node 16+.
- **Windows-safe** — no MS Store Python alias conflicts (exit 49 issue).
- **Faster cold start** — ~80 ms vs ~150 ms.
- **Same JSON output shape** — existing skill prompts continue to work unchanged.

## Development

```bash
git clone https://github.com/choigawoon/msw-vfs-cli.git
cd msw-vfs-cli
npm install
npm run build
npm test
node bin/cli.js --help
```

## License

MIT
