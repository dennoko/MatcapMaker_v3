import { test, type Page } from '@playwright/test';

async function open(page: Page) {
  await page.goto('/tests/golden/harness.html');
  await page.waitForFunction(() => (window as unknown as { mmReady?: boolean }).mmReady === true);
}

import { writeFileSync } from 'node:fs';

test('debug padding edge values', async ({ page }) => {
  await open(page);
  const S = 256;
  
  // Basic preset
  const basic = JSON.stringify({
    schemaVersion: 1,
    layers: [
      { type: 'spotLight', params: { range: 0.13, blur: 1.0, direction: [-0.35, 0.22, 1] } },
      { type: 'solidColor', params: { color: [0, 0, 0] } }
    ]
  });
  
  // Metal preset
  const metal = JSON.stringify({
    schemaVersion: 1,
    layers: [
      { type: 'spotLight', params: { range: 0.04, blur: 0.03, intensity: 1, direction: [-0.45, 0.5, 0.74] } },
      { type: 'spotLight', params: { range: 0.1, blur: 0.08, scale: [3, 0.3], rotation: 0, color: [0.8, 0.85, 0.9], intensity: 0.6, direction: [0, 0.55, 0.83] } },
      { type: 'fresnel', params: { color: [0.9, 0.95, 1], power: 2.5, intensity: 0.8 } },
      {
        type: 'gradient',
        params: {
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
      }
    ]
  });

  const rBasic = await page.evaluate(([j, s, p]) => (window as any).mm.render(j, s, p, 'png8', 'transparent'), [basic, S, 16] as const);
  if (rBasic.png) {
    writeFileSync('tests/golden/__output__/debug_basic.png', Buffer.from(rBasic.png, 'base64'));
  }

  const rMetal = await page.evaluate(([j, s, p]) => (window as any).mm.render(j, s, p, 'png8', 'transparent'), [metal, S, 16] as const);
  if (rMetal.png) {
    writeFileSync('tests/golden/__output__/debug_metal.png', Buffer.from(rMetal.png, 'base64'));
  }
});
