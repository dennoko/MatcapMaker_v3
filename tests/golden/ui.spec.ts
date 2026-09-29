import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../../src/platform/pngEncode';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '__output__');
mkdirSync(OUT, { recursive: true });

// 4x4 red PNG
const RED_PNG = Buffer.from(encodePng(new Uint8Array(16 * 4).fill(255).map((v, i) => (i % 4 === 1 || i % 4 === 2 ? 0 : v)), 4, 4, 8)).toString('base64');

async function boot(page: Page, errors: string[]) {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setViewportSize({ width: 1400, height: 860 });
  if (test.info().project.name === 'single') {
    await page.route(/^https?:/, (route) => route.abort());
    await page.addInitScript(() => localStorage.setItem('matcap-maker:settings', JSON.stringify({ checkUpdates: false })));
  }
  await page.goto(test.info().project.metadata.appURL as string);
  await expect(page.locator('.menubar')).toBeVisible();
}

test('mesh preview presents visible pixels without WebGL errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (/GL_INVALID|GL_OUT_OF_MEMORY/.test(m.text())) errors.push(m.text());
  });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    (HTMLCanvasElement.prototype as any).getContext = function (...args: any[]) {
      const gl = original.apply(this, args as any) as WebGL2RenderingContext | null;
      if (args[0] === 'webgl2' && gl && !(gl as any).__captureMesh) {
        (gl as any).__captureMesh = true;
        let resolvedMesh = false;
        const blit = gl.blitFramebuffer.bind(gl);
        gl.blitFramebuffer = (...values) => {
          blit(...values);
          resolvedMesh = true;
        };
        const draw = gl.drawArrays.bind(gl);
        gl.drawArrays = (...values) => {
          draw(...values);
          if (resolvedMesh && gl.getParameter(gl.FRAMEBUFFER_BINDING) === null && gl.drawingBufferWidth > 1) {
            resolvedMesh = false;
            const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
            gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            const reds = new Set<number>();
            for (let i = 0; i < pixels.length; i += 4) reds.add(pixels[i]);
            (window as any).__previewColors = reds.size;
            (window as any).__previewError = gl.getError();
          }
        };
      }
      return gl;
    };
  });
  await boot(page, errors);
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await page.locator('select').filter({ has: page.locator('option[value="mesh"]') }).selectOption('mesh');
  await expect.poll(() => page.evaluate(() => (window as any).__previewColors)).toBeGreaterThan(3);
  expect(await page.evaluate(() => (window as any).__previewError)).toBe(0);
  expect(errors).toEqual([]);
});

test('first run shows the tour, then the app edits without errors', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  await expect(page.getByRole('dialog', { name: /Welcome/ })).toBeVisible();
  await page.screenshot({ path: join(OUT, 'ui-tour.png') });
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.locator('[data-row]')).toHaveCount(2);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'ui-initial.png') });

  // add a layer via the palette
  await page.keyboard.press('Tab');
  await page.keyboard.type('fresnel');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-row]')).toHaveCount(3);

  // undo / redo
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-row]')).toHaveCount(2);
  await page.keyboard.press('Control+y');
  await expect(page.locator('[data-row]')).toHaveCount(3);

  // select the fresnel layer and scrub a number field
  await page.locator('[data-row]').first().click();
  const scrub = page.locator('.inspector .scrub').nth(1);
  const box = (await scrub.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  // views
  for (const k of ['2', '3', '4', '1']) await page.keyboard.press(k);
  await page.keyboard.press('4');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, 'ui-compare.png') });
  await page.keyboard.press('4');

  // export dialog
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'ui-export.png') });
  await page.keyboard.press('Escape');

  // Japanese UI
  await page.keyboard.press('Control+,');
  await page.getByRole('radio', { name: '日本語' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.menubar')).toContainText('ファイル');
  await page.screenshot({ path: join(OUT, 'ui-ja.png') });

  expect(errors).toEqual([]);
});

test('spot light gizmo drags the highlight as one undo step', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.locator('[data-row]').first().click(); // Spot Light
  const handle = page.locator('.gizmos .h.dir');
  await expect(handle).toBeVisible();
  const before = await page.locator('.inspector').innerText();
  const hb = (await handle.boundingBox())!;
  const cx = hb.x + hb.width / 2;
  const cy = hb.y + hb.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 90, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, 'ui-gizmo.png') });
  expect(await page.locator('.inspector').innerText()).not.toEqual(before);
  // exactly one history entry for the whole drag
  await expect(page.locator('.status .step')).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.status .step.cur')).toHaveText(/Opened/);
  expect(errors).toEqual([]);
});

test('dropping an image onto the preview adds an Image layer', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  await page.getByRole('button', { name: 'Skip' }).click();
  const dt = await page.evaluateHandle((b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const d = new DataTransfer();
    d.items.add(new File([bin], 'red.png', { type: 'image/png' }));
    return d;
  }, RED_PNG);
  const vp = page.locator('[data-drop-zone="viewport"]');
  const b = (await vp.boundingBox())!;
  await page.dispatchEvent('[data-drop-zone="viewport"]', 'drop', { dataTransfer: dt, clientX: b.x + 50, clientY: b.y + 50 });
  await expect(page.locator('[data-row]')).toHaveCount(3);
  await expect(page.locator('[data-row]').first()).toContainText('red');
  expect(errors).toEqual([]);
});
