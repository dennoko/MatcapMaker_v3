import { defineLayer } from './defineLayer';
import { p } from '../schema/params';
import glsl from './gradientMap.glsl?raw';

/** Color ramp over the luminance of the layers below. */
export default defineLayer({
  type: 'gradientMap',
  title: 'Color Ramp',
  version: 1,
  kind: 'adjustment',
  category: 'color',
  icon: '▥',
  defaults: { blendMode: 'normal' },
  params: {
    stops: p.gradient({
      default: {
        stops: [
          { pos: 0, color: [0.05, 0.03, 0.12] },
          { pos: 0.5, color: [0.8, 0.35, 0.3] },
          { pos: 1, color: [1, 0.95, 0.8] },
        ],
        interp: 'oklab',
      },
    }),
  },
  passes: [{ shader: glsl }],
});
