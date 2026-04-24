// Handlers for the `presets` top-level subcommand.
//
//   msw-vfs presets list                 — enumerate bundled presets
//   msw-vfs presets show <name> [--json] — dump one preset (components + Values[])
//
// Reads from packages/cli/assets/native/<CoreVersion>/*.model. These files
// are the same .model assets Unity loads at runtime, so `add-entity --preset`
// produces output equivalent to the engine's UIWorkspaceManager.CreateUIEntity.

import { getNativePresets, resolvePreset, buildPresetSkeleton } from '../presets/native';
import { die, peelBool } from './util';

export function runPresetsSubcommand(args: string[]): number {
  const sub = args[0];
  if (!sub || sub === '--help' || sub === '-h') {
    process.stdout.write(PRESETS_USAGE);
    return 0;
  }
  if (sub === 'list') return cmdPresetsList(args.slice(1));
  if (sub === 'show') return cmdPresetsShow(args.slice(1));
  die(`unknown presets subcommand: ${sub}. Run 'msw-vfs presets --help'.`);
}

const PRESETS_USAGE = `msw-vfs presets — bundled native .model registry

Usage:
  msw-vfs presets list [--json]
  msw-vfs presets show <name> [--json]

'list' shows the name, id, and component count for every bundled preset.
'show' dumps the resolved entity skeleton (modelId, origin, components[] with
Values[] applied) — exactly what 'add-entity --preset NAME' would inject.
`;

function cmdPresetsList(rest: string[]): number {
  const json = peelBool(rest, '--json');
  const idx = getNativePresets();
  if (json) {
    const out = idx.all.map((p) => ({
      name: p.name,
      id: p.id,
      components: p.components,
      base_model_id: p.baseModelId,
    }));
    process.stdout.write(JSON.stringify({ core_version: idx.coreVersion, presets: out }, null, 2) + '\n');
    return 0;
  }
  if (idx.all.length === 0) {
    process.stderr.write(`no bundled presets found at ${idx.assetsDir}\n`);
    return 1;
  }
  for (const p of idx.all) {
    const base = p.baseModelId ? ` (base=${p.baseModelId})` : '';
    process.stdout.write(`${p.name.padEnd(26)} id=${p.id.padEnd(22)} [${p.components.length}c]${base}\n`);
  }
  process.stderr.write(`--- ${idx.all.length} presets (core ${idx.coreVersion}) ---\n`);
  return 0;
}

function cmdPresetsShow(rest: string[]): number {
  const json = peelBool(rest, '--json');
  const name = rest[0];
  if (!name) die('presets show: <name> required');
  const preset = resolvePreset(name);
  if (!preset) die(`unknown preset '${name}'. Run 'msw-vfs presets list'.`);
  const skeleton = buildPresetSkeleton(preset);

  if (json) {
    process.stdout.write(JSON.stringify({
      name: preset.name,
      id: preset.id,
      base_model_id: preset.baseModelId,
      source_path: preset.sourcePath,
      skeleton,
    }, null, 2) + '\n');
    return 0;
  }

  process.stdout.write(`${preset.name} (id=${preset.id})\n`);
  if (preset.baseModelId) process.stdout.write(`  base: ${preset.baseModelId}\n`);
  process.stdout.write(`  source: ${preset.sourcePath}\n`);
  process.stdout.write(`  modelId: ${skeleton.modelId}\n`);
  process.stdout.write(`  components (${skeleton.components.length}):\n`);
  for (const comp of skeleton.components) {
    const typeName = String(comp['@type']);
    const propKeys = Object.keys(comp).filter((k) => k !== '@type' && k !== 'Enable');
    process.stdout.write(`    - ${typeName}  [${propKeys.length} override${propKeys.length === 1 ? '' : 's'}]\n`);
    for (const k of propKeys) {
      const v = comp[k];
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      process.stdout.write(`        ${k}: ${s}\n`);
    }
  }
  return 0;
}
