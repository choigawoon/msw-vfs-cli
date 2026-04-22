// Swappable factories for VFS instances.
//
// cli.ts calls through these factories so the daemon can substitute cached
// instances without touching handler code.

import { MapEntryParser } from './entry/map';
import { UIEntryParser } from './entry/ui';
import { GameLogicEntryParser } from './entry/gamelogic';
import { ModelEntryParser } from './entry/model';
import type { EntitiesEntryParser } from './entry/entities';
import { EntityModel } from './entity/model';

export type EntitiesFactory = (type: string, file: string) => EntitiesEntryParser;
export type ModelFactory = (file: string) => ModelEntryParser;

const defaultEntitiesFactory: EntitiesFactory = (type, file) => {
  switch (type) {
    case 'map': return new MapEntryParser(file);
    case 'ui': return new UIEntryParser(file);
    case 'gamelogic': return new GameLogicEntryParser(file);
    default: throw new Error(`unsupported type: ${type}`);
  }
};

const defaultModelFactory: ModelFactory = (file) => new ModelEntryParser(file);

let entitiesFactory: EntitiesFactory = defaultEntitiesFactory;
let modelFactory: ModelFactory = defaultModelFactory;

export function makeEntities(type: string, file: string): EntitiesEntryParser {
  return entitiesFactory(type, file);
}

export function makeModel(file: string): ModelEntryParser {
  return modelFactory(file);
}

/** L2 façade: wraps the entity-based parser so callers can work in
 *  GameObject units (entity bundles) instead of VFS paths. */
export function makeEntityModel(type: string, file: string): EntityModel {
  return new EntityModel(makeEntities(type, file));
}

export function setEntitiesFactory(f: EntitiesFactory): void {
  entitiesFactory = f;
}

export function setModelFactory(f: ModelFactory): void {
  modelFactory = f;
}

export function resetFactories(): void {
  entitiesFactory = defaultEntitiesFactory;
  modelFactory = defaultModelFactory;
}
