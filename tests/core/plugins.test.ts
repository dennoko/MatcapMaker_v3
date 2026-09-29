import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadPlugin } from '../../src/core/layers/pluginLoader';
import { glslDecl } from '../../src/core/schema/params';

const builtin = new Set(['spotLight']);

describe('layer plugins', () => {
  it('loads the example generator plugin', () => {
    const json = readFileSync('examples/plugins/hexGrid/layer.json', 'utf8');
    const glsl = readFileSync('examples/plugins/hexGrid/layer.glsl', 'utf8');
    const { def, strings } = loadPlugin(json, [glsl], builtin);
    expect(def.type).toBe('hexGrid');
    expect(def.kind).toBe('generator');
    expect(def.defaults.blendMode).toBe('multiply');
    expect(Object.keys(def.params)).toEqual(['scale', 'width', 'color', 'space']);
    expect(glslDecl('space', def.params.space)).toBe('uniform int u_space;');
    expect(strings.ja['layer.hexGrid.title']).toBe('六角グリッド');
    expect(def.plugin).toBe(true);
  });

  it('loads a multi-pass filter plugin', () => {
    const json = readFileSync('examples/plugins/vignette/layer.json', 'utf8');
    const { def } = loadPlugin(json, ['vec4 runPass(vec2 uv){return texture(u_input, uv);}'], builtin);
    expect(def.kind).toBe('filter');
    expect(def.passes!.length).toBe(1);
  });

  it('rejects invalid or clashing plugins', () => {
    expect(() => loadPlugin('{"type":"spotLight"}', ['x'], builtin)).toThrow(/clashes/);
    expect(() => loadPlugin('{"type":"bad name"}', ['x'], builtin)).toThrow(/type/);
    expect(() => loadPlugin('{"type":"ok"}', [], builtin)).toThrow(/glsl/);
    expect(() => loadPlugin('{"type":"ok","params":{"x":{"kind":"wat"}}}', ['x'], builtin)).toThrow(/unknown kind/);
  });
});
