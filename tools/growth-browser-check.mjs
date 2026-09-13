// node tools/growth-browser-check.mjs [http://127.0.0.1:8137/]
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { chromium } = await import('playwright').catch(() => import('../logs/browser-tools/node_modules/playwright/index.mjs'));
const executablePath = [process.env.TD_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => p && fs.existsSync(p));
const base = process.argv[2] || 'http://127.0.0.1:8137/';
const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-unsafe-swiftshader'] });
const errors = [], rows = [];
fs.mkdirSync('logs/growth', { recursive: true });
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 720, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 1000 });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.stack));
    page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) errors.push(r.status() + ' ' + r.url()); });
    await page.goto(base + '?level=1,0');
    await page.waitForFunction(() => !!window.__TD_DEBUG?.battle(), { timeout: 75000 });
    assert.equal(await page.locator('.dock-card').count(), 7);
    assert.equal(await page.locator('.dock-card:disabled').count(), 0);
    await page.evaluate(() => {
      const b = window.__TD_DEBUG.battle(); b.gold = 100000; b.hooks.onGold(b.gold);
    });
    for (const key of ['arrow', 'venom', 'beacon']) {
      await page.locator('.dock-card[data-tower="' + key + '"]').click();
      const fixture = await page.evaluate(() => {
        const d = window.__TD_DEBUG, b = d.battle();
        const anchor = b.sampler.at(b.sampler.total * 0.3);
        let best = null, score = Infinity;
        for (let x = 0; x < 42; x++) for (let z = 0; z < 28; z++) {
          if (!b.isBuildable(x, z)) continue;
          const p = b.cellCenter(x, z), distance = p.distanceToSquared(anchor);
          if (distance < score) { score = distance; best = [x,z]; }
        }
        if (!best || b.tryPlace(...best) !== true) throw new Error('Fixture placement failed');
        d.rig.focusAt(anchor.x, anchor.z);
        d.rig.dist = innerWidth < innerHeight ? 24 : 18;
        return { key: b.selectedTower.key, towerId: b.selectedTower.id };
      });
      assert.equal(fixture.key, key);
      for (let i = 0; i < 3; i++) await page.locator('#p-up').click();
      assert.equal(await page.evaluate(() => window.__TD_DEBUG.battle().selectedTower.level), 3);
      assert.equal(await page.locator('.skill-btn').count(), 1);
      const up = await page.locator('#p-up').elementHandle();
      const time = await page.evaluate(() => window.__TD_DEBUG.battle().time);
      await page.waitForFunction((time) => window.__TD_DEBUG.battle().time > time + 0.35, time);
      assert.equal(await up.evaluate((el) => el.isConnected), true, 'cooldown refresh preserves controls');
      await up.click();
      const before = await page.evaluate(() => { const b = window.__TD_DEBUG.battle(); return { gold: b.gold, fee: b.selectedTower.upgradeCost() }; });
      assert.equal(await page.locator('.spec-btn').count(), 2);
      await page.screenshot({ path: 'logs/growth/' + viewport.width + '-' + key + '-specialization.png' });
      await page.locator('.spec-btn[data-branch="B"]').click();
      assert.equal(await page.evaluate(() => window.__TD_DEBUG.battle().paused), true, '专精弹窗必须暂停战斗');
      await page.locator('.spec-choose[data-branch="B"]').click();
      assert.equal(await page.evaluate(() => window.__TD_DEBUG.battle().paused), false, '选择后必须恢复战斗');
      assert.deepEqual(await page.evaluate(() => { const b = window.__TD_DEBUG.battle(); return [b.selectedTower.level, b.selectedTower.specialization, b.gold]; }), [5, 'B', before.gold - before.fee]);
      await page.locator('#p-up').click();
      await page.locator('#p-up').click();
      assert.equal(await page.locator('.skill-btn').count(), 2);
      await page.locator('#p-mode').uncheck();
      assert.equal(await page.evaluate(() => window.__TD_DEBUG.battle().selectedTower.manualUltimate), true);
      await page.locator('#p-mode').press('Space');
      assert.equal(await page.evaluate(() => window.__TD_DEBUG.battle().waveIdx), -1, 'checkbox keyboard activation must not start a wave');
      await page.locator('#p-mode').uncheck();
      await page.waitForFunction(() => [...document.querySelectorAll('#hud-panel img, .dock-card img, .tool-icon')]
        .every((img) => img.complete && img.naturalWidth > 0), { timeout: 15000 });
      const layout = await page.evaluate(() => {
        const rect = (sel) => document.querySelector(sel).getBoundingClientRect();
        const p = rect('#hud-panel');
        const overlap = ['#hud-dock', '#battle-map', '#hud-actions', '#hud-top', '#hud-next'].filter((sel) => {
          const r = rect(sel); return p.left < r.right && p.right > r.left && p.top < r.bottom && p.bottom > r.top;
        });
        const overflow = [...document.querySelectorAll('#hud-panel button, #hud-panel label, .dock-card')]
          .filter((el) => el.scrollWidth > el.clientWidth + 2).map((el) => el.textContent);
        const imgs = [...document.querySelectorAll('#hud-panel img, .dock-card img, .tool-icon')];
        const failedAssets = imgs.filter((img) => !img.complete || img.naturalWidth <= 0)
          .map((img) => img.currentSrc || img.src);
        return { overlap, overflow, inside: p.top >= 0 && p.right <= innerWidth && p.bottom <= innerHeight,
          assets: failedAssets.length === 0, failedAssets,
          invalid: document.querySelector('#hud-panel').textContent.includes('undefined') };
      });
      assert.deepEqual(layout.overlap, [], key + ' panel overlaps');
      assert.deepEqual(layout.overflow, [], key + ' text overflow');
      assert.equal(layout.inside && layout.assets && !layout.invalid, true,
        `${key} invalid layout/assets: ${JSON.stringify(layout)}`);
      await page.screenshot({ path: 'logs/growth/' + viewport.width + '-' + key + '-level8.png' });
      rows.push({ viewport: viewport.width + 'x' + viewport.height, key, ...layout });
    }
    await page.evaluate(async () => {
      const b = window.__TD_DEBUG.battle();
      const { enemyProfile } = await import('./js/game/enemy-stats.js');
      b.state = 'combat'; b.spawnQueue = [{ t: 10000, type: 'grunt', route: 0 }];
      const anchor = b.sampler.total * 0.3;
      for (let i = 0; i < 12; i++) {
        const e = b.spawnEnemy(enemyProfile(i === 11 ? 'flyer' : 'grunt', { enemyLevel: 1 }),
          { groupId: 'browser-fixture', unit: i, bounty: 0, route: 0 });
        e.dist = anchor + i * 0.12; e.sampler.at(e.dist, e.pos); b.enemyIndex.update(e);
        e.hp = e.maxHp = 100000; e.baseSpeed = e.effectiveSpeed = 0.1;
      }
      for (const t of b.towers) { t.manualUltimate = true; t.skillCooldowns.signature = 100; t.skillCooldowns.ultimate = 0; }
      b.selectTower(b.towers.find((t) => t.key === 'venom'));
    });
    await page.waitForFunction(() => !document.querySelector('[data-tier="ultimate"]').disabled);
    await page.locator('[data-tier="ultimate"]').click();
    assert.equal(await page.evaluate(() => window.__TD_DEBUG.battle().fields.length), 1);
    await page.waitForFunction(() => window.__TD_DEBUG.battle().enemies.some((e) => e.hp < e.maxHp), { timeout: 10000 });
    const fieldVisual = await page.evaluate(() => {
      const d = window.__TD_DEBUG, b = d.battle(), field = b.fields[0];
      d.postfx.render(d.scene, d.camera);
      const gl = d.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4); gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);
      let nonblack = 0, n = 0; const colors = new Set();
      for (let i = 0; i < px.length; i += 256) { if (px[i] + px[i+1] + px[i+2] > 45) nonblack++; colors.add((px[i] >> 4) + ',' + (px[i+1] >> 4) + ',' + (px[i+2] >> 4)); n++; }
      field.mesh.visible = false;
      d.postfx.render(d.scene, d.camera);
      const without = new Uint8Array(px.length); gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,without);
      let fieldPixels = 0;
      for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - without[i]) + Math.abs(px[i+1] - without[i+1]) + Math.abs(px[i+2] - without[i+2]) > 8) fieldPixels++;
      field.mesh.visible = true;
      d.postfx.render(d.scene, d.camera);
      const projected = field.mesh.position.clone().project(d.camera);
      return { nonblack: nonblack / n, colors: colors.size, fieldPixels, fieldVisible: field.mesh.parent === d.scene && Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1,
        models: b.towers.every((t) => t.mesh.userData.tier4.visible && t.mesh.userData.tier8.visible), poison: b.enemies.filter((e) => e.effects.poison).length };
    });
    assert.ok(fieldVisual.nonblack > 0.55 && fieldVisual.colors > 35 && fieldVisual.fieldPixels > 20 && fieldVisual.fieldVisible && fieldVisual.models && fieldVisual.poison > 0, JSON.stringify(fieldVisual));
    rows.push({ viewport: viewport.width + 'x' + viewport.height, key: 'field', ...fieldVisual });
    await page.screenshot({ path: 'logs/growth/' + viewport.width + '-poison-cloud.png' });
    await page.locator('#btn-pause').click();
    const paused = await page.evaluate(() => { const b = window.__TD_DEBUG.battle(); return { paused: b.paused, time: b.time, hp: b.enemies.map((e) => e.hp), remain: b.fields[0].remaining }; });
    assert.equal(paused.paused, true);
    await page.evaluate(() => new Promise((resolve) => { let count = 0; const frame = () => ++count >= 20 ? resolve() : requestAnimationFrame(frame); requestAnimationFrame(frame); }));
    assert.deepEqual(await page.evaluate(() => { const b = window.__TD_DEBUG.battle(); return { paused: b.paused, time: b.time, hp: b.enemies.map((e) => e.hp), remain: b.fields[0].remaining }; }), paused);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.__TD_DEBUG.battle().paused), false);
    await page.locator('#p-sell').click();
    assert.equal(await page.evaluate(() => window.__TD_DEBUG.battle().fields.length), 0);
    await page.evaluate(() => {
      const b = window.__TD_DEBUG.battle(); b.selectTower(b.towers.find((t) => t.key === 'beacon'));
      b.selectedTower.skillCooldowns.ultimate = 0;
    });
    await page.waitForFunction(() => !document.querySelector('[data-tier="ultimate"]').disabled);
    await page.locator('[data-tier="ultimate"]').click();
    assert.equal(await page.evaluate(() => window.__TD_DEBUG.battle().towers.find((t) => t.key === 'arrow').timedBuffs.length), 1);
    await page.locator('#p-sell').click();
    assert.equal(await page.evaluate(() => window.__TD_DEBUG.battle().towers[0].timedBuffs.length), 0);
    await page.evaluate(() => window.__TD_ENTER(0, 0));
    assert.equal(await page.locator('.dock-card:disabled').count(), 2);
    assert.equal(await page.evaluate(() => window.__TD_DEBUG.battle().towers.length), 0);
    await context.close();
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync('logs/growth/browser-results.json', JSON.stringify({ rows, errors }, null, 2));
  console.table(rows);
  console.log('PASS: growth, specialization fees, stable controls, auto/manual mode, poison cloud, pause, support cleanup and viewport/canvas checks');
} finally { await browser.close(); }
