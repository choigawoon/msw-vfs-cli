// UIEntryParser — .ui asset. Extends EntitiesEntryParser with UI-specific summary fields.

import { EntitiesEntryParser, type SummaryResult } from './entities';
import type { JsonDict } from '../types';

export const UI_GROUP_TYPES: Record<number, string> = {
  0: 'Default',
  1: 'Default',
  2: 'Popup',
  3: 'Toast',
};

export interface UISummary extends SummaryResult {
  ui_group_type: string;
  ui_group_type_raw: number | null;
  buttons: number;
  texts: number;
  sprites: number;
}

export class UIEntryParser extends EntitiesEntryParser {
  override summary(): UISummary {
    const base = super.summary();
    let groupType: number | null = null;
    for (const r of this.search('UIGroupComponent.json')) {
      const data = this.read(r.path);
      if ('content' in data && data.content && typeof (data.content as JsonDict).GroupType === 'number') {
        groupType = (data.content as JsonDict).GroupType as number;
        break;
      }
    }
    const cc = base.component_counts;
    return {
      ...base,
      ui_group_type: groupType === null ? 'Unknown(null)' : (UI_GROUP_TYPES[groupType] ?? `Unknown(${groupType})`),
      ui_group_type_raw: groupType,
      buttons: cc.ButtonComponent ?? 0,
      texts: cc.TextComponent ?? 0,
      sprites: cc.SpriteGUIRendererComponent ?? 0,
    };
  }
}
