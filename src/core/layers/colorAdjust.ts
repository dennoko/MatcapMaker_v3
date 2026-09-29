import { defineLayer } from './defineLayer';
import { p } from '../schema/params';
import glsl from './colorAdjust.glsl?raw';

export default defineLayer({
  type: 'colorAdjust',
  title: 'Color Adjustment',
  version: 1,
  kind: 'adjustment',
  category: 'color',
  icon: '◐',
  defaults: { blendMode: 'normal' },
  params: {
    hue: p.float({ default: 0, min: -0.5, max: 0.5 }),
    saturation: p.float({ default: 1, min: 0, max: 2 }),
    brightness: p.float({ default: 0, min: -1, max: 1 }),
    contrast: p.float({ default: 1, min: 0, max: 2 }),
  },
  passes: [{ shader: glsl }],
  legacy: {
    type: 'AdjustmentLayer',
    params: (o) => ({ hue: o.hue, saturation: o.saturation, brightness: o.brightness, contrast: o.contrast }),
  },
});
