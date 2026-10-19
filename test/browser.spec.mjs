import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';

async function fixture(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    window.crt.destroy();
    document.body.innerHTML = `<div id="line" style="position:absolute;left:0;top:60px;width:100%;height:3px;background:white"></div>
      <div id="selectable" style="position:absolute;left:20%;top:160px">Selectable native text</div>
      <div id="fixed" style="position:fixed;right:30px;bottom:80px;width:100px;height:4px;background:lime"></div>
      <aside data-crt-protect style="position:fixed;left:20px;top:220px;width:260px;background:#234;padding:16px;transition:transform .2s">
      <button id="button" onclick="this.textContent='Clicked'">Click me</button><input id="range" type="range" value="50"><a href="#end">Jump</a></aside>
      <div id="end" style="position:absolute;top:1800px">End marker</div>`;
    document.documentElement.style.cssText = 'background:black;color:white;min-height:2200px';
    document.body.style.cssText = 'margin:0;padding:0;min-height:2200px';
    const { createCRT } = await import('/dist/crt-effect.js');
    window.createCRT = createCRT;
    window.crt = createCRT(document.documentElement, { grain: 0, scanlines: 0, mask: 0, vignette: 0, glow: 0 });
  });
  await page.waitForTimeout(100);
}
function whiteLine(png, cssX, dpr) {
  const x = Math.round(cssX * dpr);
  let best = -1, score = 0;
  for (let y = Math.round(45 * dpr); y < Math.round(100 * dpr); y++) {
    const i = (y * png.width + x) * 4;
    const brightness = Math.min(...png.data.subarray(i, i + 3));
    if (brightness > score) { score = brightness; best = y / dpr; }
  }
  expect(score).toBeGreaterThan(150);
  return best;
}

test('actual live pixels curve while controls, selection, scroll and fixed descendants work', async ({ page, browserName }) => {
  await fixture(page);
  const { width } = page.viewportSize();
  const dpr = await page.evaluate(() => devicePixelRatio);
  const curved = PNG.sync.read(await page.screenshot());
  const edge = whiteLine(curved, Math.max(20, width * .04), dpr), center = whiteLine(curved, width / 2, dpr);
  if (browserName === 'firefox') {
    test.info().annotations.push({ type: 'browser limitation', description: 'Firefox ignores root SVG filters: Mozilla bug 1769223. Non-root curvature is tested separately.' });
    expect(Math.abs(edge - center)).toBeLessThan(2);
  } else expect(edge - center).toBeGreaterThan(5);
  const button = page.locator('#button');
  const before = await button.boundingBox();
  await button.click(); await expect(button).toHaveText('Clicked');
  await page.locator('#range').focus(); await page.keyboard.press('ArrowRight');
  await expect(page.locator('#range')).toHaveValue('51');
  expect(await page.evaluate(() => {
    const range = document.createRange(); range.selectNodeContents(document.querySelector('#selectable'));
    getSelection().removeAllRanges(); getSelection().addRange(range); return getSelection().toString();
  })).toBe('Selectable native text');
  await page.evaluate(() => getSelection().removeAllRanges());
  const fixedBefore = await page.locator('#fixed').boundingBox();
  await page.evaluate(() => { window.scrollTo(0, 500); }); await page.waitForTimeout(100);
  expect(await page.locator('#fixed').boundingBox()).toEqual(fixedBefore);
  expect(await page.locator('#button').boundingBox()).toMatchObject({ x: before.x, y: before.y });
  expect(await page.locator('feImage').getAttribute('y')).toBe('500');
  const scrolled = PNG.sync.read(await page.screenshot());
  const greenRows = png => {
    const rows = [];
    const x = Math.round((fixedBefore.x + 50) * dpr);
    for (let y = Math.floor((fixedBefore.y - 30) * dpr); y < Math.ceil((fixedBefore.y + 30) * dpr); y++) {
      const i = (y * png.width + x) * 4;
      if (png.data[i + 1] > 150 && png.data[i] < 50) rows.push(y);
    }
    return rows;
  };
  expect(greenRows(scrolled).length).toBeGreaterThan(0);
  expect(greenRows(scrolled)).toEqual(greenRows(curved));
  await page.evaluate(() => { window.scrollTo(0, 0); window.crt.setEnabled(false); });
  const straight = PNG.sync.read(await page.screenshot());
  expect(Math.abs(whiteLine(straight, Math.max(20, width * .04), dpr) - whiteLine(straight, width / 2, dpr))).toBeLessThan(2);
});

test('resize, protected transitions, option validation, repeated toggle and full teardown', async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 620, height: 720 });
  await expect(page.locator('filter')).toHaveAttribute('width', '620');
  await page.evaluate(() => document.querySelector('aside').style.transform = 'translateY(90px)');
  await page.waitForTimeout(300);
  await page.locator('#button').click(); await expect(page.locator('#button')).toHaveText('Clicked');
  const result = await page.evaluate(() => {
    const crt = window.crt;
    crt.update({ curvature: .06, grain: .02, glow: .1, scanlineSpacing: 4 });
    const settings = crt.options;
    let invalid = false;
    try { crt.update({ grain: NaN }); } catch { invalid = true; }
    const preserved = crt.options.grain;
    for (let i = 0; i < 12; i++) { crt.setEnabled(false); crt.setEnabled(true); }
    crt.destroy(); crt.destroy(); crt.update({ grain: .5 }); crt.refresh();
    const removed = !document.querySelector('[data-crt-generated]') && !document.documentElement.style.filter;
    document.documentElement.style.setProperty('filter', 'contrast(1.1)', 'important');
    document.documentElement.style.setProperty('--unrelated', 'retained');
    const next = window.createCRT(document.documentElement);
    const composed = document.documentElement.style.filter.includes('contrast(1.1)');
    next.destroy();
    return { settings, invalid, preserved, removed, composed, filter: document.documentElement.style.filter,
      priority: document.documentElement.style.getPropertyPriority('filter'), other: document.documentElement.style.getPropertyValue('--unrelated') };
  });
  expect(result).toMatchObject({ invalid: true, preserved: .02, removed: true, composed: true, filter: 'contrast(1.1)', priority: 'important', other: 'retained', settings: { curvature: .06, grain: .02, glow: .1, scanlineSpacing: 4 } });
  await page.evaluate(() => { window.scrollTo(0, 800); document.body.append(document.createElement('p')); });
  await page.waitForTimeout(100);
  expect(await page.locator('[data-crt-generated]').count()).toBe(0);
});

test('grain freezes for reduced motion and hidden documents; disabled instances remain quiet', async ({ page }) => {
  await page.goto('/');
  expect(await page.locator('[data-crt-generated] > div').nth(1).evaluate(el => getComputedStyle(el).backgroundImage)).toContain('linear-gradient');
  const noise = page.locator('[data-crt-generated] > div').nth(2);
  const first = await noise.getAttribute('style');
  await expect.poll(() => noise.getAttribute('style')).not.toBe(first);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(100);
  const frozen = await noise.getAttribute('style');
  await page.waitForTimeout(250); expect(await noise.getAttribute('style')).toBe(frozen);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const hidden = await noise.getAttribute('style');
  await page.waitForTimeout(250); expect(await noise.getAttribute('style')).toBe(hidden);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => noise.getAttribute('style')).not.toBe(hidden);
  await page.evaluate(() => window.crt.setEnabled(false));
  const disabled = await noise.getAttribute('style');
  await page.waitForTimeout(250); expect(await noise.getAttribute('style')).toBe(disabled);
});

test('demo controls and destroy/recreate remain native', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('#enabled').uncheck();
  expect(await page.evaluate(() => window.crt.enabled)).toBe(false);
  await page.locator('#enabled').check();
  await page.locator('#curvature').focus(); await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => window.crt.options.curvature)).toBe(.04);
  await page.getByRole('button', { name: 'Destroy effect' }).click();
  expect(await page.locator('[data-crt-generated]').count()).toBe(0);
  await page.getByRole('button', { name: 'Recreate effect' }).click();
  expect(await page.locator('[data-crt-generated]').count()).toBe(2);
  expect(errors).toEqual([]);
});


test('non-root curvature displaces actual pixels in every engine', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    window.crt.destroy();
    document.body.style.minHeight = '800px';
    window.crt = window.createCRT(document.body, { grain: 0, scanlines: 0, mask: 0, vignette: 0, glow: 0 });
  });
  const { width } = page.viewportSize();
  const dpr = await page.evaluate(() => devicePixelRatio);
  const pixels = PNG.sync.read(await page.screenshot());
  expect(whiteLine(pixels, Math.max(20, width * .04), dpr) - whiteLine(pixels, width / 2, dpr)).toBeGreaterThan(5);
});


test('destroy releases animation jobs, observers and listeners', async ({ page }) => {
  await page.route('**/empty', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><button>Native control</button></body></html>' }));
  await page.goto('/empty');
  const pending = await page.evaluate(async () => {
    const { createCRT } = await import('/dist/crt-effect.js');
    const jobs = new Set(), frames = new Set(), observers = new Set(), listeners = new Set();
    const old = { setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame, ResizeObserver, MutationObserver,
      add: EventTarget.prototype.addEventListener, remove: EventTarget.prototype.removeEventListener };
    window.setTimeout = (fn, delay) => { const id = old.setTimeout.call(window, () => { jobs.delete(id); fn(); }, delay); jobs.add(id); return id; };
    window.clearTimeout = id => { jobs.delete(id); old.clearTimeout.call(window, id); };
    window.requestAnimationFrame = fn => { const id = old.requestAnimationFrame.call(window, time => { frames.delete(id); fn(time); }); frames.add(id); return id; };
    window.cancelAnimationFrame = id => { frames.delete(id); old.cancelAnimationFrame.call(window, id); };
    for (const key of ['ResizeObserver', 'MutationObserver']) window[key] = class extends old[key] {
      constructor(callback) { super(callback); observers.add(this); }
      disconnect() { observers.delete(this); super.disconnect(); }
    };
    EventTarget.prototype.addEventListener = function(type, handler, options) { listeners.add(handler); return old.add.call(this, type, handler, options); };
    EventTarget.prototype.removeEventListener = function(type, handler, options) { listeners.delete(handler); return old.remove.call(this, type, handler, options); };
    const crt = createCRT(document.documentElement);
    const before = { timers: jobs.size, observers: observers.size, listeners: listeners.size };
    crt.destroy();
    const after = { timers: jobs.size, frames: frames.size, observers: observers.size, listeners: listeners.size };
    Object.assign(window, { setTimeout: old.setTimeout, clearTimeout: old.clearTimeout,
      requestAnimationFrame: old.requestAnimationFrame, cancelAnimationFrame: old.cancelAnimationFrame,
      ResizeObserver: old.ResizeObserver, MutationObserver: old.MutationObserver });
    EventTarget.prototype.addEventListener = old.add; EventTarget.prototype.removeEventListener = old.remove;
    return { before, after };
  });
  expect(pending.before.timers).toBe(1);
  expect(pending.before.observers).toBe(2);
  expect(pending.before.listeners).toBeGreaterThan(0);
  expect(pending.after).toEqual({ timers: 0, frames: 0, observers: 0, listeners: 0 });
});

test('separate HTML surfaces share one viewport field through movement and scroll', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    window.crt.destroy();
    document.body.innerHTML = `<div id="screen" style="position:fixed;left:20px;top:20px;width:300px;height:400px;background:black">
      <div id="first" style="position:absolute;left:0;top:0;width:150px;height:400px;overflow:visible"><div style="position:absolute;top:60px;left:0;width:150px;height:3px;background:white"></div></div>
      <div id="second" style="position:absolute;left:150px;top:0;width:150px;height:400px;overflow:visible"><div style="position:absolute;top:60px;left:0;width:150px;height:3px;background:white"></div></div><div id="thin" style="position:absolute;left:0;top:300px;width:300px;height:3px;background:white"></div></div>`;
    window.parts = ['first', 'second', 'thin'].map(id => window.createCRT(document.getElementById(id), {
      viewport: document.getElementById('screen'), curvature: .08, alignControls: false, protect: '',
      grain: 0, scanlines: 0, mask: 0, vignette: 0, glow: 0,
    }));
  });
  await page.waitForTimeout(100);
  const dpr = await page.evaluate(() => devicePixelRatio), image = PNG.sync.read(await page.screenshot());
  const center = whiteLine(image, 170, dpr), left = whiteLine(image, 45, dpr), right = whiteLine(image, 295, dpr);
  expect(Math.abs(left - right)).toBeLessThan(2);
  expect(left - center).toBeGreaterThan(5);
  // A shallow footer-like surface must paint beyond its original border box.
  const lifted = [];
  for (let y = 305 * dpr; y < 320 * dpr; y++) {
    const i = (Math.round(y) * image.width + Math.round(45 * dpr)) * 4;
    if (Math.min(...image.data.subarray(i, i + 3)) > 150) lifted.push(y / dpr);
  }
  expect(lifted.length).toBeGreaterThan(0);
  expect(Math.abs(whiteLine(image, 166, dpr) - whiteLine(image, 174, dpr))).toBeLessThan(2);
  const mapBefore = await page.locator('feImage').nth(1).getAttribute('href');
  await page.evaluate(() => { document.querySelector('#second').style.top = '30px'; window.parts[1].refresh(); });
  expect(Number(await page.locator('feImage').nth(1).getAttribute('x'))).toBeLessThan(0);
  expect(Number(await page.locator('feImage').nth(1).getAttribute('y'))).toBeLessThan(0);
  expect(await page.locator('feImage').nth(1).getAttribute('href')).not.toBe(mapBefore);
  await page.evaluate(() => { window.parts.forEach(crt => crt.destroy()); });
  expect(await page.locator('[data-crt-generated]').count()).toBe(0);
});

test('a hidden-tab initialization prepares curvature before the first visible paint', async ({ page }) => {
  await page.route('**/hidden-fixture', route => route.fulfill({ contentType:'text/html', body:'<!doctype html><style>body{margin:0;background:black}#surface{position:relative;width:100vw;height:400px}#line{position:absolute;top:60px;width:100%;height:3px;background:white}</style><div id="surface"><div id="line"></div></div>' }));
  await page.goto('/hidden-fixture');
  const initialized = await page.evaluate(async () => {
    Object.defineProperty(document, 'hidden', { configurable:true, get:()=>true });
    const { createCRT } = await import('/dist/crt-effect.js');
    window.crt = createCRT(document.querySelector('#surface'), { curvature:.08, protect:'', alignControls:false, grain:0, scanlines:0, mask:0, vignette:0, glow:0 });
    return { map:document.querySelector('feImage').getAttribute('href'), scale:Number(document.querySelector('feDisplacementMap').getAttribute('scale')) };
  });
  expect(initialized.map).toMatch(/^data:image\/png/); expect(initialized.scale).toBeGreaterThan(0);
  await page.waitForTimeout(100);
  const dpr=await page.evaluate(()=>devicePixelRatio),width=page.viewportSize().width,pixels=PNG.sync.read(await page.screenshot());
  expect(whiteLine(pixels,width*.08,dpr)-whiteLine(pixels,width/2,dpr)).toBeGreaterThan(5);
  await page.evaluate(()=>window.crt.destroy());
});
