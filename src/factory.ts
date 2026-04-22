// Swappable factories for VFS instances.
//
// cli.ts calls through these factories so the daemon can substitute cached
// instances without touching handler code.

import { MapVFS } from './vfs/map';
import { UIVFS } from './vfs/ui';
import { GameLogicVFS } from './vfs/gamelogic';
import { ModelVFS } from './model/vfs';
import type { EntitiesVFS } from './vfs/entities';

export type EntitiesFactory = (type: string, file: string) => EntitiesVFS;
export type ModelFactory = (file: string) => ModelVFS;

const defaultEntitiesFactory: EntitiesFactory = (type, file) => {
  switch (type) {
    case 'map': return new MapVFS(file);
    case 'ui': return new UIVFS(file);
    case 'gamelogic': return new GameLogicVFS(file);
    default: throw new Error(`unsupported type: ${type}`);
  }
};

const defaultModelFactory: ModelFactory = (file) => new ModelVFS(file);

let entitiesFactory: EntitiesFactory = defaultEntitiesFactory;
let modelFactory: ModelFactory = defaultModelFactory;

export function makeEntities(type: string, file: string): EntitiesVFS {
  return entitiesFactory(type, file);
}

export function makeModel(file: string): ModelVFS {
  return modelFactory(file);
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
