import { defineLayer } from './defineLayer';
import { p } from '../schema/params';
import glsl from './curves.glsl?raw';

export default defineLayer({
  type: 'curves',
  title: 'Curves',
  version: 1,
  kind: 'adjustment',
  category: 'color',
  icon: '∿',
  defaults: { blendMode: 'normal' },
  params: {
    channel: p.enum({ default: 'rgb', options: ['rgb', 'red', 'green', 'blue', 'luma'] }),
    curve: p.curve({
      default: [
        { x: 0, y: 0 },
        { x: 0.25, y: 0.2 },
        { x: 0.75, y: 0.8 },
        { x: 1, y: 1 },
      ],
    }),
  },
  passes: [{ shader: glsl }],
});
