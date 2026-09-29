import { afterEach, expect, test, vi } from 'vitest';
import { createWebPlatform } from '../../src/platform/web';
import { unzipSync, strFromU8 } from 'fflate';

afterEach(() => vi.unstubAllGlobals());
const filters = [{ name: 'Project', extensions: ['mcproj'] }];
const bundle = { projectJson: '{"layers":[]}', assets: [] };

function nativePicker() {
  let bytes = new Uint8Array();
  const write = vi.fn(async (value: Uint8Array) => { bytes = new Uint8Array(value); });
  const close = vi.fn(async () => {});
  const abort = vi.fn(async () => {});
  const handle = {
    name: 'project.mcproj',
    getFile: async () => new File([bytes], 'project.mcproj'),
    createWritable: async () => ({ write, close, abort }),
  };
  const open = vi.fn(async () => [handle]);
  const save = vi.fn(async () => handle);
  vi.stubGlobal('window', { showOpenFilePicker: open, showSaveFilePicker: save });
  return { open, save, write, close, abort };
}

test('save and open retain opaque handles for overwrite without reopening a picker', async () => {
  const io = nativePicker();
  const platform = createWebPlatform();
  const path = (await platform.pickSavePath('project.mcproj', filters))!;
  await platform.saveProject(path, bundle);
  await platform.saveProject(path, { ...bundle, projectJson: '{"layers":[1]}' });
  expect(io.save).toHaveBeenCalledTimes(1);
  expect(io.close).toHaveBeenCalledTimes(2);
  const picked = (await platform.pickOpenFile(filters))!;
  expect(strFromU8(unzipSync(picked.bytes)['project.json'])).toBe('{"layers":[1]}');
  await platform.saveProject(picked.path!, bundle);
  expect(io.open).toHaveBeenCalledTimes(1);
  expect(io.write).toHaveBeenCalledTimes(3);
});

test('cancel does not download; failed writes reject without pretending to save', async () => {
  const io = nativePicker();
  io.save.mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'));
  const platform = createWebPlatform();
  expect(await platform.pickSavePath('project.mcproj', filters)).toBeNull();
  const path = (await platform.pickSavePath('project.mcproj', filters))!;
  io.write.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
  await expect(platform.saveProject(path, bundle)).rejects.toThrow('Denied');
  expect(io.abort).toHaveBeenCalledTimes(1);
  expect(io.close).not.toHaveBeenCalled();
});

test('storage failure retains settings and presets in memory and notifies once', async () => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('indexedDB', { open() { throw new Error('denied'); } });
  vi.stubGlobal('localStorage', { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } });
  vi.stubGlobal('navigator', {});
  const platform = createWebPlatform();
  const notices = vi.fn();
  await platform.initialize(notices);
  expect(platform.caps.persistentStorage).toBe(false);
  await platform.settingsSave('settings');
  expect(await platform.settingsLoad()).toBe('settings');
  await platform.saveProject('presets/example.mcproj', bundle);
  expect(await platform.presetsList()).toEqual([{ name: 'example', path: 'presets/example.mcproj', modified: 0 }]);
  expect(await platform.loadProject({ path: 'presets/example.mcproj' })).toMatchObject(bundle);
  expect(notices.mock.calls.filter(([notice]) => notice === 'storageUnavailable')).toHaveLength(1);
});
