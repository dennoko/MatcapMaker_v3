import { describe, expect, it } from 'vitest';
import { coerceParam, glslDecl, hexToRgb, p, rgbToHex, toUniforms } from '../../src/core/schema/params';

describe('param schema', () => {
  it('clamps floats and falls back to default', () => {
    const s = p.float({ default: 0.5, min: 0, max: 1 });
    expect(coerceParam(s, 2)).toBe(1);
    expect(coerceParam(s, -1)).toBe(0);
    expect(coerceParam(s, 'x')).toBe(0.5);
    expect(coerceParam(s, NaN)).toBe(0.5);
  });

  it('normalizes directions', () => {
    const s = p.direction({ default: [0, 0, 1] });
    const v = coerceParam(s, [0, 0, 5]) as number[];
    expect(v).toEqual([0, 0, 1]);
  });

  it('accepts hex and arrays for colors', () => {
    const s = p.color({ default: '#ff0000' });
    expect(s.default).toEqual([1, 0, 0]);
    expect(coerceParam(s, '#00ff00')).toEqual([0, 1, 0]);
    expect(coerceParam(s, [2, -1, 0.5])).toEqual([1, 0, 0.5]);
    expect(rgbToHex(hexToRgb('#12abef'))).toBe('#12abef');
  });

  it('validates gradients (sorted, >=2 stops, max 8)', () => {
    const s = p.gradient({
      default: { stops: [{ pos: 0, color: [0, 0, 0] }, { pos: 1, color: [1, 1, 1] }], interp: 'rgb' },
    });
    const g = coerceParam(s, {
      stops: Array.from({ length: 10 }, (_, i) => ({ pos: 1 - i / 10, color: [i / 10, 0, 0] })),
    }) as { stops: { pos: number }[] };
    expect(g.stops.length).toBe(8);
    expect(g.stops[0].pos).toBeLessThan(g.stops[1].pos);
    expect(coerceParam(s, { stops: [{ pos: 0, color: [0, 0, 0] }] })).toEqual(s.default);
  });

  it('derives GLSL declarations and uniforms', () => {
    expect(glslDecl('intensity', p.float({ default: 1, min: 0, max: 2 }))).toBe('uniform float u_intensity;');
    const e = p.enum({ default: 'b', options: ['a', 'b'] });
    expect(toUniforms('mode', e, 'b')).toEqual({ u_mode: { t: 'i', v: 1 } });
    expect(glslDecl('stops', p.gradient({ default: { stops: [], interp: 'rgb' } }))).toContain('u_stops_col[8]');
  });
});
