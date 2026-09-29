import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '__output__');
mkdirSync(OUT, { recursive: true });

// Smoke test of the real app shell in a browser (web platform).
test('app boots, renders and edits without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setViewportSize({ width: 1400, height: 860 });
  await page.goto('/');
  await expect(page.locator('.menubar')).toBeVisible();
  await expect(page.locator('[data-row]')).toHaveCount(2);
  await page.waitForTimeout(500);
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

  // switch views
  for (const k of ['2', '3', '4', '1']) await page.keyboard.press(k);
  await page.keyboard.press('4');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, 'ui-compare.png') });
  await page.keyboard.press('4');

  // open dialogs
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
