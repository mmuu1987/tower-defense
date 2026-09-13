import test from 'node:test';
import assert from 'node:assert/strict';
import { save } from '../js/core/save.js';
import { mutePresentation } from '../js/ui/hud-lite.js';

test('saved mute state has matching HUD text and icon', () => {
  assert.deepEqual(mutePresentation(true), { title: '取消静音', icon: 'volume-x' });
  assert.deepEqual(mutePresentation(false), { title: '静音', icon: 'volume-2' });
});

test('save loading normalizes corrupt and out-of-range local data', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem() {
      return JSON.stringify({
        v: 999,
        levels: { '0,0': 9, '4,9': '2', '5,0': 3, bad: '<script>' },
        settings: { volume: 7, muted: 'yes', quality: 'ultra' },
        tutorialDone: 1,
        admin: 0,
      });
    },
    setItem() {},
  } });
  try {
    save.load();
    assert.deepEqual(save.data.levels, { '0,0': 3, '4,9': 2 });
    assert.deepEqual(save.data.settings, { volume: 1, muted: true, quality: 'high' });
    assert.equal(save.data.v, 1);
    assert.equal(save.data.tutorialDone, true);
    assert.equal(save.data.admin, false);
  } finally {
    if (original === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, 'localStorage', original);
  }
});
