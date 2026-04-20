// GameLogicVFS — .gamelogic asset. Extends EntitiesVFS with root_entity info.

import { EntitiesVFS, type SummaryResult } from './entities';

export interface GameLogicSummary extends SummaryResult {
  root_entity: string | null;
  has_components: boolean;
}

export class GameLogicVFS extends EntitiesVFS {
  override summary(): GameLogicSummary {
    const base = super.summary();
    let rootEntity: string | null = null;
    // 'this.entities' is protected but accessible to subclass.
    for (const e of (this as any).entities) {
      if (e.path === '/common') {
        rootEntity = e.jsonString?.name ?? 'common';
        break;
      }
    }
    const hasComponents = ((this as any).entities as any[]).some(
      (e) => Array.isArray(e?.jsonString?.['@components']) && e.jsonString['@components'].length > 0,
    );
    return { ...base, root_entity: rootEntity, has_components: hasComponents };
  }
}
