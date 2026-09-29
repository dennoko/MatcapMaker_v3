import { describe, expect, it } from 'vitest';
import { deserializeProject, isLegacyV3, serializeProject } from '../../src/core/io/serialize';
import { importLegacyV3 } from '../../src/core/io/legacyV3';
import { AssetStore } from '../../src/core/io/assetStore';
import { createDefaultProject, createLayer, defaultViewState } from '../../src/core/model/project';

describe('project serialization', () => {
  it('round-trips and stores only non-default params', () => {
    const p = createDefaultProject('Test');
    p.layers.unshift(createLayer('gradient', { angle: 45 }));
    const json = serializeProject(p, defaultViewState());
    const doc = JSON.parse(json);
    expect(doc.layers[0].params).toEqual({ angle: 45 });
    const back = deserializeProject(json);
    expect(back.warnings).toEqual([]);
    expect(back.project.layers.map((l) => l.type)).toEqual(['gradient', 'spotLight', 'solidColor']);
    expect(back.project.layers[0].params.angle).toBe(45);
    expect(back.project.layers[0].params.gradientType).toBe('linear');
  });

  it('is tolerant: defaults, unknown params and unknown layers', () => {
    const json = JSON.stringify({
      schemaVersion: 1,
      layers: [
        { type: 'fresnel', params: { power: 999, bogus: 1 } },
        { type: 'doesNotExist' },
        { type: 'noise', blendMode: 'nonsense' },
      ],
    });
    const r = deserializeProject(json);
    expect(r.project.layers.length).toBe(2);
    expect(r.project.layers[0].params.power).toBe(50);
    expect(r.project.layers[1].blendMode).toBe('multiply');
    expect(r.warnings.map((w) => w.key).sort()).toEqual(['warn.unknownLayer', 'warn.unknownParam']);
  });
});

describe('v3 import', () => {
  const v3 = {
    app_version: '3.0',
    layers: [
      {
        type: 'BaseLayer',
        name: 'Base Layer',
        enabled: true,
        blend_mode: 'Normal',
        opacity: 1.0,
        params: {
          base_color: [0.2, 0.1, 0.05],
          normal_map_path: './assets/nm.png',
          normal_strength: 2.0,
          normal_scale: 1.5,
          normal_offset: [0.1, 0.2],
          preview_mode: 'With Normal Map',
        },
      },
      {
        type: 'SpotLightLayer',
        name: 'Key',
        enabled: true,
        blend_mode: 'Soft Light',
        opacity: 0.5,
        params: { direction: [0.35, -0.22, 1.0], range: 0.13, blur: 1.0, scale_x: 2, scale_y: 0.5, rotation: 30 },
      },
      {
        type: 'GradientLayer',
        name: 'Grad',
        enabled: false,
        blend_mode: 'Multiply',
        params: {
          gradient_stops: [
            { position: 1.0, color: [1, 1, 1] },
            { position: 0.0, color: [0, 0, 0] },
          ],
          angle: 270,
          gradient_type: 'Radial',
        },
      },
      { type: 'FutureLayer', name: 'x', params: {} },
    ],
  };

  it('detects v3 documents', () => {
    expect(isLegacyV3(v3)).toBe(true);
    expect(isLegacyV3({ schemaVersion: 1, layers: [] })).toBe(false);
  });

  it('converts order, names, blend modes, params and the base layer', async () => {
    const pngHeader = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const resolved: string[] = [];
    const r = await importLegacyV3(JSON.stringify(v3), {
      projectDir: 'C:\\proj',
      name: 'old',
      assets: new AssetStore(),
      resolve: async (p) => {
        resolved.push(p);
        return { name: 'nm.png', bytes: pngHeader };
      },
    });
    expect(resolved).toEqual(['C:\\proj\\assets\\nm.png']);
    const types = r.project.layers.map((l) => l.type);
    expect(types).toEqual(['gradient', 'spotLight', 'solidColor']); // reversed, unknown skipped
    const spot = r.project.layers[1];
    expect(spot.blendMode).toBe('softLight');
    expect(spot.opacity).toBe(0.5);
    const d = spot.params.direction as number[];
    const l = Math.hypot(0.35, 0.22, 1);
    expect(d[0]).toBeCloseTo(-0.35 / l);
    expect(d[1]).toBeCloseTo(0.22 / l);
    expect(d[2]).toBeCloseTo(1 / l);
    expect(spot.params.scale).toEqual([2, 0.5]);
    const grad = r.project.layers[0];
    expect(grad.enabled).toBe(false);
    expect(grad.params.gradientType).toBe('radial');
    expect((grad.params.stops as { stops: { pos: number }[] }).stops.map((s) => s.pos)).toEqual([0, 1]);
    expect(r.project.layers[2].params.color).toEqual([0.2, 0.1, 0.05]);
    expect(r.view.split).toBe('compare');
    expect(r.view.normalMap.strength).toBe(2);
    expect(r.view.normalMap.asset).toBeTruthy();
    expect(r.warnings.map((w) => w.key)).toEqual(['warn.unknownLayer']);
  });
});
