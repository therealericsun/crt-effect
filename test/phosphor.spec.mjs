import { test, expect } from '@playwright/test';

async function setup(page) {
  await page.route('**/mask-fixture', route => route.fulfill({ contentType:'text/html', body:`<!doctype html><html><style>body{margin:0;background:#000}#screen{position:relative;width:100vw;height:480px;background:#000}#source{position:absolute;inset:0;width:100%;height:100%}</style><div id="screen"><canvas id="source"></canvas></div></html>` }));
  await page.goto('/mask-fixture');
  await page.evaluate(async () => {
    const { createCRT, createWebGLCRT } = await import('/dist/crt-effect.js');
    window.createCRT = createCRT;
    const source = document.querySelector('#source'); source.width = innerWidth; source.height = 480;
    window.gpu = createWebGLCRT(document.querySelector('#screen'), {sources:[source], curvature:0,
      grain:0, scanlines:0, mask:1, vignette:0, glow:0});
  });
}

test('phosphor pixels follow barrel sampling rather than a flat screen grid', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const canvas = document.querySelector('[data-crt-mask-pattern]');
    const { width, height } = canvas, flat = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    window.gpu.update({curvature:.12});
    const curved = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    let curvedError = 0, flatError = 0, count = 0;
    const premultiplied = (data, x, y, channel) => {
      const i = (y * width + x) * 4; return data[i + channel] * data[i + 3] / 255;
    };
    for (const y of [8, Math.floor(height * .25), height - 9]) {
      const v = (y + .5) / height * 2 - 1;
      for (let x = 20; x < width - 20; x++) {
        // The same cross-axis barrel equation used to sample scene geometry.
        const u = (x + .5) / width * 2 - 1;
        const sample = x + .12 * width * .5 * u * v * v;
        const sampleY = y + .12 * height * .5 * v * u * u;
        if (sample < 2 || sample >= width - 2 || sampleY < 2 || sampleY >= height - 2) continue;
        const phase = ((sample + .5) / (width / document.querySelector('#screen').clientWidth)) % 3;
        // Premultiplied RGB at the red, green, blue and transparent stops.
        const expectedRGB = phase < 1 ? [68 * (1 - phase), 34 * phase, 0]
          : phase < 2 ? [0, 34 * (2 - phase), 68 * (phase - 1)] : [0, 0, 68 * (3 - phase)];
        for (let c = 0; c < 3; c++) {
          const actual = premultiplied(curved, x, y, c);
          const expected = expectedRGB[c];
          curvedError += Math.abs(actual - expected);
          flatError += Math.abs(actual - premultiplied(flat, x, y, c)); count++;
        }
      }
    }
    return {curved:curvedError / count, flat:flatError / count, cornerAlpha:curved[3]};
  });
  expect(result.curved).toBeLessThan(5);
  expect(result.curved).toBeLessThan(result.flat * .4);
  expect(result.flat).toBeGreaterThan(8);
  expect(result.cornerAlpha).toBe(0);
});

test('HTML panels crop the same curved mask phase as the full GPU viewport', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    window.gpu.update({curvature:.12});
    const screen = document.querySelector('#screen');
    const panel = document.createElement('div');
    panel.style.cssText = 'position:absolute;left:41px;top:70px;width:230px;height:220px;background:#111';
    screen.append(panel);
    const html = window.createCRT(panel, {viewport:screen, curvature:.12, mask:1,
      grain:0,scanlines:0,vignette:0,glow:0,protect:'',alignControls:false});
    const [full, crop] = document.querySelectorAll('[data-crt-mask-pattern]');
    const density = full.width / screen.clientWidth;
    const a = full.getContext('2d').getImageData(0, 0, full.width, full.height).data;
    const b = crop.getContext('2d').getImageData(0, 0, crop.width, crop.height).data;
    let total = 0, count = 0;
    for (let y = 8; y < crop.height - 8; y += 11) for (let x = 8; x < crop.width - 8; x += 7) {
      const i = ((y + Math.round(70 * density)) * full.width + x + Math.round(41 * density)) * 4;
      const j = (y * crop.width + x) * 4;
      for (let c = 0; c < 3; c++) {total += Math.abs(a[i+c] * a[i+3] - b[j+c] * b[j+3]) / 255; count++;}
    }
    html.destroy(); return total / count;
  });
  expect(result).toBeLessThan(1);
});

test('mask updates are cached across animation and strength changes, resized and released', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const canvas = document.querySelector('[data-crt-mask-pattern]');
    const original = CanvasRenderingContext2D.prototype.drawImage;
    let draws = 0;
    CanvasRenderingContext2D.prototype.drawImage = function(...args) {
      if (this.canvas === canvas) draws++;
      return original.apply(this,args);
    };
    for (let i = 0; i < 12; i++) window.gpu.render(false);
    window.gpu.update({mask:.4});
    const cachedDraws = draws;
    window.gpu.update({curvature:.1});
    const geometryDraws = draws;
    document.querySelector('#screen').style.height = '520px';
    window.gpu.render(false);
    const resized = canvas.height;
    window.gpu.setEnabled(false);
    const disabled = getComputedStyle(canvas.parentElement.parentElement).display;
    window.gpu.setEnabled(true); window.gpu.destroy();
    CanvasRenderingContext2D.prototype.drawImage = original;
    return {cachedDraws, geometryDraws, resized, disabled, connected:canvas.isConnected,
      width:canvas.width,height:canvas.height};
  });
  expect(result.cachedDraws).toBe(0);
  expect(result.geometryDraws).toBeGreaterThan(0);
  expect(result.resized).toBe(Math.round(520 * await page.evaluate(() => devicePixelRatio)));
  expect(result).toMatchObject({disabled:'none',connected:false,width:1,height:1});
});

test('root SVG masks are curved once alongside native content', async ({ page, browserName }) => {
  test.skip(browserName === 'firefox', 'Firefox ignores root SVG filters; its independent mask field is covered above.');
  await setup(page);
  await page.evaluate(() => {
    const pattern = document.querySelector('[data-crt-mask-pattern]');
    const source = document.querySelector('#source');
    source.width = pattern.width; source.height = pattern.height;
    source.getContext('2d').drawImage(pattern,0,0);
    window.gpu.destroy();
    document.querySelector('#screen').style.height = '100vh';
    window.html = window.createCRT(document.documentElement, {curvature:.12,mask:0,
      grain:0,scanlines:0,vignette:0,glow:0,protect:'',alignControls:false});
  });
  const {PNG} = await import('pngjs');
  const before = PNG.sync.read(await page.screenshot());
  await page.evaluate(() => { document.querySelector('#source').style.visibility='hidden'; window.html.update({mask:1}); });
  const after = PNG.sync.read(await page.screenshot());
  let error = 0, count = 0;
  for (let y = 80; y < before.height - 80; y += 3) for (let x = 60; x < before.width - 60; x += 2) {
    const i = (y * before.width + x) * 4;
    for (let c = 0; c < 3; c++) { error += Math.abs(before.data[i+c] - after.data[i+c]); count++; }
  }
  expect(error / count).toBeLessThan(1);
});
