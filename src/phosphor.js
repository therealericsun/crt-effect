/** Cached RGB glass texture, sampled through the same cross-axis barrel field. */
export function createPhosphorMask(doc, host) {
  const canvas = doc.createElement('canvas');
  canvas.dataset.crtMaskPattern = '';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none!important';
  host.dataset.crtMask = '';
  let signature = '';
  return {
    paint(width, height, curvature, referenceWidth = width, referenceHeight = height, offsetX = 0, offsetY = 0) {
      const density = Math.min(doc.defaultView.devicePixelRatio || 1, 2, Math.sqrt(3000000 / (width * height)), 8192 / Math.max(width, height));
      const key = [width, height, curvature, referenceWidth, referenceHeight, offsetX, offsetY, density].join(',');
      if (signature === key) return;
      signature = key;
      canvas.width = Math.max(1, Math.round(width * density));
      canvas.height = Math.max(1, Math.round(height * density));
      const ctx = canvas.getContext('2d');
      // At each output row, barrel sampling is affine in x. A resampled 1D
      // strip gives the exact field without a full-screen JS pixel loop.
      const v2 = Math.max((offsetY / referenceHeight * 2 - 1) ** 2,
        ((offsetY + height) / referenceHeight * 2 - 1) ** 2);
      const center = referenceWidth / 2;
      const left = Math.floor(Math.min(offsetX, center + (offsetX - center) * (1 + curvature * v2))) - 2;
      const right = Math.ceil(Math.max(offsetX + width, center + (offsetX + width - center) * (1 + curvature * v2))) + 2;
      const strip = doc.createElement('canvas'), tile = doc.createElement('canvas');
      const resolution = Math.min(Math.max(4, density * 4), 16000 / (right - left));
      strip.width = Math.ceil((right - left) * resolution); strip.height = 1;
      tile.width = Math.max(3, Math.round(3 * resolution)); tile.height = 1;
      const tileContext = tile.getContext('2d');
      const pixels = tileContext.createImageData(tile.width, 1);
      // Match CSS gradient interpolation in premultiplied sRGB, including the
      // transparent gap. Canvas gradients interpolate alpha differently.
      for (let i = 0; i < tile.width; i++) {
        const phase = (i + .5) / tile.width * 3;
        const rgb = phase < 1 ? [68 * (1 - phase), 34 * phase, 0]
          : phase < 2 ? [0, 34 * (2 - phase), 68 * (phase - 1)] : [0, 0, 68 * (3 - phase)];
        const alpha = rgb[0] + rgb[1] + rgb[2];
        for (let c = 0; c < 3; c++) pixels.data[i * 4 + c] = Math.round(rgb[c] / alpha * 255);
        pixels.data[i * 4 + 3] = Math.round(alpha);
      }
      tileContext.putImageData(pixels, 0, 0);
      const stripContext = strip.getContext('2d');
      // Keep phase in shared viewport coordinates, including cropped panels.
      stripContext.scale(resolution, 1);
      stripContext.translate(-left, 0);
      const pattern = stripContext.createPattern(tile, 'repeat');
      pattern.setTransform(new doc.defaultView.DOMMatrix().scale(3 / tile.width, 1));
      stripContext.fillStyle = pattern; stripContext.fillRect(left, 0, right - left, 1);
      for (let row = 0; row < canvas.height; row++) {
        const y = offsetY + (row + .5) * height / canvas.height;
        const v = y / referenceHeight * 2 - 1;
        const scale = 1 + curvature * v * v;
        // Clip to the curved glass: neither sampled axis may leave the screen.
        if (Math.abs(v) >= 1) continue;
        const limitX = 1 / scale;
        const limitY = curvature && v ? Math.sqrt((1 / Math.abs(v) - 1) / curvature) : 1;
        const limit = Math.min(limitX, limitY);
        const from = Math.max(0, center * (1 - limit) - offsetX);
        const to = Math.min(width, center * (1 + limit) - offsetX);
        if (to <= from) continue;
        const start = center + (offsetX + from - center) * scale;
        ctx.drawImage(strip, (start - left) * resolution, 0, (to - from) * scale * resolution, 1,
          from / width * canvas.width, row, (to - from) / width * canvas.width, 1);
      }
      host.append(canvas);
      strip.width = tile.width = 1;
    },
    destroy() { canvas.remove(); canvas.width = canvas.height = 1; signature = ''; },
  };
}
