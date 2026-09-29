import type { ParamValue } from '../schema/params';

export const BLEND_MODES = [
  'normal',
  'add',
  'multiply',
  'screen',
  'subtract',
  'lighten',
  'darken',
  'overlay',
  'softLight',
  'hardLight',
  'colorDodge',
  'difference',
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export const BLEND_SHORT: Record<BlendMode, string> = {
  normal: 'N',
  add: 'Add',
  multiply: 'Mul',
  screen: 'Scr',
  subtract: 'Sub',
  lighten: 'Lt',
  darken: 'Dk',
  overlay: 'Ov',
  softLight: 'SL',
  hardLight: 'HL',
  colorDodge: 'CD',
  difference: 'Dif',
};

export type AssetId = string;

export interface AssetMeta {
  name: string;
  mime: string;
  ext: string;
  width: number;
  height: number;
}

export type MaskSource = 'fresnel' | 'noise' | 'image' | 'layer';

/** Optional per-layer mask (Phase 3). */
export interface MaskRef {
  enabled: boolean;
  source: MaskSource;
  invert: boolean;
  /** fresnel: power, noise: scale */
  amount: number;
  /** image mask asset */
  asset?: AssetId | null;
  /** 'layer': use the alpha/luminance of another layer's output */
  layerId?: string | null;
}

export interface LayerNode {
  id: string;
  type: string;
  typeVersion: number;
  name: string;
  enabled: boolean;
  opacity: number;
  blendMode: BlendMode;
  params: Record<string, ParamValue>;
  mask?: MaskRef;
  /** Present only on group layers. Array head = front-most. */
  children?: LayerNode[];
  collapsed?: boolean;
}

export type BlendSpace = 'srgb' | 'linear';

export interface Project {
  schemaVersion: 1;
  meta: { name: string; createdWith: string; modifiedAt: string };
  settings: {
    blendSpace: BlendSpace;
    /** false = clamp to [0,1] at every stage like v3; true = keep >1 values (HDR) */
    hdr: boolean;
  };
  /** index 0 = front-most (matches layer panel order) */
  layers: LayerNode[];
  assets: Record<AssetId, AssetMeta>;
}

export type PreviewShape = 'sphere' | 'flat' | 'normalMap' | 'mesh';
export type SplitMode = 'single' | 'compare' | 'beforeAfter';

export interface NormalMapView {
  asset: AssetId | null; // null = built-in procedural map
  strength: number;
  scale: number;
  offset: [number, number];
}

/** Saved with the project but excluded from undo history. */
export interface ViewState {
  previewShape: PreviewShape;
  split: SplitMode;
  normalMap: NormalMapView;
  mesh: AssetId | null;
  zoom: number;
  showGizmos: boolean;
  /** beforeAfter divider position 0..1 */
  swipe: number;
  /** orbit for mesh preview (radians) */
  orbit: [number, number];
  /** HDR display exposure (stops) */
  exposure: number;
  toneMap: boolean;
}

export const CURRENT_SCHEMA_VERSION = 1 as const;
