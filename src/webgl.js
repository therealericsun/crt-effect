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
  uniform float uCurvature, uGlow;
  ${declarations}
  vec4 picture(vec2 p) { vec4 color = uBackground; ${samples} return color; }
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
  // WebKitGTK's non-DMABUF path otherwise presents the previous draw forever.
  // https://bugs.webkit.org/show_bug.cgi?id=324549
  const ua = win.navigator.userAgent;
  const webkitGTK = /Linux/.test(ua) && /AppleWebKit\//.test(ua) && !/(Chrome|Chromium|Edg|OPR)\//.test(ua);
  const attributes = { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: webkitGTK, powerPreference: 'high-performance' };
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
  const scan = doc.createElement('div'), mask = doc.createElement('div'), grain = doc.createElement('div'), shade = doc.createElement('div');
  for (const el of [scan, mask, grain, shade]) el.style.cssText = 'position:absolute;inset:0;pointer-events:none!important';
  overlay.append(scan, mask, grain, shade);
  mask.style.background = 'repeating-linear-gradient(90deg,#f004 0px,#0f02 1px,#00f4 2px,transparent 3px)';
  shade.style.background = 'radial-gradient(ellipse at center,transparent 35%,#0005 75%,#000 100%)';
  grain.dataset.crtGrain = '';
  scan.dataset.crtScanlines = '';
  grain.style.backgroundSize = '128px 128px';
  const noiseFrames = [];
  function paintGrain() {
    grain.style.opacity = settings.grain;
    if (!settings.grain) return;
    if (!noiseFrames.length) {
      const canvas = doc.createElement('canvas'); canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d');
      for (let i = 0; i < 8; i++) {
        const pixels = ctx.createImageData(128, 128);
        for (let p = 0; p < pixels.data.length; p += 4) {
          pixels.data[p] = pixels.data[p + 1] = pixels.data[p + 2] = Math.floor(Math.random() * 256);
          pixels.data[p + 3] = 255;
        }
        ctx.putImageData(pixels, 0, 0); noiseFrames.push(`url("${canvas.toDataURL()}")`);
      }
    }
    grain.style.backgroundImage = noiseFrames[tick % noiseFrames.length];
    grain.style.backgroundPosition = `${tick * 37 % 128}px ${tick * 53 % 128}px`;
  }
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
    for (const key of ['Background','Size','Pixel','Curvature','Glow']) uniforms[key] = gl.getUniformLocation(program, 'u' + key);
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
    for (const [key, value] of Object.entries({ Curvature: settings.curvature, Glow: settings.glow })) gl.uniform1f(uniforms[key], value);
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
    gl.drawArrays(gl.TRIANGLES, 0, 6); gl.flush();
  }
  function schedule() {
    if (!frame && !destroyed && !doc.hidden && settings.enabled) frame = win.requestAnimationFrame(() => { frame = 0; render(); });
  }
  function animate() {
    win.clearTimeout(timer); timer = 0;
    if (!destroyed && !lost && settings.enabled && settings.grain && !motion.matches && !doc.hidden) {
      timer = win.setTimeout(() => { tick++; paintGrain(); animate(); }, 1000 / settings.grainFPS);
    }
  }
  function apply() {
    if (settings.enabled && !lost) {
      for (const layer of layers) layer.source.style.setProperty('opacity', '0', 'important');
      output.style.display = overlay.style.display = 'block';
      if (bezel) bezel.style.display = 'block';
      scan.style.background = `repeating-linear-gradient(0deg,transparent 0px,transparent ${settings.scanlineSpacing * .45}px,#000 ${settings.scanlineSpacing * .82}px,transparent ${settings.scanlineSpacing}px)`;
      scan.style.opacity = settings.scanlines; mask.style.opacity = settings.mask; shade.style.opacity = settings.vignette;
      paintGrain();
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
  listen(motion, 'change', () => { tick = 0; paintGrain(); animate(); });
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
    render(upload = true) { render(upload); }, refresh: schedule,
    update(patch = {}) { if (!destroyed) { settings = normalize(settings, patch, target); apply(); } },
    setEnabled(enabled) { api.update({ enabled }); },
    destroy() {
      if (destroyed) return;
      destroyed = true; win.cancelAnimationFrame(frame); win.clearTimeout(timer); observer.disconnect(); removers.forEach(remove => remove());
      restoreSources(); release(); noiseFrames.length = 0; output.remove(); overlay.remove(); bezel?.remove(); output.width = output.height = 1;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      instances.delete(target);
    },
  });
  instances.set(target, api);
  apply(); return api;
}
