import { defineLayer } from './defineLayer';
import { p } from '../schema/params';
import glsl from './chromaticAberration.glsl?raw';

export default defineLayer({
  type: 'chromaticAberration',
  title: 'Chromatic Aberration',
  version: 1,
  kind: 'filter',
  category: 'filter',
  icon: '◎',
  defaults: { blendMode: 'normal' },
  params: {
    amount: p.float({ default: 0.02, min: 0, max: 0.2, softMax: 0.06, step: 0.001 }),
  },
  passes: [{ shader: glsl }],
});
