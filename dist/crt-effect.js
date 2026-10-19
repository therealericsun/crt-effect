// crt-effect v1.1.1 | MIT | https://github.com/therealericsun/crt-effect
/** Independent cross-axis barrel sampling, in viewport CSS pixels. */
function displacement(x, y, width, height, curvature, regions = [], padding = 6, feather = 24) {
  const u = x / width * 2 - 1, v = y / height * 2 - 1;
  let weight = 1;
  for (const r of regions) {
    const dx = Math.max(r.left - padding - x, 0, x - r.right - padding);
    const dy = Math.max(r.top - padding - y, 0, y - r.bottom - padding);
    const t = Math.min(1, Math.hypot(dx, dy) / feather);
    weight = Math.min(weight, t * t * (3 - 2 * t));
  }
  return [curvature * width * .5 * u * v * v * weight,
    curvature * height * .5 * v * u * u * weight];
}


export const balanced = Object.freeze({
  preset: 'balanced', enabled: true, curvature: .035, grain: .025, grainFPS: 12,
  scanlines: .10, scanlineSpacing: 3, mask: .025, vignette: .45, glow: .08,
  protect: '[data-crt-protect]', alignControls: true, viewport: undefined,
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
  if (typeof result.alignControls !== 'boolean') throw new TypeError('alignControls must be boolean.');
  if (result.viewport !== undefined && (!result.viewport?.isConnected || result.viewport.ownerDocument !== target.ownerDocument || !result.viewport.getBoundingClientRect)) throw new TypeError('viewport must be a connected element in the same document.');
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
  // WebKit positions user-space filter primitives in the HTML parent's space.
  // Its bounding-box mode correctly keeps the map local to positioned surfaces.
  const boxUnits = !root && /AppleWebKit\//.test(win.navigator.userAgent) && !/(Chrome|Chromium|Edg|OPR)\//.test(win.navigator.userAgent);
  const ns = 'http://www.w3.org/2000/svg';
  const id = `crt-effect-${++serial}`;
  const originalFilter = target.style.getPropertyValue('filter');
  const originalPriority = target.style.getPropertyPriority('filter');
  const computedFilter = win.getComputedStyle(target).filter;
  let destroyed = false, frame = 0, grainTimer = 0, lastGeometry = '', lastMap = '', mapURL = '', grainIndex = 0;
  let protectedElements = [], observed = new Set();
  const cleanups = [];
  const counterFilters = new Map();
  const svg = (name, attributes, parent) => {
    const el = doc.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, String(value));
    parent?.append(el);
    return el;
  };
  const defsHost = svg('svg', { 'aria-hidden': 'true', focusable: 'false', width: 0, height: 0 });
  defsHost.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;overflow:hidden';
  defsHost.dataset.crtGenerated = id;
  const filter = svg('filter', { id, filterUnits: boxUnits ? 'objectBoundingBox' : 'userSpaceOnUse', primitiveUnits: boxUnits ? 'objectBoundingBox' : 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' }, svg('defs', {}, defsHost));
  const map = svg('feImage', { result: 'map', preserveAspectRatio: 'none' }, filter);
  // 128 is the neutral 8-bit channel; shift it to exactly .5 to avoid a half-pixel bias.
  const transfer = svg('feComponentTransfer', { in: 'map', result: 'centered' }, filter);
  for (const channel of ['R', 'G']) svg(`feFunc${channel}`, { type: 'linear', slope: 1, intercept: -.5 / 255 }, transfer);
  const warp = svg('feDisplacementMap', { in: 'SourceGraphic', in2: 'centered', xChannelSelector: 'R', yChannelSelector: 'G', result: 'curved' }, filter);
  const blur = svg('feGaussianBlur', { in: 'curved', stdDeviation: .65, result: 'soft' }, filter);
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
  function restoreControl(el, state) {
    if (state.inline) el.style.setProperty('filter', state.inline, state.priority);
    else el.style.removeProperty('filter');
    state.filter.remove();
  }
  function clearControls() {
    for (const [el, state] of counterFilters) restoreControl(el, state);
    counterFilters.clear();
  }
  function alignControls(elements, bounds, regions, padding, feather) {
    const active = new Set(elements);
    for (const [el, state] of counterFilters) if (!active.has(el)) {
      restoreControl(el, state); counterFilters.delete(el);
    }
    for (const el of elements) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const [dx, dy] = displacement((r.left + r.right) / 2 - bounds.left,
        (r.top + r.bottom) / 2 - bounds.top, bounds.width, bounds.height,
        settings.curvature, regions, padding, feather);
      let state = counterFilters.get(el);
      if (!state) {
        const controlID = `${id}-control-${++serial}`;
        const computed = win.getComputedStyle(el).filter;
        const controlFilter = svg('filter', { id: controlID, x: '-100%', y: '-100%', width: '300%', height: '300%',
          filterUnits: 'objectBoundingBox', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' }, filter.parentNode);
        const offset = svg('feOffset', { in: 'SourceGraphic' }, controlFilter);
        state = { filter: controlFilter, offset, inline: el.style.getPropertyValue('filter'), priority: el.style.getPropertyPriority('filter') };
        counterFilters.set(el, state);
        // Move only this control's painted content before the screen samples it. The
        // native hit box stays in place, without flattening or denting surrounding glass.
        el.style.setProperty('filter', `${computed === 'none' ? '' : computed + ' '}url("#${controlID}")`, 'important');
      }
      for (const [axis, value] of [['dx', dx.toFixed(3)], ['dy', dy.toFixed(3)]]) {
        if (state.offset.getAttribute(axis) !== value) state.offset.setAttribute(axis, value);
      }
    }
  }
  function schedule() {
    if (!destroyed && settings.enabled && !doc.hidden && !frame) frame = win.requestAnimationFrame(refresh);
  }
  const resizeObserver = new win.ResizeObserver(schedule);
  function refresh() {
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    if (destroyed || !settings.enabled) return;
    const paintedBounds = root ? { left: 0, top: 0, width: win.innerWidth, height: win.innerHeight } : target.getBoundingClientRect();
    const paintedReference = settings.viewport?.getBoundingClientRect() || paintedBounds;
    const scaleX = settings.viewport ? paintedReference.width / settings.viewport.offsetWidth || 1 : 1;
    const scaleY = settings.viewport ? paintedReference.height / settings.viewport.offsetHeight || 1 : 1;
    const reference = { left: paintedReference.left, top: paintedReference.top,
      width: paintedReference.width / scaleX, height: paintedReference.height / scaleY };
    const offsetX = (paintedBounds.left - paintedReference.left) / scaleX;
    const offsetY = (paintedBounds.top - paintedReference.top) / scaleY;
    const bounds = { left: reference.left + offsetX, top: reference.top + offsetY,
      width: paintedBounds.width / scaleX, height: paintedBounds.height / scaleY };
    const { width, height } = bounds;
    if (!width || !height) { overlay.style.display = 'none'; return; }
    overlay.style.display = 'block';
    Object.assign(overlay.style, { left: `${paintedBounds.left}px`, top: `${paintedBounds.top}px`, width: `${paintedBounds.width}px`, height: `${paintedBounds.height}px` });
    const custom = settings.protect ? [...target.querySelectorAll(settings.protect)] : [];
    if (settings.protect && target.matches(settings.protect)) custom.unshift(target);
    const controls = [...target.querySelectorAll(`[data-crt-align],${nativeControls}`)].filter(el => !generated(el)
      && !custom.some(parent => parent === el || parent.contains(el)))
      .filter((el, _, all) => !all.some(parent => parent !== el && parent.contains(el)));
    // Only explicit protected regions flatten the map. Native controls are aligned
    // locally, so a row of links cannot kink nearby borders or text baselines.
    const regionsToProtect = custom.filter(el => !generated(el) && !custom.some(parent => parent !== el && parent.contains(el)));
    protectedElements = [...regionsToProtect, ...controls];
    const nextObserved = new Set([target, ...(settings.viewport ? [settings.viewport] : []), ...protectedElements]);
    for (const el of observed) if (!nextObserved.has(el)) resizeObserver.unobserve(el);
    for (const el of nextObserved) if (!observed.has(el)) resizeObserver.observe(el);
    observed = nextObserved;
    const regions = regionsToProtect.flatMap(el => [...el.getClientRects()]).filter(r =>
      r.width && r.height && r.right >= bounds.left && r.bottom >= bounds.top && r.left <= bounds.left + width && r.top <= bounds.top + height)
      .map(r => ({ left: r.left - reference.left, top: r.top - reference.top, right: r.right - reference.left, bottom: r.bottom - reference.top }));
    const x = root ? win.scrollX : 0, y = root ? win.scrollY : 0;
    const surfaceWidth = root ? Math.max(width, target.scrollWidth) : width;
    const surfaceHeight = root ? Math.max(height, target.scrollHeight) : height;
    const scale = Math.max(1, Math.max(reference.width, reference.height) * settings.curvature * 1.05);
    const normalizedScale = Math.max(scale / width, scale / height);
    const margin = root ? 0 : Math.ceil(scale * .6 + 2);
    const mapWidth = width + 2 * margin, mapHeight = height + 2 * margin;
    const ratio = Math.min(.5, 1024 / Math.max(mapWidth, mapHeight));
    const padding = 6 + 2 / ratio, feather = Math.max(24, scale);
    // Firefox does not execute the enclosing SVG chain on the document root.
    if (settings.alignControls && !(root && /Firefox\//.test(win.navigator.userAgent))) alignControls(controls, reference, regions, padding, feather);
    else clearControls();
    const signature = JSON.stringify([width, height, surfaceWidth, surfaceHeight, x, y, offsetX, offsetY, reference.width, reference.height, settings.curvature, regions]);
    if (signature !== lastGeometry) {
      lastGeometry = signature;
      const mapSignature = JSON.stringify([mapWidth, mapHeight, offsetX, offsetY, reference.width, reference.height, settings.curvature, regions]);
      if (mapSignature !== lastMap) {
        lastMap = mapSignature;
        // Crop one screen-wide field to this surface. Avoid negative feImage
        // coordinates, which WebKit clips before displacement sampling.
        mapCanvas.width = Math.max(2, Math.ceil(mapWidth * ratio));
        mapCanvas.height = Math.max(2, Math.ceil(mapHeight * ratio));
        const pixels = context.createImageData(mapCanvas.width, mapCanvas.height);
        for (let j = 0; j < mapCanvas.height; j++) for (let i = 0; i < mapCanvas.width; i++) {
          const [dx, dy] = displacement((i + .5) / mapCanvas.width * mapWidth - margin + offsetX, (j + .5) / mapCanvas.height * mapHeight - margin + offsetY,
            reference.width, reference.height, settings.curvature, regions, padding, feather);
          const offset = (j * mapCanvas.width + i) * 4;
          pixels.data[offset] = Math.round(128 + (boxUnits ? dx / width / normalizedScale : dx / scale) * 255);
          pixels.data[offset + 1] = Math.round(128 + (boxUnits ? dy / height / normalizedScale : dy / scale) * 255);
          pixels.data[offset + 2] = 128;
          pixels.data[offset + 3] = 255;
        }
        context.putImageData(pixels, 0, 0);
        mapURL = mapCanvas.toDataURL();
      }
      // Keep the filter region stable over the whole surface. WebKit rescales root filter
      // primitives incorrectly if the filter region itself moves during scrolling. Only
      // the sampling map follows the viewport in document coordinates.
      const filterRegion = boxUnits ? { x: -margin / width, y: -margin / height, width: mapWidth / width, height: mapHeight / height } : { x: -margin, y: -margin, width: surfaceWidth + 2 * margin, height: surfaceHeight + 2 * margin };
      const mapRegion = boxUnits ? { x: -margin / width, y: -margin / height, width: mapWidth / width, height: mapHeight / height } : { x: x - margin, y: y - margin, width: mapWidth, height: mapHeight };
      for (const [key, value] of Object.entries(filterRegion)) filter.setAttribute(key, value);
      for (const [key, value] of Object.entries(mapRegion)) map.setAttribute(key, value);
      // Bounding-box primitive coordinates avoid WebKit's displaced origin for
      // positioned HTML. Normalize each map channel by its own CSS-pixel axis.
      blur.setAttribute('stdDeviation', boxUnits ? `${.65 / width} ${.65 / height}` : '.65');
      warp.setAttribute('scale', settings.curvature ? boxUnits ? normalizedScale : scale : 0);
      // Safari must see valid primitive bounds when the image is first loaded.
      if (map.getAttribute('href') !== mapURL) map.setAttribute('href', mapURL);
    }
    // Follow CSS transitions/animations on protected regions, including drawer entrances.
    if ([target, ...protectedElements].some(el => el.getAnimations().some(a => a.playState === 'running'))) schedule();
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
      overlay.style.display = 'block';
      scanlines.style.background = `repeating-linear-gradient(0deg,transparent 0px,transparent ${settings.scanlineSpacing * .45}px,#000 ${settings.scanlineSpacing * .82}px,transparent ${settings.scanlineSpacing}px)`;
      scanlines.style.opacity = settings.scanlines;
      mask.style.opacity = settings.mask;
      grain.style.opacity = settings.grain;
      vignette.style.opacity = settings.vignette;
      if (settings.glow) {
        if (!blur.parentNode) filter.insertBefore(blur, glow);
        glow.setAttribute('in', 'soft');
      } else {
        // Firefox executes SVG filters in software. Remove the blur pass entirely
        // when glow is disabled rather than computing it with a zero contribution.
        blur.remove();
        glow.setAttribute('in', 'curved');
      }
      glow.setAttribute('k2', settings.glow);
      bezel?.setAttribute('flood-opacity', settings.curvature ? 1 : 0);
      // Initialize even in hidden tabs, before Safari paints this filter chain.
      refresh();
      target.style.setProperty('filter', `${computedFilter === 'none' ? '' : computedFilter + ' '}url("#${id}")`, 'important');
    } else {
      restoreFilter();
      clearControls();
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
    attributeFilter: ['class', 'style', 'hidden', 'open', 'inert', 'href', 'tabindex', 'contenteditable', 'data-crt-protect', 'data-crt-align'] });
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
      clearControls();
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

const vertexSource = `
attribute vec2 aPosition;
varying vec2 vUV;
void main() { vUV = aPosition * .5 + .5; gl_Position = vec4(aPosition, 0., 1.); }
`;

function fragmentSource(count) {
  const declarations = Array.from({ length: count }, (_, i) => `uniform sampler2D uSource${i}; uniform vec4 uRect${i}; uniform float uOpacity${i};`).join('\n');
  const samples = Array.from({ length: count }, (_, i) => `
    vec2 uv${i} = (p * uSize - uRect${i}.xy) / max(uRect${i}.zw, vec2(1.));
    if (uv${i}.x >= 0. && uv${i}.x <= 1. && uv${i}.y >= 0. && uv${i}.y <= 1.) {
      vec4 layer = texture2D(uSource${i}, vec2(uv${i}.x, 1. - uv${i}.y)) * uOpacity${i};
      color = layer + color * (1. - layer.a);
    }`).join('\n');
  return `precision highp float;
  varying vec2 vUV;
  uniform vec2 uSize;
  uniform vec4 uBackground;
  uniform vec2 uPixel;
  uniform float uCurvature, uGrain, uTick, uScanlines, uSpacing, uMask, uVignette, uGlow;
  ${declarations}
  vec4 picture(vec2 p) { vec4 color = uBackground; ${samples} return color; }
  float random(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec2 p = vec2(vUV.x, 1. - vUV.y);
    vec2 q = p * 2. - 1.;
    vec2 curved = p + .5 * uCurvature * q * q.yx * q.yx;
    vec4 color = picture(curved);
    if (uGlow > 0.) {
      vec2 stepSize = uPixel * 1.25;
      vec4 soft = (picture(curved + vec2(stepSize.x, 0.)) + picture(curved - vec2(stepSize.x, 0.))
        + picture(curved + vec2(0., stepSize.y)) + picture(curved - vec2(0., stepSize.y))) * .25;
      color.rgb += soft.rgb * uGlow;
      color.a = min(1., color.a + soft.a * uGlow);
    }
    float beam = pow(.5 + .5 * cos(p.y * uSize.y / uSpacing * 6.2831853), 3.);
    color.rgb *= 1. - uScanlines * beam;
    float stripe = mod(floor(p.x * uSize.x), 3.);
    vec3 phosphor = stripe < 1. ? vec3(1., .55, .55) : stripe < 2. ? vec3(.55, 1., .55) : vec3(.55, .55, 1.);
    color.rgb *= mix(vec3(1.), phosphor, uMask);
    color.rgb += (random(floor(p * uSize) + uTick * vec2(37., 53.)) - .5) * uGrain * color.a;
    color.rgb *= 1. - uVignette * smoothstep(.35, 1.35, length(q));
    gl_FragColor = vec4(clamp(color.rgb, vec3(0.), vec3(color.a)), color.a);
  }`;
}

/** GPU CRT postprocessing for canvas layers, with native DOM above the output. */
export function createWebGLCRT(target, options = {}) {
  if (!target?.isConnected || !target.ownerDocument) throw new TypeError('A connected HTML surface is required.');
  const doc = target.ownerDocument, win = doc.defaultView;
  const sources = options.sources || [...target.querySelectorAll('canvas[data-crt-source]')];
  if (!Array.isArray(sources) || !sources.length || sources.length > 8 || sources.some(canvas => canvas.tagName !== 'CANVAS')) {
    throw new TypeError('Provide between one and eight canvas sources.');
  }
  const { sources: ignoredSources, pixelRatio = Math.min(win.devicePixelRatio || 1, 2), maxPixels = 3000000, aperture = false, ...core } = options;
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0 || !Number.isFinite(maxPixels) || maxPixels <= 0) throw new TypeError('Invalid output resolution.');
  if (instances.has(target)) throw new Error('This element already has a CRT instance.');
  let settings = normalize(balanced, core, target);
  const output = doc.createElement('canvas');
  const attributes = { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' };
  // GLSL ES 1.00 works in WebGL 1 and is converted below for WebGL 2.
  let gl = output.getContext('webgl2', attributes), renderer = 'webgl2';
  if (!gl) { gl = output.getContext('webgl', attributes); renderer = 'webgl'; }
  if (!gl) throw new Error('WebGL is unavailable.');
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if (sources.length > gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)) throw new Error('Too many canvas layers for this GPU.');
  output.dataset.crtGenerated = 'webgl-output';
  output.dataset.crtRenderer = renderer;
  output.setAttribute('aria-hidden', 'true'); output.inert = true;
  output.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none!important;z-index:0';
  const layers = sources.map(source => ({ source, opacity: Number(win.getComputedStyle(source).opacity),
    original: source.style.getPropertyValue('opacity'), priority: source.style.getPropertyPriority('opacity'), texture: null, staging: null, stagingContext: null, width: 0, height: 0, rect: [0, 0, 1, 1] }));
  let program, buffer, uniforms = {}, shaders = [], destroyed = false, lost = false, frame = 0, timer = 0, tick = 0;
  let width = 1, height = 1, maskGeometry = '';
  const bezel = aperture ? doc.createElement('canvas') : null;
  const bezelContext = bezel?.getContext('2d');
  if (bezel) {
    bezel.dataset.crtGenerated = 'webgl-aperture'; bezel.setAttribute('aria-hidden', 'true'); bezel.inert = true;
    bezel.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:2147483646;pointer-events:none!important';
  }
  function updateAperture(bounds) {
    if (!bezelContext) return;
    const density = Math.min(win.devicePixelRatio || 1, 2);
    const key = [bounds.left, bounds.top, bounds.width, bounds.height, win.innerWidth, win.innerHeight, density].join(',');
    if (key === maskGeometry) return;
    maskGeometry = key;
    bezel.width = Math.round(win.innerWidth * density); bezel.height = Math.round(win.innerHeight * density);
    bezelContext.setTransform(1,0,0,1,0,0); bezelContext.globalCompositeOperation = 'source-over';
    bezelContext.fillStyle = '#000'; bezelContext.fillRect(0,0,bezel.width,bezel.height);
    bezelContext.setTransform(bounds.width * density,0,0,bounds.height * density,bounds.left * density,bounds.top * density);
    bezelContext.globalCompositeOperation = 'destination-out';
    bezelContext.beginPath(); bezelContext.moveTo(.06,.025);
    for (const p of [[.5,-.015,.94,.025],[.985,.03,.99,.09],[1.01,.5,.99,.91],[.985,.97,.94,.975],
      [.5,1.015,.06,.975],[.015,.97,.01,.91],[-.01,.5,.01,.09],[.015,.03,.06,.025]]) bezelContext.quadraticCurveTo(...p);
    bezelContext.closePath(); bezelContext.fill();
  }
  const removers = [];
  const listen = (host, name, fn, options) => { host.addEventListener(name, fn, options); removers.push(() => host.removeEventListener(name, fn, options)); };
  const motion = win.matchMedia('(prefers-reduced-motion: reduce)');
  const overlay = doc.createElement('div');
  overlay.dataset.crtGenerated = 'webgl-overlay'; overlay.setAttribute('aria-hidden', 'true'); overlay.inert = true;
  overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none!important;z-index:8;user-select:none';
  // Native text stays sharp and selectable; inexpensive compositor layers match
  // the texture treatment on the GPU canvas without capturing/rasterizing HTML.
  const scan = doc.createElement('div'), mask = doc.createElement('div'), shade = doc.createElement('div');
  for (const el of [scan, mask, shade]) el.style.cssText = 'position:absolute;inset:0;pointer-events:none!important';
  overlay.append(scan, mask, shade);
  mask.style.background = 'repeating-linear-gradient(90deg,#f004 0px,#0f02 1px,#00f4 2px,transparent 3px)';
  shade.style.background = 'radial-gradient(ellipse at center,transparent 35%,#0005 75%,#000 100%)';
  function release() {
    for (const layer of layers) { if (layer.texture) gl.deleteTexture(layer.texture); layer.texture = null; layer.width = layer.height = 0; if (layer.staging) layer.staging.width = layer.staging.height = 1; layer.staging = layer.stagingContext = null; }
    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
    shaders.forEach(shader => gl.deleteShader(shader)); shaders = []; buffer = program = null;
  }
  function initialize() {
    const convert = (source, fragment) => renderer === 'webgl2' ? '#version 300 es\n' + source
      .replace(/attribute/g, 'in').replace(/varying/g, fragment ? 'in' : 'out').replace(/texture2D/g, 'texture')
      .replace('precision highp float;', 'precision highp float;\nout vec4 outColor;').replace(/gl_FragColor/g, 'outColor') : source;
    const compile = (type, source) => {
      const shader = gl.createShader(type); shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, convert(vertexSource, false)));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, convert(fragmentSource(layers.length), true)));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    uniforms = {};
    for (const key of ['Background','Size','Pixel','Curvature','Grain','Tick','Scanlines','Spacing','Mask','Vignette','Glow']) uniforms[key] = gl.getUniformLocation(program, 'u' + key);
    layers.forEach((layer, i) => {
      layer.texture = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, layer.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      gl.uniform1i(gl.getUniformLocation(program, 'uSource' + i), i);
      layer.rectUniform = gl.getUniformLocation(program, 'uRect' + i);
      layer.opacityUniform = gl.getUniformLocation(program, 'uOpacity' + i);
    });
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  }
  function restoreSources() {
    for (const layer of layers) {
      if (layer.original) layer.source.style.setProperty('opacity', layer.original, layer.priority);
      else layer.source.style.removeProperty('opacity');
    }
  }
  function render(upload = true) {
    if (destroyed || lost || !settings.enabled || (doc.hidden && !upload)) return;
    const bounds = target.getBoundingClientRect();
    width = target.clientWidth; height = target.clientHeight;
    const scaleX = bounds.width / width || 1, scaleY = bounds.height / height || 1;
    // A collapsed/hidden host must never leave a full-window black mask.
    if (!width || !height || !bounds.width || !bounds.height) {
      output.style.display = overlay.style.display = 'none';
      if (bezel) bezel.style.display = 'none';
      return;
    }
    output.style.display = overlay.style.display = 'block';
    if (bezel) bezel.style.display = 'block';
    updateAperture(bounds);
    const density = Math.min(pixelRatio, Math.sqrt(maxPixels / (width * height)), maxTextureSize / Math.max(width, height));
    const w = Math.max(1, Math.round(width * density)), h = Math.max(1, Math.round(height * density));
    if (output.width !== w || output.height !== h) { output.width = w; output.height = h; }
    gl.viewport(0, 0, output.width, output.height); gl.useProgram(program);
    const background = win.getComputedStyle(target).backgroundColor.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0];
    gl.uniform4f(uniforms.Background, background[0] / 255, background[1] / 255, background[2] / 255, background[3] ?? 1);
    gl.uniform2f(uniforms.Size, width, height); gl.uniform2f(uniforms.Pixel, 1 / width, 1 / height);
    for (const [key, value] of Object.entries({ Curvature: settings.curvature, Grain: settings.grain, Tick: tick,
      Scanlines: settings.scanlines, Spacing: settings.scanlineSpacing, Mask: settings.mask, Vignette: settings.vignette, Glow: settings.glow })) gl.uniform1f(uniforms[key], value);
    layers.forEach((layer, i) => {
      const rect = layer.source.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0 && layer.source.width > 0 && layer.source.height > 0
        && win.getComputedStyle(layer.source).visibility === 'visible';
      gl.uniform4f(layer.rectUniform, (rect.left - bounds.left) / scaleX, (rect.top - bounds.top) / scaleY, rect.width / scaleX, rect.height / scaleY);
      gl.uniform1f(layer.opacityUniform, visible ? layer.opacity : 0);
      if (!visible) return;
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, layer.texture);
      if (upload) {
        let source = layer.source;
        const ratio = Math.min(1, maxTextureSize / Math.max(source.width, source.height));
        if (ratio < 1) {
          if (!layer.staging) { layer.staging = doc.createElement('canvas'); layer.stagingContext = layer.staging.getContext('2d'); }
          const w = Math.max(1, Math.floor(source.width * ratio)), h = Math.max(1, Math.floor(source.height * ratio));
          if (layer.staging.width !== w || layer.staging.height !== h) { layer.staging.width = w; layer.staging.height = h; }
          layer.stagingContext.clearRect(0, 0, w, h); layer.stagingContext.drawImage(source, 0, 0, w, h);
          source = layer.staging;
        }
        if (layer.width !== source.width || layer.height !== source.height) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
          layer.width = source.width; layer.height = source.height;
        } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
      }
    });
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  function schedule() {
    if (!frame && !destroyed && !doc.hidden && settings.enabled) frame = win.requestAnimationFrame(() => { frame = 0; render(); });
  }
  function animate() {
    win.clearTimeout(timer); timer = 0;
    if (!destroyed && !lost && settings.enabled && settings.grain && !motion.matches && !doc.hidden) {
      timer = win.setTimeout(() => { tick++; render(false); animate(); }, 1000 / settings.grainFPS);
    }
  }
  function apply() {
    if (settings.enabled && !lost) {
      for (const layer of layers) layer.source.style.setProperty('opacity', '0', 'important');
      output.style.display = overlay.style.display = 'block';
      if (bezel) bezel.style.display = 'block';
      scan.style.background = `repeating-linear-gradient(0deg,transparent 0px,transparent ${settings.scanlineSpacing * .45}px,#000 ${settings.scanlineSpacing * .82}px,transparent ${settings.scanlineSpacing}px)`;
      scan.style.opacity = settings.scanlines * .5; mask.style.opacity = settings.mask * .5; shade.style.opacity = settings.vignette;
      render();
    } else { restoreSources(); output.style.display = overlay.style.display = 'none'; if (bezel) bezel.style.display = 'none'; }
    animate();
  }
  try { initialize(); } catch (error) { release(); throw error; }
  target.prepend(output); target.append(overlay);
  if (bezel) doc.body.append(bezel);
  const observer = new win.ResizeObserver(schedule); observer.observe(target); sources.forEach(source => observer.observe(source));
  listen(doc, 'scroll', schedule, { passive: true, capture: true });
  listen(win, 'resize', schedule, { passive: true });
  listen(doc, 'visibilitychange', () => { if (!doc.hidden) schedule(); else { win.cancelAnimationFrame(frame); frame = 0; } animate(); });
  listen(motion, 'change', () => { tick = 0; render(false); animate(); });
  listen(output, 'webglcontextlost', event => {
    event.preventDefault(); lost = true; program = buffer = null; shaders = [];
    for (const layer of layers) { layer.texture = null; layer.width = layer.height = 0; } win.clearTimeout(timer); timer = 0; restoreSources(); output.style.display = overlay.style.display = 'none'; if (bezel) bezel.style.display = 'none';
  });
  listen(output, 'webglcontextrestored', () => {
    if (destroyed) return;
    try { initialize(); lost = false; apply(); }
    catch (error) { lost = true; restoreSources(); output.style.display = overlay.style.display = 'none'; if (bezel) bezel.style.display = 'none'; console.warn('CRT WebGL context could not recover.', error); }
  });
  const api = Object.freeze({
    get renderer() { return renderer; }, get contextLost() { return lost; },
    get enabled() { return !destroyed && settings.enabled; },
    get options() { return Object.freeze({ ...settings }); },
    render() { render(true); }, refresh: schedule,
    update(patch = {}) { if (!destroyed) { settings = normalize(settings, patch, target); apply(); } },
    setEnabled(enabled) { api.update({ enabled }); },
    destroy() {
      if (destroyed) return;
      destroyed = true; win.cancelAnimationFrame(frame); win.clearTimeout(timer); observer.disconnect(); removers.forEach(remove => remove());
      restoreSources(); release(); output.remove(); overlay.remove(); bezel?.remove(); output.width = output.height = 1;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      instances.delete(target);
    },
  });
  instances.set(target, api);
  apply(); return api;
}
