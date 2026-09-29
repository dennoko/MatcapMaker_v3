import type { LayerDef } from './defineLayer';
import solidColor from './solidColor';
import spotLight from './spotLight';
import fresnel from './fresnel';
import noise from './noise';
import image from './image';
import gradient from './gradient';
import colorAdjust from './colorAdjust';
import blurSharpen from './blurSharpen';
import curves from './curves';
import gradientMap from './gradientMap';
import chromaticAberration from './chromaticAberration';
import grain from './grain';

type Listener = () => void;

class LayerRegistry {
  private defs = new Map<string, LayerDef>();
  private listeners = new Set<Listener>();

  register(def: LayerDef) {
    this.defs.set(def.type, def);
    this.listeners.forEach((l) => l());
  }

  unregister(type: string) {
    if (this.defs.delete(type)) this.listeners.forEach((l) => l());
  }

  get(type: string): LayerDef | undefined {
    return this.defs.get(type);
  }

  has(type: string): boolean {
    return this.defs.has(type);
  }

  all(): LayerDef[] {
    return [...this.defs.values()];
  }

  byLegacyType(legacy: string): LayerDef | undefined {
    return this.all().find((d) => d.legacy?.type === legacy);
  }

  onChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const registry = new LayerRegistry();

export const BUILTIN_LAYERS: LayerDef[] = [
  solidColor,
  spotLight,
  fresnel,
  noise,
  image,
  gradient,
  colorAdjust,
  blurSharpen,
  curves,
  gradientMap,
  chromaticAberration,
  grain,
];

for (const d of BUILTIN_LAYERS) registry.register(d);
