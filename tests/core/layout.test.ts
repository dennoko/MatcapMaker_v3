import { describe, expect, it } from 'vitest';
import { computeLayout, inRect } from '../../src/render/preview/layout';
import { defaultViewState } from '../../src/core/model/project';
import type { ViewState } from '../../src/core/model/types';

const view = (v: Partial<ViewState>): ViewState => ({ ...defaultViewState(), ...v });

describe('preview layout', () => {
  it('fills the viewport with the mesh in single mode', () => {
    const l = computeLayout(800, 600, view({ previewShape: 'mesh', split: 'single' }));
    expect(l.mesh).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });

  it('puts a sphere on the left and the mesh on the right in compare mode', () => {
    const l = computeLayout(800, 600, view({ previewShape: 'mesh', split: 'compare' }));
    expect(l.discs).toHaveLength(1);
    expect(l.discs[0]).toMatchObject({ cx: 200, cy: 300, shape: 0 });
    expect(l.mesh).toEqual({ x: 400, y: 0, w: 400, h: 600 });
    expect(inRect(l.mesh!, 500, 300)).toBe(true);
    expect(inRect(l.mesh!, 200, 300)).toBe(false);
  });

  it('keeps the normal-map compare without a mesh', () => {
    const l = computeLayout(800, 600, view({ previewShape: 'sphere', split: 'compare' }));
    expect(l.mesh).toBeNull();
    expect(l.discs.map((d) => d.shape)).toEqual([0, 2]);
  });
});
