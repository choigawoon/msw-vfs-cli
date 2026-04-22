// MapVFS — .map asset. Extends EntitiesVFS with tile_map_mode in summary().

import { EntitiesVFS, type SummaryResult } from './entities';
import type { JsonDict } from '../types';

export const TILE_MAP_MODES: Record<number, string> = {
  0: 'MapleTile',
  1: 'RectTile',
  2: 'SideViewRectTile',
};

export interface MapSummary extends SummaryResult {
  tile_map_mode: string;
  tile_map_mode_raw: number | null;
}

export class MapVFS extends EntitiesVFS {
  static readonly TILE_MAP_MODES = TILE_MAP_MODES;

  override summary(): MapSummary {
    const base = super.summary();
    let tmm: number | null = null;
    for (const r of this.search('MapComponent.json')) {
      const data = this.read(r.path);
      if ('content' in data && data.content && typeof (data.content as JsonDict).TileMapMode === 'number') {
        tmm = (data.content as JsonDict).TileMapMode as number;
        break;
      }
    }
    const label = tmm === null ? 'N/A' : (TILE_MAP_MODES[tmm] ?? `Unknown(${tmm})`);
    return { ...base, tile_map_mode: label, tile_map_mode_raw: tmm };
  }
}
