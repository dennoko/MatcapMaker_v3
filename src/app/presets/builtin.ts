// Bundled presets. Project presets double as "new project" templates.

import { createEmptyProject, createLayer, normalizeDir } from './presetUtil';
import type { Project } from '$core/model/types';

export interface LayerPreset {
  id: string;
  name: string;
  type: string;
  params: Record<string, unknown>;
}

export const LAYER_PRESETS: LayerPreset[] = [
  { id: 'softKey', name: 'Soft key light', type: 'spotLight', params: { range: 0.2, blur: 0.8, direction: normalizeDir([-0.4, 0.45, 0.8]) } },
  { id: 'hardSpec', name: 'Sharp highlight', type: 'spotLight', params: { range: 0.05, blur: 0.02, intensity: 1.2, direction: normalizeDir([-0.35, 0.4, 0.85]) } },
  { id: 'stripLight', name: 'Strip light', type: 'spotLight', params: { range: 0.08, blur: 0.05, scale: [3, 0.25], rotation: 20, direction: normalizeDir([0, 0.5, 0.86]) } },
  { id: 'warmRim', name: 'Warm rim', type: 'fresnel', params: { color: [1, 0.55, 0.25], power: 3, intensity: 1.2 } },
  { id: 'coolRim', name: 'Cool rim', type: 'fresnel', params: { color: [0.35, 0.6, 1], power: 4 } },
  {
    id: 'skyGround',
    name: 'Sky / ground',
    type: 'gradient',
    params: { stops: { stops: [{ pos: 0, color: [0.25, 0.2, 0.15] }, { pos: 0.5, color: [0.5, 0.5, 0.5] }, { pos: 1, color: [0.75, 0.85, 1] }], interp: 'oklab' }, angle: 90 },
  },
  { id: 'grain', name: 'Grain', type: 'noise', params: { noiseType: 'white', scale: 3, intensity: 0.15 } },
  { id: 'clouds', name: 'Soft clouds', type: 'noise', params: { noiseType: 'simplex', scale: 1.5, intensity: 0.4 } },
];

export interface ProjectPreset {
  id: string;
  name: string;
  build: () => Project;
}

function project(name: string, layers: ReturnType<typeof createLayer>[]): Project {
  const p = createEmptyProject(name);
  p.layers = layers;
  return p;
}

export const PROJECT_PRESETS: ProjectPreset[] = [
  {
    id: 'default',
    name: 'Basic',
    build: () =>
      project('Basic', [
        createLayer('spotLight', { range: 0.13, blur: 1.0, direction: normalizeDir([-0.35, 0.22, 1]) }),
        createLayer('solidColor', { color: [0, 0, 0] }, 'Base'),
      ]),
  },
  {
    id: 'metal',
    name: 'Metal',
    build: () =>
      project('Metal', [
        createLayer('spotLight', { range: 0.04, blur: 0.03, intensity: 1, direction: normalizeDir([-0.45, 0.5, 0.74]) }, 'Specular'),
        createLayer('spotLight', { range: 0.1, blur: 0.08, scale: [3, 0.3], rotation: 0, color: [0.8, 0.85, 0.9], intensity: 0.6, direction: normalizeDir([0, 0.55, 0.83]) }, 'Horizon strip'),
        createLayer('fresnel', { color: [0.9, 0.95, 1], power: 2.5, intensity: 0.8 }),
        createLayer(
          'gradient',
          {
            stops: {
              stops: [
                { pos: 0, color: [0.08, 0.07, 0.06] },
                { pos: 0.45, color: [0.35, 0.36, 0.38] },
                { pos: 0.55, color: [0.12, 0.12, 0.13] },
                { pos: 1, color: [0.75, 0.8, 0.85] },
              ],
              interp: 'rgb',
            },
            angle: 90,
          },
          'Environment',
        ),
      ]),
  },
  {
    id: 'plastic',
    name: 'Plastic',
    build: () =>
      project('Plastic', [
        createLayer('spotLight', { range: 0.06, blur: 0.05, intensity: 0.9, direction: normalizeDir([-0.4, 0.45, 0.8]) }, 'Specular'),
        createLayer('spotLight', { range: 0.45, blur: 0.9, color: [0.95, 0.35, 0.3], intensity: 0.8, direction: normalizeDir([-0.3, 0.3, 0.9]) }, 'Diffuse'),
        createLayer('fresnel', { color: [1, 0.8, 0.8], power: 3, intensity: 0.4 }),
        createLayer('solidColor', { color: [0.35, 0.05, 0.04] }, 'Base'),
      ]),
  },
  {
    id: 'skin',
    name: 'Skin',
    build: () =>
      project('Skin', [
        createLayer('spotLight', { range: 0.12, blur: 0.5, intensity: 0.25, direction: normalizeDir([-0.35, 0.4, 0.85]) }, 'Sheen'),
        createLayer('fresnel', { color: [1, 0.45, 0.35], power: 2, intensity: 0.5 }, 'Subsurface rim'),
        createLayer('spotLight', { range: 0.6, blur: 1, color: [1, 0.82, 0.72], intensity: 1, direction: normalizeDir([-0.25, 0.3, 0.92]) }, 'Key'),
        createLayer('solidColor', { color: [0.42, 0.2, 0.16] }, 'Base'),
      ]),
  },
  {
    id: 'toon',
    name: 'Toon',
    build: () =>
      project('Toon', [
        createLayer('spotLight', { range: 0.05, blur: 0, intensity: 1, direction: normalizeDir([-0.45, 0.45, 0.77]) }, 'Highlight'),
        createLayer('spotLight', { range: 0.55, blur: 0, color: [1, 0.85, 0.6], intensity: 1, direction: normalizeDir([-0.3, 0.35, 0.89]) }, 'Lit'),
        createLayer('fresnel', { color: [0.3, 0.2, 0.5], power: 6, intensity: 1 }, 'Outline'),
        createLayer('solidColor', { color: [0.45, 0.3, 0.5] }, 'Shadow'),
      ]),
  },
  {
    id: 'glass',
    name: 'Glass',
    build: () =>
      project('Glass', [
        createLayer('spotLight', { range: 0.03, blur: 0.02, intensity: 1, direction: normalizeDir([-0.45, 0.55, 0.7]) }, 'Glint'),
        createLayer('spotLight', { range: 0.08, blur: 0.1, scale: [0.4, 2.5], intensity: 0.5, direction: normalizeDir([0.5, 0.2, 0.84]) }, 'Window'),
        createLayer('fresnel', { color: [0.7, 0.9, 1], power: 1.6, intensity: 1 }),
        createLayer('solidColor', { color: [0.02, 0.05, 0.08] }, 'Base'),
      ]),
  },
  {
    id: 'clay',
    name: 'Clay',
    build: () =>
      project('Clay', [
        createLayer('noise', { noiseType: 'simplex', scale: 6, intensity: 0.08 }, 'Grain'),
        createLayer('spotLight', { range: 0.7, blur: 1, color: [1, 0.95, 0.9], intensity: 0.9, direction: normalizeDir([-0.3, 0.4, 0.87]) }, 'Key'),
        createLayer('solidColor', { color: [0.3, 0.26, 0.24] }, 'Base'),
      ]),
  },
];
