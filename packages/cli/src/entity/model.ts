// EntityModel — Layer 2 façade over an entity-based EntryParser
// (currently EntitiesEntryParser, covering .map / .ui / .gamelogic).
//
// Exposes the GameObject-style API: one entity = metadata + components.
// Every method delegates to the underlying parser; EntityModel is a
// narrower interface meant for tools (viewer, LLM) that want to think
// in entity units, not file paths.
//
// The low-level VFS API (ls / read / tree / grep / glob / stat / edit)
// remains on the parser itself — callers that need filesystem-style
// navigation use `model.parser.ls(…)` etc.

import type { EntitiesEntryParser, ActionResult, GrepMatch } from '../entry/entities';
import type { JsonDict } from '../types';

export interface EntityBundle {
  path: string;
  name: string;
  metadata: JsonDict;
  components: Record<string, any>;
  children?: EntityBundle[] | Array<{ path: string; name: string }>;
}

export interface EntityDescriptor {
  path: string;
  name: string;
  components: string[];
  children_count: number;
  modelId?: string;
}

export interface EntityListing {
  path: string;
  entities: EntityDescriptor[];
}

export interface EntityMatch {
  path: string;
  name: string;
  matched: string;
  modelId?: string;
}

export interface EntityGrepResult {
  entity: string;
  name: string;
  hits: Array<{ component: string; path: string; matches: GrepMatch[] }>;
}

export class EntityModel {
  constructor(public readonly parser: EntitiesEntryParser) {}

  // ── Reads ────────────────────────────────────

  readEntity(
    p: string,
    opts: { deep?: boolean; compact?: boolean } = {},
  ): { error: string } | EntityBundle {
    return this.parser.readEntity(p, opts) as any;
  }

  listEntities(
    p: string = '/',
    opts: { recursive?: boolean } = {},
  ): { error: string } | EntityListing {
    return this.parser.listEntities(p, opts);
  }

  findEntities(
    pattern: string,
    opts: { by?: 'name' | 'component' | 'modelId'; startPath?: string } = {},
  ): { error: string } | EntityMatch[] {
    return this.parser.findEntities(pattern, opts);
  }

  grepEntities(
    pattern: string,
    startPath: string = '/',
  ): { error: string } | EntityGrepResult[] {
    return this.parser.grepEntities(pattern, startPath);
  }

  // ── Mutations ────────────────────────────────

  editEntity(p: string, updates: JsonDict): ActionResult {
    return this.parser.editEntity(p, updates);
  }

  editComponent(
    entityPath: string,
    typeName: string,
    updates: JsonDict,
  ): ActionResult {
    return this.parser.editComponent(entityPath, typeName, updates);
  }

  addEntity(
    parentPath: string,
    name: string,
    opts: {
      components?: (string | JsonDict)[];
      modelId?: string | null;
      enable?: boolean;
      visible?: boolean;
      nameEditable?: boolean;
      localize?: boolean;
    } = {},
  ): ActionResult {
    return this.parser.addEntity(parentPath, name, opts);
  }

  removeEntity(p: string): ActionResult {
    return this.parser.removeEntity(p);
  }

  renameEntity(p: string, newName: string): ActionResult {
    return this.parser.renameEntity(p, newName);
  }

  addComponent(
    entityPath: string,
    typeName: string,
    properties?: JsonDict,
  ): ActionResult {
    return this.parser.addComponent(entityPath, typeName, properties);
  }

  removeComponent(entityPath: string, typeName: string): ActionResult {
    return this.parser.removeComponent(entityPath, typeName);
  }

  // ── Passthrough ──────────────────────────────

  save(outputPath: string | null = null) {
    return this.parser.save(outputPath);
  }

  validate() {
    return this.parser.validate();
  }

  get isDirty(): boolean {
    return this.parser.isDirty;
  }
}
