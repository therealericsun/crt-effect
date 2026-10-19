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
async function presentedFrame(page) {
  // WebKitGTK can present the previous GPU buffer until the next compositor frame.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.screenshot();
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
  const screenshot = PNG.sync.read(await presentedFrame(page));
  expect(line(screenshot, width * .08, dpr) - line(screenshot, width / 2, dpr)).toBeGreaterThan(7);
  await page.evaluate(() => {
    const canvas = document.querySelector('#source'), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#f00'; ctx.fillRect(0, 90, canvas.width, 3);
    window.gpu.update({ curvature: 0 }); window.gpu.render();
  });
  const updated = PNG.sync.read(await presentedFrame(page));
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
  await expect(page.locator('[data-crt-generated="webgl-aperture"]')).toBeHidden();
  await page.evaluate(() => window.loss.restoreContext());
  await expect.poll(() => page.evaluate(() => window.gpu.contextLost)).toBe(false);
  expect(await page.locator('#source').evaluate(el => getComputedStyle(el).opacity)).toBe('0');
});

test('hidden-tab initialization renders an initial GPU frame without starting animation', async ({ page }) => {
  await page.addInitScript(()=>Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}));
  await setup(page);
  const result=await page.evaluate(()=>({width:document.querySelector('canvas[data-crt-renderer]').width,error:document.querySelector('canvas[data-crt-renderer]').getContext(window.gpu.renderer).getError()}));
  expect(result.width).toBeGreaterThan(300); expect(result.error).toBe(0);
  const dpr=await page.evaluate(()=>devicePixelRatio),width=page.viewportSize().width,pixels=PNG.sync.read(await presentedFrame(page));
  expect(line(pixels,width*.08,dpr)-line(pixels,width/2,dpr)).toBeGreaterThan(7);
  await page.evaluate(()=>window.gpu.destroy());
});

test('GPU sources follow inherited visibility without hiding the output layer', async ({ page }) => {
  await setup(page);
  const dpr = await page.evaluate(() => devicePixelRatio), width = page.viewportSize().width;
  expect(line(PNG.sync.read(await presentedFrame(page)), width / 2, dpr)).toBeGreaterThan(40);
  await page.evaluate(() => {
    const source = document.querySelector('#source'), wrapper = document.createElement('div');
    source.before(wrapper); wrapper.append(source); wrapper.id = 'source-wrapper';
    wrapper.style.visibility = 'hidden'; window.gpu.render();
  });
  const hidden = PNG.sync.read(await presentedFrame(page));
  const i = (Math.round(61 * dpr) * hidden.width + Math.round(width / 2 * dpr)) * 4;
  expect(Math.max(...hidden.data.subarray(i, i + 3))).toBeLessThan(20);
  await page.evaluate(() => { document.querySelector('#source-wrapper').style.visibility = 'visible'; window.gpu.render(); });
  expect(line(PNG.sync.read(await presentedFrame(page)), width / 2, dpr)).toBeGreaterThan(40);
});


test('collapsed hosts hide the aperture and resume when shown', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { document.querySelector('#surface').style.display = 'none'; window.gpu.render(); });
  await expect(page.locator('[data-crt-generated="webgl-aperture"]')).toBeHidden();
  await expect(page.locator('[data-crt-generated="webgl-overlay"]')).toBeHidden();
  await page.evaluate(() => { document.querySelector('#surface').style.display = ''; window.gpu.render(); });
  await expect(page.locator('[data-crt-generated="webgl-aperture"]')).toBeVisible();
  const dpr = await page.evaluate(() => devicePixelRatio), width = page.viewportSize().width;
  expect(line(PNG.sync.read(await presentedFrame(page)), width / 2, dpr)).toBeGreaterThan(40);
});

test('oversized source canvases fit the GPU texture limit', async ({ page }) => {
  await page.addInitScript(() => {
    for (const type of [WebGLRenderingContext, WebGL2RenderingContext]) {
      const get = type.prototype.getParameter;
      type.prototype.getParameter = function(name) { return name === this.MAX_TEXTURE_SIZE ? 128 : get.call(this, name); };
    }
  });
  await setup(page);
  expect(await page.evaluate(() => {
    const canvas = document.querySelector('canvas[data-crt-renderer]'), gl = canvas.getContext(window.gpu.renderer);
    window.gpu.render(); return gl.getError();
  })).toBe(0);
  await page.evaluate(() => window.gpu.destroy());
  expect(await page.locator('#source').evaluate(el => getComputedStyle(el).opacity)).toBe('1');
});

test('layout-only renders move cached pixels without uploading unchanged sources', async ({ page }) => {
  await setup(page);
  await page.waitForTimeout(50);
  const result = await page.evaluate(() => {
    const source = document.querySelector('#source');
    const output = document.querySelector('canvas[data-crt-renderer]'), gl = output.getContext(window.gpu.renderer);
    let uploads = 0;
    for (const name of ['texImage2D', 'texSubImage2D']) {
      const original = gl[name];
      gl[name] = function(...args) { uploads++; return original.apply(this, args); };
    }
    source.style.top = '20px'; window.gpu.render(false);
    const program = gl.getParameter(gl.CURRENT_PROGRAM);
    return { uploads, y:gl.getUniform(program, gl.getUniformLocation(program, 'uRect0'))[1], error:gl.getError() };
  });
  expect(result).toEqual({ uploads:0, y:20, error:0 });
  const dpr = await page.evaluate(() => devicePixelRatio), width = page.viewportSize().width;
  expect(line(PNG.sync.read(await presentedFrame(page)), width / 2, dpr)).toBeGreaterThan(75);
  await page.evaluate(() => {
    const source = document.querySelector('#source'), ctx = source.getContext('2d');
    ctx.fillStyle = '#f00'; ctx.fillRect(0, 60, source.width, 3); window.gpu.render();
  });
  const updated = PNG.sync.read(await presentedFrame(page));
  const i = (Math.round(81 * dpr) * updated.width + Math.round(width / 2 * dpr)) * 4;
  expect(updated.data[i]).toBeGreaterThan(200); expect(updated.data[i + 1]).toBeLessThan(30);
});

test('one texture overlay covers opaque native panels and grain respects motion and visibility', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const panel = document.createElement('button'); panel.id = 'native-panel'; panel.textContent = 'Native control';
    panel.style.cssText = 'position:absolute;left:40%;top:160px;width:120px;height:80px;background:#404040;border:0;z-index:2;color:white';
    panel.onclick = () => panel.dataset.clicked = 'true'; document.querySelector('#surface').append(panel);
    window.gpu.update({ grain:.5, scanlines:.4 });
  });
  const dpr = await page.evaluate(() => devicePixelRatio), x = page.viewportSize().width * .4 + 10;
  await expect.poll(async () => {
    const capture = PNG.sync.read(await presentedFrame(page)), values = new Set();
    for (let y = 170; y < 185; y++) for (let dx = 0; dx < 20; dx++) values.add(capture.data[(Math.round(y * dpr) * capture.width + Math.round((x + dx) * dpr)) * 4]);
    return values.size;
  }).toBeGreaterThan(20);
  await page.locator('#native-panel').click(); await expect(page.locator('#native-panel')).toHaveAttribute('data-clicked', 'true');
  const grain = page.locator('[data-crt-grain]');
  const position = await grain.evaluate(e => e.style.backgroundPosition);
  await page.waitForTimeout(180); expect(await grain.evaluate(e => e.style.backgroundPosition)).not.toBe(position);
  await page.emulateMedia({ reducedMotion:'reduce' });
  await expect(grain).toHaveCSS('background-position', '0px 0px');
  const frozen = await grain.evaluate(e => e.style.backgroundPosition);
  await page.waitForTimeout(180); expect(await grain.evaluate(e => e.style.backgroundPosition)).toBe(frozen);
  await page.emulateMedia({ reducedMotion:'no-preference' });
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable:true, get:()=>true }); document.dispatchEvent(new Event('visibilitychange')); });
  const hidden = await grain.evaluate(e => e.style.backgroundPosition);
  await page.waitForTimeout(180); expect(await grain.evaluate(e => e.style.backgroundPosition)).toBe(hidden);
  await page.evaluate(() => window.gpu.destroy());
  expect(await page.locator('[data-crt-generated]').count()).toBe(0);
});

test('showcase pairs identical sources with stronger CRT examples and a working toggle', async ({ page }) => {
  for (const example of ['analog','broadcast','arcade','terminal']) {
    await page.goto('/demo/showcase.html?example=' + example);
    await expect(page.locator('#screen')).toHaveAttribute('data-ready', example);
    expect(await page.evaluate(() => document.querySelector('#before').toDataURL() === document.querySelector('#source').toDataURL())).toBe(true);
    expect(Number(await page.locator('[data-crt-grain]').evaluate(e => e.style.opacity))).toBeGreaterThan(.04);
    await page.locator('#enabled').uncheck();
    await expect(page.locator('[data-crt-generated="webgl-overlay"]')).toBeHidden();
    expect(await page.locator('#source').evaluate(e => getComputedStyle(e).opacity)).toBe('1');
  }
});


test('WebKitGTK keeps the newest draw available instead of presenting a stale buffer', async ({ page }) => {
  await page.addInitScript(() => {
    // Playwright reports Safari's Mac user agent even on its Linux runner.
    Object.defineProperty(navigator, 'userAgent', { get:()=> 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/27.2 Safari/605.1.15' });
    Object.defineProperty(navigator, 'platform', { get:()=> 'Linux x86_64' });
  });
  await setup(page);
  expect(await page.evaluate(() => document.querySelector('canvas[data-crt-renderer]').getContext(window.gpu.renderer).getContextAttributes().preserveDrawingBuffer)).toBe(true);
  await page.evaluate(() => {
    const canvas = document.querySelector('#source'), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f00'; ctx.fillRect(0, 90, canvas.width, 3); window.gpu.render();
  });
  const dpr = await page.evaluate(() => devicePixelRatio), pixels = PNG.sync.read(await presentedFrame(page));
  const i = (Math.round(91 * dpr) * pixels.width + Math.round(page.viewportSize().width / 2 * dpr)) * 4;
  expect(pixels.data[i]).toBeGreaterThan(200); expect(pixels.data[i + 1]).toBeLessThan(30);
});
