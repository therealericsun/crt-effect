import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';

async function setup(page, webgl1 = false) {
  await page.route('**/gpu-fixture', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><style>body{margin:0;background:#000}#surface{position:relative;width:100vw;height:480px;background:#000}#source{position:absolute;inset:0;width:100%;height:100%}</style><div id="surface"><canvas id="source"></canvas></div></html>` }));
  if (webgl1) await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, options) { return type === 'webgl2' ? null : original.call(this, type, options); };
  });
  await page.goto('/gpu-fixture');
  await page.evaluate(async () => {
    const source = document.querySelector('#source'); source.width = innerWidth; source.height = 480;
    const ctx = source.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, source.width, source.height);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 60, source.width, 3);
    const { createWebGLCRT } = await import('/dist/crt-effect.js');
    window.gpu = createWebGLCRT(document.querySelector('#surface'), { sources: [source], curvature: .08,
      aperture: true, grain: 0, scanlines: 0, mask: 0, vignette: 0, glow: 0, maxPixels: 1000000 });
  });
}
function line(png, x, dpr) {
  const rows = [];
  for (let y = 40 * dpr; y < 100 * dpr; y++) {
    const i = (Math.round(y) * png.width + Math.round(x * dpr)) * 4;
    if (Math.min(...png.data.subarray(i, i + 3)) > 160) rows.push(y / dpr);
  }
  expect(rows.length).toBeGreaterThan(0); return rows[0];
}

test('WebGL shaders curve actual source pixels and upload changed canvas content', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => ({ renderer: window.gpu.renderer,
    error: document.querySelector('canvas[data-crt-renderer]').getContext(window.gpu.renderer).getError(),
    pixels: document.querySelector('canvas[data-crt-renderer]').width * document.querySelector('canvas[data-crt-renderer]').height }));
  expect(result.renderer).toMatch(/^webgl2?$/); expect(result.error).toBe(0); expect(result.pixels).toBeLessThanOrEqual(1002000);
  const dpr = await page.evaluate(() => devicePixelRatio), width = page.viewportSize().width;
  const screenshot = PNG.sync.read(await page.screenshot());
  expect(line(screenshot, width * .08, dpr) - line(screenshot, width / 2, dpr)).toBeGreaterThan(7);
  await page.evaluate(() => {
    const canvas = document.querySelector('#source'), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#f00'; ctx.fillRect(0, 90, canvas.width, 3);
    window.gpu.update({ curvature: 0 }); window.gpu.render();
  });
  const updated = PNG.sync.read(await page.screenshot());
  const i = (Math.round(91 * dpr) * updated.width + Math.round(width / 2 * dpr)) * 4;
  expect(updated.data[i]).toBeGreaterThan(200); expect(updated.data[i + 1]).toBeLessThan(30);
});

test('WebGL 1 fallback compiles and teardown restores source opacity and resources', async ({ page }) => {
  await setup(page, true);
  expect(await page.evaluate(() => window.gpu.renderer)).toBe('webgl');
  const state = await page.evaluate(() => {
    const gpu = window.gpu, source = document.querySelector('#source');
    gpu.setEnabled(false); const disabled = getComputedStyle(source).opacity;
    gpu.setEnabled(true); const enabled = getComputedStyle(source).opacity;
    let rejected = false; try { gpu.update({ grain: NaN }); } catch { rejected = true; }
    gpu.destroy(); gpu.destroy(); gpu.render(); gpu.refresh();
    return { disabled, enabled, rejected, opacity: source.style.opacity, generated: document.querySelectorAll('[data-crt-generated]').length };
  });
  expect(state).toEqual({ disabled: '1', enabled: '0', rejected: true, opacity: '', generated: 0 });
});

test('WebGL context loss reveals native sources and restoration resumes the filter', async ({ page }) => {
  await setup(page);
  const supported = await page.evaluate(() => {
    const output = document.querySelector('canvas[data-crt-renderer]'), gl = output.getContext(window.gpu.renderer);
    window.loss = gl.getExtension('WEBGL_lose_context'); window.loss?.loseContext(); return !!window.loss;
  });
  test.skip(!supported, 'The driver does not expose context-loss testing.');
  await expect.poll(() => page.evaluate(() => window.gpu.contextLost)).toBe(true);
  expect(await page.locator('#source').evaluate(el => getComputedStyle(el).opacity)).toBe('1');
  await page.evaluate(() => window.loss.restoreContext());
  await expect.poll(() => page.evaluate(() => window.gpu.contextLost)).toBe(false);
  expect(await page.locator('#source').evaluate(el => getComputedStyle(el).opacity)).toBe('0');
});

test('hidden-tab initialization renders an initial GPU frame without starting animation', async ({ page }) => {
  await page.addInitScript(()=>Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}));
  await setup(page);
  const result=await page.evaluate(()=>({width:document.querySelector('canvas[data-crt-renderer]').width,error:document.querySelector('canvas[data-crt-renderer]').getContext(window.gpu.renderer).getError()}));
  expect(result.width).toBeGreaterThan(300); expect(result.error).toBe(0);
  const dpr=await page.evaluate(()=>devicePixelRatio),width=page.viewportSize().width,pixels=PNG.sync.read(await page.screenshot());
  expect(line(pixels,width*.08,dpr)-line(pixels,width/2,dpr)).toBeGreaterThan(7);
  await page.evaluate(()=>window.gpu.destroy());
});

test('GPU sources follow inherited visibility without hiding the output layer', async ({ page }) => {
  await setup(page);
  const dpr = await page.evaluate(() => devicePixelRatio), width = page.viewportSize().width;
  expect(line(PNG.sync.read(await page.screenshot()), width / 2, dpr)).toBeGreaterThan(40);
  await page.evaluate(() => {
    const source = document.querySelector('#source'), wrapper = document.createElement('div');
    source.before(wrapper); wrapper.append(source); wrapper.id = 'source-wrapper';
    wrapper.style.visibility = 'hidden'; window.gpu.render();
  });
  const hidden = PNG.sync.read(await page.screenshot());
  const i = (Math.round(61 * dpr) * hidden.width + Math.round(width / 2 * dpr)) * 4;
  expect(Math.max(...hidden.data.subarray(i, i + 3))).toBeLessThan(20);
  await page.evaluate(() => { document.querySelector('#source-wrapper').style.visibility = 'visible'; window.gpu.render(); });
  expect(line(PNG.sync.read(await page.screenshot()), width / 2, dpr)).toBeGreaterThan(40);
});
