import { defineLayer } from './defineLayer';
import { p } from '../schema/params';
import glsl from './grain.glsl?raw';

export default defineLayer({
  type: 'grain',
  title: 'Film Grain',
  version: 1,
  kind: 'filter',
  category: 'filter',
  icon: '⁘',
  defaults: { blendMode: 'normal' },
  params: {
    amount: p.float({ default: 0.08, min: 0, max: 1, softMax: 0.3 }),
    size: p.float({ default: 1, min: 0.1, max: 16, softMax: 6 }),
    seed: p.int({ default: 0, min: 0, max: 100000, softMax: 100 }),
    monochrome: p.bool({ default: true }),
  },
  passes: [{ shader: glsl }],
});
