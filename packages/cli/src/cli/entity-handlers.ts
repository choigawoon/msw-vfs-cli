// Layer 2 — entity-oriented handlers.
//
// Operate on entity units: read/list/find/grep entities, edit entity
// metadata, edit components by (entity, @type), and CRUD.
//
// These route through EntitiesEntryParser directly for now; switching
// to EntityModel façade requires no signature change.

import type { EntitiesEntryParser } from '../entry/entities';
import type { JsonDict } from '../types';
import { loadUserModelTree, type UserModelNode } from '../presets/native';

import {
  die,
  peelBool,
  peelFlag,
  peelList,
  parseKv,
  parseJson,
  expectInt,
  runMutation,
} from './util';

// ── Reads ───────────────────────────────────

export function cmdReadEntity(vfs: EntitiesEntryParser, rest: string[]): void {
  const deep = peelBool(rest, '--deep');
  const compact = peelBool(rest, '--compact');
  const p = rest[0];
  if (!p) die('read-entity: path required');
  const r = vfs.readEntity(p, { deep, compact });
  if ('error' in r) die(r.error);
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
}

export function cmdListEntities(vfs: EntitiesEntryParser, rest: string[]): void {
  const recursive = peelBool(rest, '-r', '--recursive');
  const json = peelBool(rest, '--json');
  const p = rest[0] ?? '/';
  const r = vfs.listEntities(p, { recursive });
  if ('error' in r) die(r.error);
  if (json) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    return;
  }
  for (const e of r.entities) {
    const tag = `[${e.components.length}c${e.children_count > 0 ? `, ${e.children_count}e` : ''}]`;
    const model = e.modelId ? ` <${e.modelId}>` : '';
    process.stdout.write(`${e.path.padEnd(44)} ${tag.padEnd(10)} ${e.name}${model}\n`);
  }
  process.stderr.write(`--- ${r.entities.length} entities ---\n`);
}

export function cmdFindEntities(vfs: EntitiesEntryParser, rest: string[]): void {
  const by = (peelFlag(rest, '--by') ?? 'name') as 'name' | 'component' | 'modelId';
  if (!['name', 'component', 'modelId'].includes(by)) {
    die(`--by must be name|component|modelId`);
  }
  const startPath = peelFlag(rest, '--path') ?? undefined;
  const pattern = rest[0];
  if (!pattern) die('find-entities: pattern required');
  const r = vfs.findEntities(pattern, { by, startPath });
  if (!Array.isArray(r)) die(r.error);
  for (const e of r) {
    const model = e.modelId ? ` <${e.modelId}>` : '';
    process.stdout.write(`${e.path.padEnd(44)} [${by}=${e.matched}] ${e.name}${model}\n`);
  }
  process.stderr.write(`--- ${r.length} entities ---\n`);
}

export function cmdGrepEntities(vfs: EntitiesEntryParser, rest: string[]): void {
  const headLimit = expectInt(peelFlag(rest, '--head-limit'), 50, '--head-limit')!;
  const pattern = rest[0];
  if (!pattern) die('grep-entities: pattern required');
  const p = rest[1] ?? '/';
  const r = vfs.grepEntities(pattern, p);
  if (!Array.isArray(r)) die(r.error);
  let printed = 0;
  outer: for (const ent of r) {
    process.stdout.write(`${ent.entity} (${ent.name})\n`);
    for (const hit of ent.hits) {
      for (const m of hit.matches) {
        if (printed >= headLimit) {
          process.stdout.write(`... (more matches, raise --head-limit)\n`);
          break outer;
        }
        let val: any = m.value;
        if (val !== null && (typeof val === 'object' || Array.isArray(val))) {
          val = JSON.stringify(val);
        }
        process.stdout.write(`  ${hit.component}:${m.key}: ${val}\n`);
        printed += 1;
      }
    }
  }
  process.stderr.write(`--- ${r.length} entities, ${printed} matches shown ---\n`);
}

// ── Mutations ───────────────────────────────

export function cmdAddEntity(vfs: EntitiesEntryParser, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const components = peelList(rest, '-c', '--component');
  const modelId = peelFlag(rest, '--model-id');
  const preset = peelFlag(rest, '--preset');
  const disabled = peelBool(rest, '--disabled');
  const invisible = peelBool(rest, '--invisible');
  const parentPath = rest[0];
  const name = rest[1];
  if (!parentPath || !name) die('add-entity: parent_path and name required');
  runMutation(
    vfs,
    vfs.addEntity(parentPath, name, {
      components,
      modelId,
      preset,
      enable: !disabled,
      visible: !invisible,
    }),
    output,
  );
}

export function cmdRemoveEntity(vfs: EntitiesEntryParser, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const p = rest[0];
  if (!p) die('remove-entity: path required');
  runMutation(vfs, vfs.removeEntity(p), output);
}

export function cmdEditEntity(vfs: EntitiesEntryParser, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const setKv = peelList(rest, '--set');
  const p = rest[0];
  if (!p) die('edit-entity: path required');
  const parsed = parseKv(setKv);
  if ('error' in parsed) die(parsed.error);
  runMutation(vfs, vfs.editEntity(p, parsed as JsonDict), output);
}

export function cmdRenameEntity(vfs: EntitiesEntryParser, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const p = rest[0];
  const newName = rest[1];
  if (!p || !newName) die('rename-entity: path and new_name required');
  runMutation(vfs, vfs.renameEntity(p, newName), output);
}

export function cmdAddComponent(vfs: EntitiesEntryParser, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const propsJson = peelFlag(rest, '--properties');
  const entityPath = rest[0];
  const typeName = rest[1];
  if (!entityPath || !typeName) die('add-component: entity_path and type_name required');
  const props = propsJson ? parseJson(propsJson, '--properties') : undefined;
  runMutation(vfs, vfs.addComponent(entityPath, typeName, props), output);
}

export function cmdRemoveComponent(vfs: EntitiesEntryParser, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const entityPath = rest[0];
  const typeName = rest[1];
  if (!entityPath || !typeName) die('remove-component: entity_path and type_name required');
  runMutation(vfs, vfs.removeComponent(entityPath, typeName), output);
}

export function cmdEditComponent(vfs: EntitiesEntryParser, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const setKv = peelList(rest, '--set');
  const entityPath = rest[0];
  const typeName = rest[1];
  if (!entityPath || !typeName) die('edit-component: entity_path and type required');
  const parsed = parseKv(setKv);
  if ('error' in parsed) die(parsed.error);
  runMutation(vfs, vfs.editComponent(entityPath, typeName, parsed as JsonDict), output);
}

export function cmdSpawnModel(vfs: EntitiesEntryParser, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const modelFile = peelFlag(rest, '--model-file');
  const disabled = peelBool(rest, '--disabled');
  const invisible = peelBool(rest, '--invisible');
  const parentPath = rest[0];
  const name = rest[1];
  if (!parentPath || !name) die('spawn-model: parent_path and name required');
  if (!modelFile) die('spawn-model: --model-file <path> required');

  let root: UserModelNode;
  try {
    root = loadUserModelTree(modelFile);
  } catch (e: any) {
    die(`spawn-model: failed to load model file: ${e.message}`);
  }

  let totalEntities = 0;

  function spawnNode(node: UserModelNode, parentEntityPath: string, entityName: string): void {
    const { skeleton } = node;
    const result = vfs.addEntity(parentEntityPath, entityName, {
      components: skeleton.components,
      modelId: skeleton.modelId,
      origin: skeleton.origin,
      enable: !disabled,
      visible: !invisible,
    });
    if ('error' in result) die(`spawn-model: ${result.error} (at ${parentEntityPath}/${entityName})`);
    totalEntities++;
    const entityPath = `${parentEntityPath.replace(/\/+$/, '')}/${entityName}`;
    for (const child of node.children) {
      spawnNode(child, entityPath, child.name);
    }
  }

  spawnNode(root!, parentPath, name);

  const saveResult = output ? vfs.save(output) : vfs.save();
  if (!saveResult.ok) die(`spawn-model: save failed: ${saveResult.error}`);
  process.stderr.write(`spawned ${totalEntities} entit${totalEntities === 1 ? 'y' : 'ies'} from ${modelFile}\n`);
  process.stdout.write(JSON.stringify({ ok: true, path: `${parentPath.replace(/\/+$/,'')}/${name}`, entities_created: totalEntities }) + '\n');
}
