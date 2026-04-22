// Default-value tables + noise field sets used by EntitiesEntryParser compact helpers.
// Mirrors the constants at the top of entities_core.py.

import type { JsonDict } from '../types';

export const VEC3_ZERO = Object.freeze({ x: 0.0, y: 0.0, z: 0.0 });
export const VEC3_ONE = Object.freeze({ x: 1.0, y: 1.0, z: 1.0 });
export const QUAT_ID = Object.freeze({ x: 0.0, y: 0.0, z: 0.0, w: 1.0 });
export const VEC4_WHITE = Object.freeze({ r: 1.0, g: 1.0, b: 1.0, a: 1.0 });

export const DEFAULT_STRIP: JsonDict = {
  Enable: true,
  QuaternionRotation: QUAT_ID,
  Rotation: VEC3_ZERO,
  Scale: VEC3_ONE,
  ZRotation: 0.0,
  Color: VEC4_WHITE,
  FootholdDrag: 1.0,
  FootholdForce: 0.0,
  FootholdWalkSpeedFactor: 1.0,
  IgnoreMapLayerCheck: false,
  IsOddGridPosition: false,
  TileMapVersion: 1,
  OrderInLayer: 1,
  Thumbnail: '',
  Locked: false,
  IsVisible: true,
  UIVersion: 2,
  UIMode: 1,
  MobileOnly: false,
  OverrideSorting: false,
  SortingLayer: 'MapLayer0',
  MinSize: 10,
  OutlineColor: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
  OutlineDistance: { x: 1.0, y: -1.0 },
  GroupOrder: 0,
};

export const ENTITY_NOISE = new Set([
  'nameEditable', 'localize', 'revision', '@version',
  'pathConstraints', 'displayOrder', 'componentNames',
]);

export const COMPONENT_NOISE = new Set(['@type']);

export const UI_REDUNDANT = new Set(['anchoredPosition']);

export const BUTTON_DEFAULT_IMAGES: JsonDict = {
  HighlightedSprite: null,
  PressedSprite: null,
  SelectedSprite: null,
  DisabledSprite: null,
};

export const LARGE_ARRAY_LIMIT = 5;

export const PREVIEW_NOISE = new Set([
  'sortingLayerName', 'groupID', 'layer', 'OwnerId',
  'Variance', 'Length', 'attribute', 'type',
]);

export const ENTITY_DEFAULTS: JsonDict = {
  enable: true,
  visible: true,
};

export const HEAVY_ENTITY_THRESHOLD = 10;

export const ENTITY_META_FIELDS = new Set([
  'name', 'enable', 'visible', 'modelId', 'displayOrder',
  'localize', 'nameEditable', 'origin',
]);
