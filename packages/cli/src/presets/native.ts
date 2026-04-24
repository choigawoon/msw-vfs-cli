// Native preset resolver — loads bundled .model files from
// packages/cli/assets/native/<CoreVersion>/ and builds entity skeletons
// that mirror what Unity's UIWorkspaceManager.CreateUIEntity(parent, "UISprite")
// would produce at runtime.
//
// Why: addEntity() on the raw CLI path only emits { "@type", "Enable": true }
// for each component, which is structurally valid but missing authoritative
// overrides (AlignmentOption, RectSize, ImageRUID shape, ...) that the engine
// applies when spawning from a .model. Bundling the .model files lets the CLI
// apply those same Values[] overrides offline — same result, no editor needed.
//
// Source: D:\ai-agent-tf\native-scripts\Global (CoreVersion 26.3.0.0).

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { JsonDict } from '../types';

export interface NativePreset {
  /** Display name from .model — e.g., "UISprite". Used as origin.entry_id. */
  name: string;
  /** Lowercase Id from .model — e.g., "uisprite". Used as entity.modelId. */
  id: string;
  /** Component @type list from .model.Components. Order preserved. */
  components: string[];
  /** Raw .model ContentProto.Json for callers needing more than defaults. */
  raw: JsonDict;
  /** Absolute path of the bundled .model file. */
  sourcePath: string;
  /** From .model BaseModelId — inheritance. v1 does not resolve chains. */
  baseModelId: string | null;
}

export interface NativePresetIndex {
  coreVersion: string;
  assetsDir: string;
  /** Lowercased name/id → preset. Both "UISprite" and "uisprite" hit the same entry. */
  byKey: Map<string, NativePreset>;
  /** Enumerable list, sorted by name. */
  all: NativePreset[];
}

const DEFAULT_CORE_VERSION = '26.3.0.0';

/** Recursively strip the "$type" discriminator that appears in .model Value
 *  objects. Entity components store values without that wrapper (confirmed
 *  against .ui fixtures). */
function stripDollarType(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripDollarType);
  if (v && typeof v === 'object') {
    const out: JsonDict = {};
    for (const [k, val] of Object.entries(v as JsonDict)) {
      if (k === '$type') continue;
      out[k] = stripDollarType(val) as any;
    }
    return out;
  }
  return v;
}

function assetsRoot(): string {
  // dist/presets/native.js → ../../assets
  // src/presets/native.ts  → ../../assets (via tsc out-dir alignment)
  return path.resolve(__dirname, '..', '..', 'assets', 'native');
}

/** Scan the bundled assets dir for a given CoreVersion and build the index.
 *  Skips files that are not .model or can't be parsed as native presets
 *  (e.g. config/collisiongroupset files that happen to live alongside). */
export function loadNativePresets(coreVersion: string = DEFAULT_CORE_VERSION): NativePresetIndex {
  const assetsDir = path.join(assetsRoot(), coreVersion);
  const byKey = new Map<string, NativePreset>();
  const all: NativePreset[] = [];

  if (!fs.existsSync(assetsDir)) {
    return { coreVersion, assetsDir, byKey, all };
  }

  for (const fname of fs.readdirSync(assetsDir)) {
    if (!fname.endsWith('.model')) continue;
    const full = path.join(assetsDir, fname);
    let raw: JsonDict;
    try {
      raw = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch {
      continue;
    }
    const cp = (raw.ContentProto as JsonDict | undefined)?.Json as JsonDict | undefined;
    if (!cp) continue;

    const name = String(cp.Name ?? '');
    const id = String(cp.Id ?? '');
    if (!name || !id) continue;

    const components = Array.isArray(cp.Components) ? (cp.Components as string[]).slice() : [];
    const baseModelId = cp.BaseModelId == null ? null : String(cp.BaseModelId);

    const preset: NativePreset = { name, id, components, raw: cp, sourcePath: full, baseModelId };
    all.push(preset);
    byKey.set(name.toLowerCase(), preset);
    byKey.set(id.toLowerCase(), preset);
  }

  all.sort((a, b) => a.name.localeCompare(b.name));
  return { coreVersion, assetsDir, byKey, all };
}

let cachedIndex: NativePresetIndex | null = null;
/** Process-wide cached index. Safe because asset dir is read-only. */
export function getNativePresets(coreVersion?: string): NativePresetIndex {
  if (cachedIndex && (!coreVersion || cachedIndex.coreVersion === coreVersion)) {
    return cachedIndex;
  }
  cachedIndex = loadNativePresets(coreVersion);
  return cachedIndex;
}

export function resolvePreset(
  nameOrId: string,
  index: NativePresetIndex = getNativePresets(),
): NativePreset | null {
  return index.byKey.get(nameOrId.toLowerCase()) ?? null;
}

/** What addEntity needs to emit an entity equivalent to what the engine
 *  produces when spawning from a native .model. */
export interface PresetSkeleton {
  modelId: string;
  origin: JsonDict;
  components: JsonDict[];
  componentNames: string[];
}

/** Build the entity fields for a given preset. The resulting components[]
 *  have {@type, Enable:true, <Values applied>} for each component listed on
 *  the model. Properties not in the .model's Values[] are omitted — the
 *  engine fills in the rest from component-class defaults at load time.
 *
 *  Caller may merge user-specified extra components / property overrides
 *  on top of this skeleton before persisting.
 */
export function buildPresetSkeleton(preset: NativePreset): PresetSkeleton {
  const values = Array.isArray(preset.raw.Values) ? (preset.raw.Values as JsonDict[]) : [];

  // Group Values[] by TargetType (C# fully-qualified component type).
  const valuesByType = new Map<string, JsonDict>();
  for (const v of values) {
    const target = String(v.TargetType ?? '');
    const name = String(v.Name ?? '');
    if (!target || !name) continue;
    const bag = valuesByType.get(target) ?? {};
    bag[name] = stripDollarType(v.Value) as any;
    valuesByType.set(target, bag);
  }

  const components: JsonDict[] = [];
  for (const compType of preset.components) {
    const comp: JsonDict = { '@type': compType };
    const bag = valuesByType.get(compType);
    if (bag) Object.assign(comp, bag);
    comp.Enable = true;
    components.push(comp);
  }

  return {
    modelId: preset.id,
    origin: {
      type: 'Model',
      entry_id: preset.name,
      sub_entity_id: null,
      root_entity_id: null,
      replaced_model_id: null,
    },
    components,
    componentNames: preset.components.slice(),
  };
}
