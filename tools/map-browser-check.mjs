// npm install --no-save --prefix logs/browser-tools playwright
// node tools/map-browser-check.mjs [http://127.0.0.1:8137/]
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { chromium } = await import('playwright').catch(() => import('../logs/browser-tools/node_modules/playwright/index.mjs'));
const executablePath = [process.env.TD_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => p && fs.existsSync(p));
const base = process.argv[2] || 'http://127.0.0.1:8137/';
const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-unsafe-swiftshader'] });
const errors = [], rows = [];
fs.mkdirSync('logs/maps', { recursive: true });
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 720, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 1000 });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.stack));
    page.on('response', (r) => {
      if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) errors.push(r.status() + ' ' + r.url());
    });
    await page.goto(base + '?level=0,0');
    await page.waitForFunction(() => !!window.__TD_DEBUG?.battle(), { timeout: 75000 });
    if (await page.locator('#tut-skip').isVisible()) await page.locator('#tut-skip').click();
    for (const [w, l] of [[0,0], [0,3], [1,3], [2,5], [2,9], [3,7], [3,9], [4,8], [4,9]]) {
      await page.evaluate(([world, level]) => window.__TD_ENTER(world, level), [w, l]);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const data = await page.evaluate(() => {
        const d = window.__TD_DEBUG, t = d.terrain(), b = d.battle();
        d.postfx.render(d.scene, d.camera);
        const gl = d.renderer.getContext();
        const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let bright = 0, sum = 0, sum2 = 0, n = 0;
        const colors = new Set();
        for (let y = Math.floor(height * 0.2); y < height * 0.8; y += 5) for (let x = Math.floor(width * 0.15); x < width * 0.85; x += 5) {
          const i = (y * width + x) * 4, v = (pixels[i] + pixels[i+1] + pixels[i+2]) / 3;
          if (v > 15) bright++;
          sum += v; sum2 += v * v; n++;
          colors.add((pixels[i] >> 4) * 256 + (pixels[i+1] >> 4) * 16 + (pixels[i+2] >> 4));
        }
        const samples = t.routes.flat().map((p) => b.cellCenter(0,0).set(p.x,0,p.z).project(d.camera));
        let finite = true, meshes = 0;
        t.group.traverse((o) => {
          if (o.isMesh) meshes++;
          const p = o.geometry?.attributes.position;
          if (p) for (const value of p.array) if (!Number.isFinite(value)) finite = false;
        });
        const motes = t.group.getObjectByName('snowfall') || t.group.getObjectByName('embers') ||
          t.group.getObjectByName('sand-drift') || t.group.getObjectByName('ambient-motes');
        const before = Array.from(motes.geometry.attributes.position.array.slice(0,9));
        t.update(123);
        const after = Array.from(motes.geometry.attributes.position.array.slice(0,9));
        const deck = t.group.getObjectByName('bridge-decks');
        const inverseDecks = [];
        for (let i = 0; i < deck.count; i++) {
          const matrix = deck.matrix.clone();
          deck.getMatrixAt(i, matrix);
          inverseDecks.push(matrix.premultiply(deck.matrixWorld).invert());
        }
        const deckGaps = t.routes.flat().filter((p) => {
          if (t.waterDistance(p.x, p.z) >= 0.4) return false;
          return !inverseDecks.some((inverse) => {
            const local = b.cellCenter(0,0).set(p.x,-0.025,p.z).applyMatrix4(inverse);
            return Math.abs(local.x) < 0.61 && Math.abs(local.z) < 0.61;
          });
        }).length;
        return { id: t.map.id, size: [t.halfW * 2,t.halfH * 2], routes: b.samplers.length, bright: bright / n, colors: colors.size,
          deviation: Math.sqrt(sum2/n - (sum/n)**2), finite, meshes,
          maxX: Math.max(...samples.map((p) => Math.abs(p.x))), maxY: Math.max(...samples.map((p) => Math.abs(p.y))),
          bridges: t.group.getObjectByName('bridge-decks')?.count ?? 0,
          decor: t.decor.group.children.length, animated: JSON.stringify(before) !== JSON.stringify(after),
          deckGaps, textures: d.renderer.info.memory.textures, geometry: d.renderer.info.memory.geometries };
      });
      assert.ok(data.finite, data.id + ' finite geometry');
      assert.deepEqual(data.size, [42,28]);
      // Low-saturation frost scenes can quantize to exactly 35 sampled color buckets.
      assert.ok(data.bright > 0.55 && data.colors >= 35 && data.deviation > 8, JSON.stringify(data));
      assert.ok(data.maxX < 1 && data.maxY < 0.94, 'route framing ' + JSON.stringify(data));
      assert.ok(data.bridges > 0 && data.decor > 15 && data.animated, 'landscape assets ' + JSON.stringify(data));
      assert.equal(data.deckGaps, 0, 'continuous bridge deck ' + data.id);
      await page.screenshot({ path: 'logs/maps/' + viewport.width + '-' + data.id + '.png' });
      rows.push({ viewport: viewport.width + 'x' + viewport.height, ...data });
    }
    // Test real pointer placement against the raised ground mesh.
    await page.evaluate(() => window.__TD_ENTER(3, 9));
    const hudOverlaps = await page.evaluate(() => {
      const map = document.querySelector('#battle-map').getBoundingClientRect();
      return ['#hud-dock','#hud-actions','#hud-top','#hud-next'].filter((selector) => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.left < map.right && box.right > map.left
          && box.top < map.bottom && box.bottom > map.top;
      });
    });
    assert.deepEqual(hudOverlaps, [], 'minimap must not overlap battle controls');
    await page.waitForFunction(() => {
      const canvas = document.querySelector('#battle-map-canvas');
      const pixels = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      const colors = new Set();
      for (let i = 0; i < pixels.length; i += 64) colors.add(pixels[i] * 65536 + pixels[i+1] * 256 + pixels[i+2]);
      return colors.size > 20;
    });
    const overviewDistance = await page.evaluate(() => window.__TD_DEBUG.rig.dist);
    await page.locator('#map-zoom-in').click();
    assert.ok(await page.evaluate((d) => window.__TD_DEBUG.rig.dist < d, overviewDistance));
    await page.locator('#map-zoom-out').click();
    assert.ok(await page.evaluate((d) => Math.abs(window.__TD_DEBUG.rig.dist-d) < 0.001, overviewDistance));
    await page.locator('#map-zoom-in').focus();
    await page.keyboard.press('Enter');
    assert.ok(await page.evaluate((d) => Math.abs(window.__TD_DEBUG.rig.dist-d*0.8) < 0.001, overviewDistance));
    await page.locator('#map-zoom-out').focus();
    await page.keyboard.press('Space');
    assert.ok(await page.evaluate((d) => Math.abs(window.__TD_DEBUG.rig.dist-d) < 0.001, overviewDistance));
    await page.locator('#map-overview').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.__TD_DEBUG.battle().waveIdx), -1, 'navigation buttons must not start waves');
    const narrowViewport = { width: viewport.width < viewport.height ? Math.round(viewport.width * 0.85) : viewport.height + 20, height: viewport.height };
    await page.setViewportSize(narrowViewport);
    await page.waitForFunction(() => Math.abs(window.__TD_DEBUG.camera.aspect - innerWidth/innerHeight) < 0.001);
    assert.ok(await page.evaluate((d) => window.__TD_DEBUG.rig.overviewDistance > d, overviewDistance), 'same-orientation resize updates full-map fit');
    assert.ok(await page.evaluate(() => {
      const d = window.__TD_DEBUG;
      return d.terrain().routes.flat().every((p) => {
        const point = d.battle().cellCenter(0,0).set(p.x,0,p.z).project(d.camera);
        return Math.abs(point.x) < 1 && Math.abs(point.y) < 0.94;
      });
    }), 'resized overview keeps every route visible');
    await page.setViewportSize(viewport);
    await page.waitForFunction(() => Math.abs(window.__TD_DEBUG.camera.aspect - innerWidth/innerHeight) < 0.001);
    const minimap = await page.locator('#battle-map-canvas').boundingBox();
    const mx = minimap.x + minimap.width * 0.78, my = minimap.y + minimap.height * 0.72;
    if (viewport.width < 1000) await page.touchscreen.tap(mx,my);
    else await page.mouse.click(mx,my);
    assert.ok(await page.evaluate((d) => { const rig = window.__TD_DEBUG.rig; return rig.cur.focus.x > 8 && rig.cur.focus.z > 4 && rig.dist < d; }, overviewDistance));
    const sector = await page.evaluate(() => { const r = window.__TD_DEBUG.rig; return [r.cur.focus.x,r.cur.focus.z,r.dist]; });
    await page.setViewportSize(narrowViewport);
    await page.waitForFunction(() => Math.abs(window.__TD_DEBUG.camera.aspect - innerWidth/innerHeight) < 0.001);
    assert.deepEqual(await page.evaluate(() => { const r = window.__TD_DEBUG.rig; return [r.cur.focus.x,r.cur.focus.z,r.dist]; }), sector, 'resize preserves the inspected sector');
    await page.setViewportSize(viewport);
    await page.waitForFunction(() => Math.abs(window.__TD_DEBUG.camera.aspect - innerWidth/innerHeight) < 0.001);
    await page.waitForFunction(() => Math.abs(window.__TD_DEBUG.rig.cur.dist - window.__TD_DEBUG.rig.dist) < 0.1);
    await page.screenshot({ path: 'logs/maps/' + viewport.width + '-sector.png' });
    await page.locator('#map-overview').click();
    assert.ok(await page.evaluate((d) => { const rig=window.__TD_DEBUG.rig; return rig.cur.focus.x === 0 && Math.abs(rig.dist-d) < 0.001; }, overviewDistance));
    await page.locator('#battle-map-canvas').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => window.__TD_DEBUG.rig.cur.focus.x), 2);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.__TD_DEBUG.battle().waveIdx), -1);
    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    await page.waitForFunction(() => Math.abs(window.__TD_DEBUG.camera.aspect - innerWidth/innerHeight) < 0.001);
    await page.setViewportSize(viewport);
    await page.waitForFunction(() => Math.abs(window.__TD_DEBUG.camera.aspect - innerWidth/innerHeight) < 0.001);
    await page.locator('.dock-card').first().click();
    assert.deepEqual(await page.evaluate(() => {
      const scene = window.__TD_DEBUG.scene;
      const ring = scene.getObjectByName('tower-range-ring');
      const disc = scene.getObjectByName('tower-range-disc');
      return [ring?.material.depthTest, disc?.material.depthTest, ring?.renderOrder, disc?.renderOrder];
    }), [false, false, 1000, 999], 'tower range preview must render above raised terrain');
    const cell = await page.evaluate(() => {
      const d = window.__TD_DEBUG, b = d.battle(), t = d.terrain();
      for (let cx = 2; cx < t.halfW * 2 - 2; cx++) for (let cz = 2; cz < t.halfH * 2 - 2; cz++) {
        if (!b.isBuildable(cx, cz)) continue;
        const p = b.cellCenter(cx, cz);
        if (t.distToPath(p.x, p.z) > 2.6) continue;
        p.project(d.camera);
        const x = (p.x + 1) / 2 * innerWidth, y = (1-p.y) / 2 * innerHeight;
        if (document.elementFromPoint(x,y)?.id === 'gl') return { cx, cz, x, y };
      }
    });
    assert.ok(cell, 'visible tower location');
    if (viewport.width >= 1000) {
      await page.mouse.move(cell.x, cell.y);
      const previewMap = await page.evaluate(() => window.__TD_DEBUG.terrain().map.id);
      await page.screenshot({ path: `logs/maps/${viewport.width}-${previewMap}-range-preview.png` });
    }
    if (viewport.width < 1000) await page.touchscreen.tap(cell.x, cell.y);
    else await page.mouse.click(cell.x, cell.y);
    const placed = await page.evaluate(() => { const b = window.__TD_DEBUG.battle(); return b.towers.map((t) => [t.cx,t.cz]); });
    assert.deepEqual(placed, [[cell.cx,cell.cz]]);
    await page.locator('#p-sell').click();
    await page.locator('#btn-wave').click();
    await page.waitForFunction(() => window.__TD_DEBUG.battle().enemies.length >= 2, { timeout: 20000 });
    const march = await page.evaluate(() => {
      const b = window.__TD_DEBUG.battle();
      for (let i = 0; i < 180; i++) b.update(1/30);
      return b.enemies.filter((e) => e.alive).map((e) => ({ lane: b.samplers.indexOf(e.sampler), dist: e.dist, error: e.pos.distanceTo(e.sampler.at(e.dist)) }));
    });
    assert.deepEqual([...new Set(march.map((e) => e.lane))].sort(), [0,1]);
    assert.ok(march.every((e) => e.dist > 0 && e.error < 0.001));
    await page.screenshot({ path: 'logs/maps/' + viewport.width + '-combat.png' });
    await page.locator('#btn-quit').click();
    await page.waitForSelector('#s-grid .map-thumb');
    const thumbnails = await page.locator('#s-grid .map-thumb').evaluateAll((imgs) => imgs.every((img) => img.complete && img.naturalWidth === 220));
    assert.ok(thumbnails);
    const overflow = await page.evaluate(() => [...document.querySelectorAll('#s-grid button, #s-tabs button, .sel-head button')].filter((el) => el.scrollWidth > el.clientWidth + 2).map((el) => el.textContent));
    assert.deepEqual(overflow, []);
    await page.screenshot({ path: 'logs/maps/' + viewport.width + '-select.png' });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.table(rows);
  fs.writeFileSync('logs/maps/results.json', JSON.stringify(rows, null, 2));
  console.log('PASS: 42x28 terrain, all themes, four viewports, HUD layout, bridge coverage, minimap navigation, zoom, rotation, construction and two-lane combat');
} finally {
  await browser.close();
}
