import { defineLayer } from './defineLayer';
import { p } from '../schema/params';
import glsl from './blurSharpen.glsl?raw';

export default defineLayer({
  type: 'blurSharpen',
  title: 'Blur / Sharpen',
  version: 1,
  kind: 'filter',
  category: 'filter',
  icon: '◌',
  defaults: { blendMode: 'normal' },
  params: {
    mode: p.enum({ default: 'blur', options: ['blur', 'sharpen'] }),
    radius: p.float({ default: 0.5, min: 0, max: 1 }),
    amount: p.float({ default: 1, min: 0, max: 5, softMax: 2, visibleIf: (q) => q.mode === 'sharpen' }),
  },
  passes: [{ shader: glsl }, { shader: glsl }],
  legacy: {
    type: 'BlurSharpenLayer',
    params: (o) => ({ mode: o.mode === 'Sharpen' ? 'sharpen' : 'blur', radius: o.radius, amount: o.amount }),
  },
});
