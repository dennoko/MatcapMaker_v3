import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';

async function boot(page: Page) {
  await page.route(/^https?:/, (route) => route.abort());
  // Exercise the download fallback even when Chromium exposes native pickers.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined });
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
  });
  await page.goto(test.info().project.metadata.appURL as string);
  await expect(page.locator('.menubar')).toBeVisible();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
}

test('portable PNG export works offline', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await boot(page);
  await page.keyboard.press('Control+Shift+E');
  await page.getByRole('button', { name: '256', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: /Export/, exact: false }).last().click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.png$/);
  expect([...readFileSync((await file.path())!).subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(errors).toEqual([]);
});

test('project download roundtrip and recovery survive reload', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Tab');
  await page.keyboard.type('fresnel');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-row]')).toHaveCount(3);
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const file = await download;
  const zip = readFileSync((await file.path())!);
  const doc = JSON.parse(strFromU8(unzipSync(zip)['project.json']));
  expect(doc.layers).toHaveLength(3);
  await page.keyboard.press('Control+n');
  await expect(page.locator('[data-row]')).toHaveCount(2);
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+o');
  await (await chooser).setFiles({ name: 'roundtrip.mcproj', mimeType: 'application/zip', buffer: zip });
  await expect(page.locator('[data-row]')).toHaveCount(3);
  await page.keyboard.press('Control+d');
  await expect(page.locator('[data-row]')).toHaveCount(4);
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('matcap-maker', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const read = req.result.transaction('kv').objectStore('kv').get('file:recovery');
      read.onsuccess = () => { resolve(!!read.result); req.result.close(); };
    };
  }))).toBe(true);
  page.on('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole('dialog', { name: /Recover/ })).toBeVisible();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.locator('[data-row]')).toHaveCount(4);
});

test('storage denial stays usable and warns once', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('Denied', 'SecurityError'); } });
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Denied', 'SecurityError'); } });
  });
  await boot(page);
  await expect(page.getByText('Settings, autosaves and presets will not persist', { exact: false })).toHaveCount(1);
  await page.keyboard.press('Tab');
  await page.keyboard.type('fresnel');
  await page.keyboard.press('Enter');
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  expect((await download).suggestedFilename()).toMatch(/\.mcproj$/);
});

test('a second tab cannot clear the first tab recovery', async ({ page, context }) => {
  await boot(page);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(2600);
  const second = await context.newPage();
  await second.route(/^https?:/, (route) => route.abort());
  await second.goto(test.info().project.metadata.appURL as string);
  await expect(second.getByText('Another tab owns recovery data', { exact: false })).toBeVisible();
  await expect(second.getByRole('dialog', { name: /Recover/ })).toHaveCount(0);
  await second.close();
  page.on('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole('dialog', { name: /Recover/ })).toBeVisible();
});

test('missing WebGL2 displays guidance', async ({ page }) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      return type === 'webgl2' ? null : Reflect.apply(get, this, [type, ...args]);
    } as typeof get;
  });
  await page.goto(test.info().project.metadata.appURL as string);
  await expect(page.getByRole('heading', { name: 'Matcap Maker — WebGL2' })).toBeVisible();
});
