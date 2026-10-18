import { displacement } from './geometry.js';

export const balanced = Object.freeze({
  preset: 'balanced', enabled: true, curvature: .035, grain: .025, grainFPS: 12,
  scanlines: .10, scanlineSpacing: 3, mask: .025, vignette: .45, glow: .08,
  protect: '[data-crt-protect]',
});
const nativeControls = 'a[href],button,input,select,textarea,label,summary,[contenteditable]:not([contenteditable="false"]),[tabindex]:not([tabindex="-1"]),[role="button"],iframe,video[controls],audio[controls]';
const instances = new WeakMap();
const ranges = { curvature: [0, .15], grain: [0, 1], grainFPS: [1, 60], scanlines: [0, 1],
  scanlineSpacing: [1, 12], mask: [0, 1], vignette: [0, 1], glow: [0, 1] };
let serial = 0;

function normalize(previous, patch, target) {
  const result = { ...previous, ...patch };
  if (result.preset !== 'balanced') throw new TypeError('Unknown CRT preset; use "balanced".');
  if (typeof result.enabled !== 'boolean') throw new TypeError('enabled must be boolean.');
  if (typeof result.protect !== 'string') throw new TypeError('protect must be a CSS selector string.');
  if (result.protect) target.querySelector(result.protect); // Validate before any DOM/style changes.
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (!Number.isFinite(result[key])) throw new TypeError(`${key} must be finite.`);
    result[key] = Math.max(min, Math.min(max, result[key]));
  }
  return result;
}

/** Apply a viewport-relative CRT to a live HTML surface; no content is cloned. */
export function createCRT(target, options = {}) {
  if (!target?.ownerDocument || !target.style || !target.isConnected) {
    throw new TypeError('createCRT requires a connected HTML element.');
  }
  if (instances.has(target)) throw new Error('This element already has a CRT instance.');
  let settings = normalize(balanced, options, target);
  const doc = target.ownerDocument, win = doc.defaultView;
  const root = target === doc.documentElement;
  const ns = 'http://www.w3.org/2000/svg';
  const id = `crt-effect-${++serial}`;
  const originalFilter = target.style.getPropertyValue('filter');
  const originalPriority = target.style.getPropertyPriority('filter');
  const computedFilter = win.getComputedStyle(target).filter;
  let destroyed = false, frame = 0, grainTimer = 0, lastGeometry = '', grainIndex = 0;
  let protectedElements = [], observed = new Set();
  const cleanups = [];
  const svg = (name, attributes, parent) => {
    const el = doc.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, String(value));
    parent?.append(el);
    return el;
  };
  const defsHost = svg('svg', { 'aria-hidden': 'true', focusable: 'false', width: 0, height: 0 });
  defsHost.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;overflow:hidden';
  defsHost.dataset.crtGenerated = id;
  const filter = svg('filter', { id, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' }, svg('defs', {}, defsHost));
  const map = svg('feImage', { result: 'map', preserveAspectRatio: 'none' }, filter);
  // 128 is the neutral 8-bit channel; shift it to exactly .5 to avoid a half-pixel bias.
  const transfer = svg('feComponentTransfer', { in: 'map', result: 'centered' }, filter);
  for (const channel of ['R', 'G']) svg(`feFunc${channel}`, { type: 'linear', slope: 1, intercept: -.5 / 255 }, transfer);
  const warp = svg('feDisplacementMap', { in: 'SourceGraphic', in2: 'centered', xChannelSelector: 'R', yChannelSelector: 'G', result: 'curved' }, filter);
  svg('feGaussianBlur', { in: 'curved', stdDeviation: .65, result: 'soft' }, filter);
  const glow = svg('feComposite', { in: 'soft', in2: 'curved', operator: 'arithmetic', k1: 0, k2: settings.glow, k3: 1, k4: 0, result: 'finished' }, filter);
  // Keep the curved screen's exposed corners black instead of the browser's default canvas color.
  const bezel = root ? svg('feFlood', { 'flood-color': '#000', result: 'bezel' }, filter) : null;
  if (root) svg('feComposite', { in: 'finished', in2: 'bezel', operator: 'over' }, filter);
  const overlay = doc.createElement('div');
  overlay.dataset.crtGenerated = id;
  overlay.setAttribute('aria-hidden', 'true');
  overlay.inert = true;
  overlay.style.cssText = 'position:fixed;pointer-events:none!important;z-index:2147483647;overflow:hidden;contain:strict;isolation:isolate;user-select:none';
  const layer = () => {
    const el = doc.createElement('div');
    el.style.cssText = 'position:absolute;inset:0;pointer-events:none!important';
    overlay.append(el);
    return el;
  };
  const scanlines = layer(), mask = layer(), grain = layer(), vignette = layer();
  mask.style.background = 'repeating-linear-gradient(90deg,#f004 0px,#0f02 1px,#00f4 2px,transparent 3px)';
  grain.style.backgroundSize = '128px 128px';
  vignette.style.background = 'radial-gradient(ellipse at center,transparent 35%,#0005 75%,#000 100%)';
  (doc.body || doc.documentElement).append(defsHost, overlay);
  const mapCanvas = doc.createElement('canvas'), context = mapCanvas.getContext('2d');
  if (!context) { defsHost.remove(); overlay.remove(); throw new Error('CRT requires Canvas 2D.'); }
  const noiseCanvas = doc.createElement('canvas');
  noiseCanvas.width = noiseCanvas.height = 128;
  const noiseContext = noiseCanvas.getContext('2d');
  const noiseFrames = [];
  // Cache the noise once. Animation only swaps a small data URL, never a viewport-sized bitmap.
  for (let i = 0; i < 8; i++) {
    const pixels = noiseContext.createImageData(128, 128);
    for (let p = 0; p < pixels.data.length; p += 4) {
      const value = Math.floor(Math.random() * 256);
      pixels.data[p] = pixels.data[p + 1] = pixels.data[p + 2] = value;
      pixels.data[p + 3] = 255;
    }
    noiseContext.putImageData(pixels, 0, 0);
    noiseFrames.push(`url("${noiseCanvas.toDataURL()}")`);
  }
  grain.style.backgroundImage = noiseFrames[0];
  const motion = win.matchMedia('(prefers-reduced-motion: reduce)');
  const generated = node => node?.nodeType === 1 && Boolean(node.closest('[data-crt-generated]'));
  const listen = (host, name, handler, options) => {
    host.addEventListener(name, handler, options);
    cleanups.push(() => host.removeEventListener(name, handler, options));
  };
  const restoreFilter = () => {
    if (originalFilter) target.style.setProperty('filter', originalFilter, originalPriority);
    else target.style.removeProperty('filter');
  };
  function schedule() {
    if (!destroyed && settings.enabled && !doc.hidden && !frame) frame = win.requestAnimationFrame(refresh);
  }
  const resizeObserver = new win.ResizeObserver(schedule);
  function refresh() {
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    if (destroyed || !settings.enabled || doc.hidden) return;
    const bounds = root ? { left: 0, top: 0, width: win.innerWidth, height: win.innerHeight } : target.getBoundingClientRect();
    const { width, height } = bounds;
    if (!width || !height) { overlay.style.display = 'none'; return; }
    overlay.style.display = 'block';
    Object.assign(overlay.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${width}px`, height: `${height}px` });
    const custom = settings.protect ? [...target.querySelectorAll(settings.protect)] : [];
    if (settings.protect && target.matches(settings.protect)) custom.unshift(target);
    // A protected ancestor already covers its descendants; avoid unnecessary geometry work.
    protectedElements = [...new Set([...custom, ...target.querySelectorAll(nativeControls)])]
      .filter(el => !generated(el) && !custom.some(parent => parent !== el && parent.contains(el)));
    const nextObserved = new Set([target, ...protectedElements]);
    for (const el of observed) if (!nextObserved.has(el)) resizeObserver.unobserve(el);
    for (const el of nextObserved) if (!observed.has(el)) resizeObserver.observe(el);
    observed = nextObserved;
    const regions = protectedElements.flatMap(el => [...el.getClientRects()]).filter(r =>
      r.width && r.height && r.right >= bounds.left && r.bottom >= bounds.top && r.left <= bounds.left + width && r.top <= bounds.top + height)
      .map(r => ({ left: r.left - bounds.left, top: r.top - bounds.top, right: r.right - bounds.left, bottom: r.bottom - bounds.top }));
    const x = root ? win.scrollX : 0, y = root ? win.scrollY : 0;
    const surfaceWidth = root ? Math.max(width, target.scrollWidth) : width;
    const surfaceHeight = root ? Math.max(height, target.scrollHeight) : height;
    const signature = JSON.stringify([width, height, surfaceWidth, surfaceHeight, x, y, settings.curvature, regions]);
    if (signature !== lastGeometry) {
      lastGeometry = signature;
      // Rasterize at ~4 CSS px/texel, bounded to 512 on the longest side.
      const ratio = Math.min(.25, 512 / Math.max(width, height));
      mapCanvas.width = Math.max(2, Math.ceil(width * ratio));
      mapCanvas.height = Math.max(2, Math.ceil(height * ratio));
      const pixels = context.createImageData(mapCanvas.width, mapCanvas.height);
      const scale = Math.max(1, Math.max(width, height) * settings.curvature * 1.05);
      const padding = 6 + 2 / ratio, feather = Math.max(24, scale);
      for (let j = 0; j < mapCanvas.height; j++) for (let i = 0; i < mapCanvas.width; i++) {
        const [dx, dy] = displacement((i + .5) / mapCanvas.width * width, (j + .5) / mapCanvas.height * height,
          width, height, settings.curvature, regions, padding, feather);
        const offset = (j * mapCanvas.width + i) * 4;
        pixels.data[offset] = Math.round(128 + dx / scale * 255);
        pixels.data[offset + 1] = Math.round(128 + dy / scale * 255);
        pixels.data[offset + 2] = 128;
        pixels.data[offset + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      map.setAttribute('href', mapCanvas.toDataURL());
      // Keep the filter region stable over the whole surface. WebKit rescales root filter
      // primitives incorrectly if the filter region itself moves during scrolling. Only
      // the sampling map follows the viewport in document coordinates.
      for (const [key, value] of Object.entries({ x: 0, y: 0, width: surfaceWidth, height: surfaceHeight })) filter.setAttribute(key, value);
      for (const [key, value] of Object.entries({ x, y, width, height })) map.setAttribute(key, value);
      warp.setAttribute('scale', settings.curvature ? scale : 0);
    }
    // Follow CSS transitions/animations on protected regions, including drawer entrances.
    if (protectedElements.some(el => el.getAnimations().some(a => a.playState === 'running'))) schedule();
  }
  function animateGrain() {
    win.clearTimeout(grainTimer);
    grainTimer = 0;
    if (destroyed || !settings.enabled || !settings.grain || motion.matches || doc.hidden) return;
    grainTimer = win.setTimeout(() => {
      grain.style.backgroundImage = noiseFrames[++grainIndex % noiseFrames.length];
      grain.style.backgroundPosition = `${grainIndex * 37 % 128}px ${grainIndex * 53 % 128}px`;
      animateGrain();
    }, 1000 / settings.grainFPS);
  }
  function apply() {
    if (settings.enabled) {
      target.style.setProperty('filter', `${computedFilter === 'none' ? '' : computedFilter + ' '}url("#${id}")`, 'important');
      overlay.style.display = 'block';
      scanlines.style.background = `repeating-linear-gradient(0deg,transparent 0px,transparent ${settings.scanlineSpacing * .45}px,#000 ${settings.scanlineSpacing * .82}px,transparent ${settings.scanlineSpacing}px)`;
      scanlines.style.opacity = settings.scanlines;
      mask.style.opacity = settings.mask;
      grain.style.opacity = settings.grain;
      vignette.style.opacity = settings.vignette;
      glow.setAttribute('k2', settings.glow);
      bezel?.setAttribute('flood-opacity', settings.curvature ? 1 : 0);
      refresh();
    } else {
      restoreFilter();
      overlay.style.display = 'none';
      win.cancelAnimationFrame(frame);
      frame = 0;
    }
    animateGrain();
  }
  const observer = new win.MutationObserver(records => {
    if (records.some(record => !generated(record.target))) schedule();
  });
  observer.observe(target, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'open', 'inert', 'href', 'tabindex', 'contenteditable', 'data-crt-protect'] });
  listen(win, 'resize', schedule, { passive: true });
  listen(doc, 'scroll', schedule, { passive: true, capture: true });
  listen(doc, 'transitionrun', schedule, true);
  listen(doc, 'animationstart', schedule, true);
  listen(doc, 'visibilitychange', () => {
    if (doc.hidden) { win.cancelAnimationFrame(frame); frame = 0; }
    else schedule();
    animateGrain();
  });
  listen(motion, 'change', animateGrain);
  if (win.visualViewport) {
    listen(win.visualViewport, 'resize', schedule, { passive: true });
    listen(win.visualViewport, 'scroll', schedule, { passive: true });
  }
  const api = Object.freeze({
    get enabled() { return !destroyed && settings.enabled; },
    get options() { return Object.freeze({ ...settings }); },
    update(patch = {}) {
      if (destroyed) return;
      settings = normalize(settings, patch, target);
      apply();
    },
    setEnabled(enabled) { if (!destroyed) api.update({ enabled }); },
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      win.cancelAnimationFrame(frame);
      win.clearTimeout(grainTimer);
      observer.disconnect();
      resizeObserver.disconnect();
      cleanups.forEach(remove => remove());
      restoreFilter();
      overlay.remove();
      defsHost.remove();
      instances.delete(target);
      protectedElements = [];
      observed.clear();
      noiseFrames.length = 0;
      mapCanvas.width = mapCanvas.height = noiseCanvas.width = noiseCanvas.height = 1;
    },
  });
  instances.set(target, api);
  apply();
  return api;
}
