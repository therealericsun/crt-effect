# crt-effect

Dependency-free CRT glass for live HTML and canvas. Real displacement curves page content; fine scanlines, a subdued vertical phosphor mask, cached animated grain, soft additive glow, and vignette shading finish the picture. Text remains selectable, controls remain native, and no page content is cloned.

## Use

Copy `dist/crt-effect.js` and `LICENSE` into your site. No build step or runtime dependency is required.

```html
<script type="module">
  import { createCRT } from './vendor/crt-effect.js';
  const crt = createCRT(document.documentElement, {
    preset: 'balanced',
    protect: '[data-crt-protect]',
  });
  crt.update({ grain: 0.02 });
  // crt.setEnabled(false);
  // crt.refresh();
  // crt.destroy();
</script>
```

For TypeScript or bundlers, import `createCRT`, `balanced`, `CRTOptions`, and `CRTInstance` from the package. Types are included in `dist/crt-effect.d.ts`. Initialize after the body exists, such as in a deferred module. Importing the module alone does not access the DOM.

## Options

`createCRT(target, options)` and `crt.update(partialOptions)` support:

| Option | Balanced default | Accepted values |
| --- | --- | --- |
| `preset` | `'balanced'` | `'balanced'` |
| `enabled` | `true` | boolean |
| `curvature` | `0.035` | coefficient, 0–0.15 |
| `grain` | `0.025` | opacity, 0–1 |
| `grainFPS` | `12` | updates/sec, 1–60 |
| `scanlines` | `0.10` | opacity, 0–1 |
| `scanlineSpacing` | `3` | CSS pixels, 1–12 |
| `mask` | `0.025` | opacity, 0–1 |
| `vignette` | `0.45` | opacity, 0–1 |
| `glow` | `0.08` | additive blur contribution, 0–1 |
| `protect` | `'[data-crt-protect]'` | CSS selector; `''` disables custom regions |

Numeric values are clamped to the documented ranges. Invalid types, nonfinite numbers, invalid selectors, and unknown presets throw before applying an update. All six visual effects are independent; setting a strength to zero disables that effect. `crt.enabled` and `crt.options` expose current state, with options returned as a frozen snapshot. Changing `preset` does not reset other settings: apply `{ ...balanced }` to reset all settings.

`setEnabled(false)` restores the original filter, hides generated layers, and stops animation. `refresh()` immediately measures layout and updates the displacement map. `destroy()` cancels timers and animation frames, disconnects observers and event listeners, removes generated elements, and restores the original inline filter and its priority. Other inline styles are untouched. Calls after destruction are harmless. A target can have one live instance; destroy it before creating another.

## Geometry and interaction

The effect samples live page pixels with an SVG `feDisplacementMap`. An independent cross-axis polynomial moves sampling coordinates increasingly near the viewport edges. A small CPU-generated displacement map is cached until viewport or protected-region geometry changes; it is bounded to 512 pixels on the longest axis. Its displacement range adapts to the requested curvature for subpixel precision. Exposed root-screen corners are filled with black. Scanline and mask spacing use CSS pixels, keeping them fine at high display density. The map follows native scroll offsets and resize events inside a stable document-sized filter region, avoiding WebKit's moving-region rescaling. No wrappers, transformed scrolling containers, or canvas screenshots replace your page.

SVG filters change painted pixels without changing browser hit regions. Links, labels, inputs, buttons, editable areas, focusable elements, and other native controls therefore receive **zero displacement**, with a smooth taper around them. Mark a larger interaction area, drawer, or drag surface with `data-crt-protect`, or pass a custom `protect` selector:

```html
<aside data-crt-protect><!-- settings and sliders --></aside>
```

This protection applies only to curvature; the region still receives the texture and glow. Inline links use their individual line rectangles. Protected rectangles are measured on scroll, resize, DOM layout mutations, and their CSS animations/transitions. Use `refresh()` after layout changes driven by external systems, animated ancestors, or selector attributes other than those observed (`class`, `style`, `hidden`, `open`, `inert`, `href`, `tabindex`, `contenteditable`, `data-crt-protect`). Custom canvas drag surfaces should be protected when precise pointer alignment matters.

For full-page effects, **use `document.documentElement`**: browsers treat a root filter specially so fixed descendants retain the viewport as their containing block. A filtered non-root target establishes a containing block for its own fixed descendants; use a root target if you depend on viewport-fixed children. The optional non-root mode follows the target's border box and renders its visual overlays at that viewport rectangle. Avoid transformed ancestors for non-root targets. The root filter covers the document; only its displacement map follows the viewport. Filter buffers may be expensive on long documents, large displays, or animation-heavy pages. Test on your target hardware; reduce curvature or disable the effect if necessary.

## Motion, accessibility, and browser requirements

Grain swaps eight cached 128px tiles at 12Hz by default. Reduced-motion preference freezes grain; hidden documents suspend grain and scheduled geometry work. No temporal trails, interference, moving scanlines, or chromatic separation are included, preserving small text. Generated elements are inert, hidden from assistive technology, and ignore pointer events. Text selection, native scrolling, keyboard focus, semantic markup, and existing application rendering stay under browser/application control. Selection highlights on curved text follow native unfiltered geometry, just as pointer hit regions do.

Requires modern browsers with SVG filter references, Canvas 2D, ES modules, ResizeObserver, MutationObserver, and Web Animations `getAnimations()`.

**Firefox root-filter limitation:** Firefox currently ignores this SVG filter chain on `document.documentElement` ([Mozilla bug 1769223](https://bugzilla.mozilla.org/show_bug.cgi?id=1769223)). In root mode Firefox receives scanlines, mask, grain, and vignette, but no curvature or additive glow. Chromium and WebKit receive the full treatment. Firefox curvature and glow work on non-root targets; that mode changes fixed-descendant containing blocks as described above. The library keeps root-mode scrolling and positioning intact and does not silently substitute a body filter. Browser tests explicitly verify both the root limitation and working non-root displacement. CSP policies must allow `data:` images for generated maps and noise, inline element styles, and the same-document SVG filter reference. Existing computed filters are composed before CRT; the original inline filter is restored on disable/destroy. Changes to the target's `filter` while CRT is active are owned by CRT until destruction.

## Demo and development

```sh
npm install
npm run build
npm run demo                 # http://127.0.0.1:8788
npm test
npx playwright install chromium firefox webkit
npm run test:browser
```

The demo contains generic HTML, a canvas oscilloscope, controls for each effect, a scrolling calibration grid, and destroy/recreate controls. Browser tests exercise actual displaced pixels, interaction, document scrolling, fixed-position elements, resize, options, motion preferences, hidden tabs, and teardown. `dist/` is checked in and has no dependencies; build with Node 20+ to regenerate it. See [VALIDATION.md](VALIDATION.md) for recorded results.

## Inspiration and license

[CRT-Geom](https://github.com/libretro/slang-shaders/blob/master/crt/shaders/crt-geom.slang), by cgwg, Themaister, and DOLLS, informed the curved-screen, beam-profile scanline, and phosphor-mask principles. [NewPixie CRT](https://github.com/libretro/slang-shaders/blob/master/crt/shaders/newpixie/newpixie-crt.slang), by Mattias Gustavsson and contributors, informed the softer, noisier aesthetic. This library independently implements those visual ideas using browser primitives. No shader source is copied or translated; the referenced shader projects retain their own licenses.

This library is [MIT licensed](LICENSE).
