/** Independent cross-axis barrel sampling, in viewport CSS pixels. */
export function displacement(x, y, width, height, curvature, regions = [], padding = 6, feather = 24) {
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
